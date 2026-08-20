"""Typed event-envelope tests that compose correlation and redaction."""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import FrozenInstanceError
from datetime import UTC, datetime, timedelta, timezone
from unittest.mock import MagicMock

import httpx
import pytest
from fastapi import FastAPI

from onless_api.observability.events import (
    MAX_DURATION_MS,
    MAX_EVENT_NAME_CHARS,
    DiagnosticEvent,
    DiagnosticEventEncoder,
    DiagnosticLevel,
    InvalidDiagnosticEvent,
)
from onless_api.observability.redaction import MAX_TOTAL_CHARS, REDACTED
from onless_api.observability.request_id import RequestIdMiddleware

FIXED_NOW = datetime(2026, 8, 20, 9, 30, 15, 250_000, tzinfo=UTC)
FIXED_ID = "00000000000040008000000000000009"


def encoder() -> DiagnosticEventEncoder:
    return DiagnosticEventEncoder(clock=lambda: FIXED_NOW)


@asynccontextmanager
async def client_for(application: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=application)
    async with httpx.AsyncClient(transport=transport, base_url="http://example.test") as client:
        yield client


def test_build_produces_exact_identity_free_envelope_outside_request_context() -> None:
    event = encoder().build(
        "learning.projection_completed",
        level=DiagnosticLevel.INFO,
        status_code=200,
        duration_ms=12.345,
        details={"stage_count": 3, "source": "synthetic-demo"},
    )

    assert event.as_dict() == {
        "event": "learning.projection_completed",
        "level": "info",
        "occurred_at": "2026-08-20T09:30:15.250000+00:00",
        "status_code": 200,
        "duration_ms": 12.345,
        "details": {"stage_count": 3, "source": "synthetic-demo"},
    }


def test_optional_metadata_is_omitted_instead_of_serialized_as_null() -> None:
    event = encoder().build("showcase.ready")

    assert event.as_dict() == {
        "event": "showcase.ready",
        "level": "info",
        "occurred_at": "2026-08-20T09:30:15.250000+00:00",
        "details": {},
    }


def test_event_cannot_be_directly_constructed_with_caller_correlation() -> None:
    with pytest.raises(TypeError, match="DiagnosticEventEncoder"):
        DiagnosticEvent()
    with pytest.raises(TypeError):
        DiagnosticEvent(request_id="caller-controlled")  # type: ignore[call-arg]


def test_encode_is_compact_deterministic_json() -> None:
    encoded = encoder().encode(
        "demo.completed",
        level=DiagnosticLevel.WARNING,
        details={"zeta": 1, "alpha": 2},
    )

    assert encoded == (
        '{"details":{"alpha":2,"zeta":1},"event":"demo.completed",'
        '"level":"warning","occurred_at":"2026-08-20T09:30:15.250000+00:00"}'
    )
    assert encoder().encode("demo.completed", details={"value": 1}) == encoder().encode(
        "demo.completed", details={"value": 1}
    )


def test_details_are_structurally_and_textually_redacted() -> None:
    encoded = encoder().encode(
        "demo.redacted",
        details={
            "email": "Demo@example.test",
            "phone": "synthetic-phone-value",
            "user_id": "00000000-0000-4000-8000-000000000099",
            "token": "demo-secret-token",
            "message": "Contact Demo@example.test using token=demo-secret-token",
            "result": "rejected",
        },
    )
    decoded = json.loads(encoded)

    assert decoded["details"] == {
        "message": f"Contact {REDACTED} using token={REDACTED}",
        "result": "rejected",
    }
    assert "example.test" not in encoded
    assert "synthetic-phone-value" not in encoded
    assert "00000000-0000-4000-8000-000000000099" not in encoded
    assert "demo-secret-token" not in encoded


def test_nested_request_id_cannot_replace_envelope_correlation() -> None:
    encoded = encoder().encode(
        "demo.no_context",
        details={"request_id": "caller-controlled", "result": "ok"},
    )
    decoded = json.loads(encoded)

    assert "request_id" not in decoded
    assert decoded["details"] == {"result": "ok"}


def test_reserved_request_id_is_removed_from_every_details_depth() -> None:
    valid_but_untrusted = "00000000000040008000000000000077"
    event = encoder().build(
        "demo.reserved",
        details={
            "request_id": valid_but_untrusted,
            "Request-ID": valid_but_untrusted,
            "nested": {
                "request_id": valid_but_untrusted,
                "request_identifier": "non_reserved_label",
            },
            "items": [{"REQUEST ID": valid_but_untrusted}, {"result": "ok"}],
            "json_text": json.dumps({"request_id": valid_but_untrusted, "result": "encoded"}),
        },
    )

    assert event.as_dict()["details"] == {
        "items": [{}, {"result": "ok"}],
        "json_text": '{"result":"encoded"}',
        "nested": {"request_identifier": "non_reserved_label"},
    }

    def assert_no_reserved_key(value: object) -> None:
        if isinstance(value, dict):
            assert "request_id" not in value
            for item in value.values():
                assert_no_reserved_key(item)
        elif isinstance(value, list):
            for item in value:
                assert_no_reserved_key(item)

    assert_no_reserved_key(event.as_dict()["details"])


def test_event_details_are_deeply_immutable_and_returned_as_fresh_copies() -> None:
    original = {
        "nested": {"items": ["first", {"result": "ready"}]},
        "labels": ["demo"],
    }
    event = encoder().build("demo.immutable_details", details=original)

    original["nested"]["items"].append("mutated-input")  # type: ignore[index,union-attr]
    first = event.as_dict()
    first["details"]["nested"]["items"].append("mutated-output")  # type: ignore[index,union-attr]
    direct = event.details
    direct["labels"].append("mutated-property")  # type: ignore[attr-defined,index,union-attr]

    expected = {
        "nested": {"items": ["first", {"result": "ready"}]},
        "labels": ["demo"],
    }
    assert event.details == expected
    assert event.as_dict()["details"] == expected
    assert event.as_dict() is not event.as_dict()
    assert event.details is not event.details


@pytest.mark.asyncio
async def test_encoder_reads_only_active_server_owned_request_context() -> None:
    application = FastAPI()
    application.add_middleware(
        RequestIdMiddleware,
        request_id_factory=lambda: FIXED_ID,
    )

    @application.get("/event")
    async def event() -> dict[str, object]:
        return json.loads(encoder().encode("request.completed", status_code=200))

    async with client_for(application) as client:
        response = await client.get(
            "/event",
            headers={"X-Request-ID": "external-caller-credential"},
        )

    assert response.status_code == 200
    assert response.json()["request_id"] == FIXED_ID
    assert response.headers["X-Request-ID"] == FIXED_ID
    assert "external-caller-credential" not in response.text


@pytest.mark.parametrize(
    "name",
    [
        "",
        "Uppercase",
        "two words",
        ".leading",
        "trailing.",
        "double..separator",
        "slash/not-allowed",
        "a" * (MAX_EVENT_NAME_CHARS + 1),
    ],
)
def test_invalid_event_names_fail_before_serialization(name: str) -> None:
    with pytest.raises(InvalidDiagnosticEvent):
        encoder().build(name)


@pytest.mark.parametrize("name", [None, 42, True, object()])
def test_non_text_event_names_are_rejected(name: object) -> None:
    with pytest.raises(InvalidDiagnosticEvent, match="must be text"):
        encoder().build(name)  # type: ignore[arg-type]


@pytest.mark.parametrize("level", ["info", logging.INFO, None, True])
def test_level_requires_explicit_diagnostic_enum(level: object) -> None:
    with pytest.raises(InvalidDiagnosticEvent, match="DiagnosticLevel"):
        encoder().build("demo.level", level=level)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    "status_code",
    [True, False, 99, 600, 200.0, "200", object()],
)
def test_status_code_uses_strict_http_boundary(status_code: object) -> None:
    with pytest.raises(InvalidDiagnosticEvent, match="100 to 599"):
        encoder().build("demo.status", status_code=status_code)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    "duration",
    [True, False, -0.01, MAX_DURATION_MS + 0.01, float("nan"), float("inf"), "1"],
)
def test_duration_rejects_coercion_non_finite_and_out_of_budget_values(
    duration: object,
) -> None:
    with pytest.raises(InvalidDiagnosticEvent):
        encoder().build("demo.duration", duration_ms=duration)  # type: ignore[arg-type]


@pytest.mark.parametrize("duration", [0, 0.0, 1, 12.5, MAX_DURATION_MS])
def test_duration_accepts_bounded_numbers(duration: float | int) -> None:
    event = encoder().build("demo.duration", duration_ms=duration)

    assert event.duration_ms == float(duration)


def test_clock_requires_timezone_aware_datetime() -> None:
    naive = DiagnosticEventEncoder(clock=lambda: datetime(2026, 8, 20, 9, 30))
    non_datetime = DiagnosticEventEncoder(clock=lambda: "2026-08-20")  # type: ignore[arg-type]

    with pytest.raises(InvalidDiagnosticEvent, match="timezone-aware"):
        naive.build("demo.clock")
    with pytest.raises(InvalidDiagnosticEvent, match="timezone-aware"):
        non_datetime.build("demo.clock")


def test_clock_is_normalized_to_utc() -> None:
    tashkent_offset = timezone(timedelta(hours=5))
    local_time = datetime(2026, 8, 20, 14, 30, tzinfo=tashkent_offset)
    event = DiagnosticEventEncoder(clock=lambda: local_time).build("demo.clock")

    assert event.occurred_at.tzinfo is UTC
    assert event.as_dict()["occurred_at"] == "2026-08-20T09:30:00+00:00"


@pytest.mark.parametrize("details", [[], (), "value", 42, object()])
def test_details_require_a_mapping(details: object) -> None:
    with pytest.raises(InvalidDiagnosticEvent, match="must be a mapping"):
        encoder().build("demo.details", details=details)  # type: ignore[arg-type]


def test_encoded_event_respects_global_output_budget() -> None:
    encoded = encoder().encode(
        "demo.large",
        details={f"field-{index}": "x" * 4_096 for index in range(128)},
    )

    assert len(encoded) <= MAX_TOTAL_CHARS
    assert json.loads(encoded) is not None


def test_event_is_immutable_after_validation() -> None:
    event = encoder().build("demo.immutable")

    with pytest.raises(FrozenInstanceError):
        event.name = "changed"  # type: ignore[misc]


@pytest.mark.parametrize(
    ("level", "expected"),
    [
        (DiagnosticLevel.INFO, logging.INFO),
        (DiagnosticLevel.WARNING, logging.WARNING),
        (DiagnosticLevel.ERROR, logging.ERROR),
    ],
)
def test_emit_uses_declared_level_and_already_redacted_json(
    level: DiagnosticLevel,
    expected: int,
) -> None:
    logger = MagicMock(spec=logging.Logger)

    encoder().emit(
        logger,
        "demo.emitted",
        level=level,
        details={"email": "Demo@example.test", "result": "ok"},
    )

    logger.log.assert_called_once()
    actual_level, payload = logger.log.call_args.args
    assert actual_level == expected
    assert json.loads(payload)["details"] == {"result": "ok"}
    assert "example.test" not in payload
