"""Isolation and trust-boundary tests for server-owned request correlation."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager
from uuid import UUID

import httpx
import pytest
from fastapi import FastAPI, Request

import onless_api.observability.request_id as request_id_module
from onless_api.observability.request_id import (
    RequestIdLoggingFilter,
    RequestIdMiddleware,
    generate_request_id,
    get_current_request_id,
    get_trusted_request_id,
)

FIRST_ID = "00000000000040008000000000000001"
SECOND_ID = "00000000000040008000000000000002"
EXTERNAL_CANARY = "demo-caller-correlation-credential"


def sequence_factory(values: Iterator[str]) -> str:
    return next(values)


def build_app(*, identifiers: tuple[str, ...] | None = None) -> FastAPI:
    application = FastAPI()
    if identifiers is None:
        application.add_middleware(RequestIdMiddleware)
    else:
        values = iter(identifiers)
        application.add_middleware(
            RequestIdMiddleware,
            request_id_factory=lambda: sequence_factory(values),
        )

    @application.get("/context")
    async def context(request: Request) -> dict[str, object]:
        return {
            "context": get_current_request_id(),
            "trusted": get_trusted_request_id(request),
            "trusted_flag": request.state.request_id_trusted,
        }

    @application.get("/wait")
    async def wait() -> dict[str, str | None]:
        captured_before = get_current_request_id()
        await asyncio.sleep(0.01)
        return {"before": captured_before, "after": get_current_request_id()}

    @application.get("/failure")
    async def failure() -> None:
        raise RuntimeError("synthetic failure")

    return application


@asynccontextmanager
async def client_for(
    application: FastAPI,
    *,
    raise_app_exceptions: bool = True,
) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(
        app=application,
        raise_app_exceptions=raise_app_exceptions,
    )
    async with httpx.AsyncClient(transport=transport, base_url="http://example.test") as client:
        yield client


def assert_server_id(value: object) -> None:
    assert isinstance(value, str)
    assert len(value) == 32
    assert all(character in "0123456789abcdef" for character in value)


def test_generated_request_ids_are_unique_and_canonical(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    deterministic = tuple(UUID(int=value, version=4) for value in range(1, 1_001))
    values = iter(deterministic)
    monkeypatch.setattr(request_id_module.uuid, "uuid4", lambda: next(values))

    identifiers = tuple(generate_request_id() for _ in deterministic)

    assert identifiers == tuple(value.hex for value in deterministic)
    assert len(set(identifiers)) == 1_000
    for identifier in identifiers:
        assert_server_id(identifier)


@pytest.mark.asyncio
async def test_middleware_exposes_one_server_id_in_context_state_and_response() -> None:
    application = build_app(identifiers=(FIRST_ID,))

    async with client_for(application) as client:
        response = await client.get("/context")

    assert response.status_code == 200
    assert response.headers["X-Request-ID"] == FIRST_ID
    assert response.json() == {
        "context": FIRST_ID,
        "trusted": FIRST_ID,
        "trusted_flag": True,
    }


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "external_value",
    [
        EXTERNAL_CANARY,
        FIRST_ID,
        "valid-looking-id",
        "../../diagnostic",
        "<script>demo</script>",
        "a" * 2_000,
    ],
)
async def test_incoming_correlation_values_are_never_trusted_or_reflected(
    external_value: str,
) -> None:
    application = build_app(identifiers=(SECOND_ID,))

    async with client_for(application) as client:
        response = await client.get("/context", headers={"X-Request-ID": external_value})

    assert response.status_code == 200
    assert response.headers["X-Request-ID"] == SECOND_ID
    assert response.json()["context"] == SECOND_ID
    assert external_value not in response.text
    assert external_value not in response.headers["X-Request-ID"]


@pytest.mark.asyncio
async def test_caller_value_is_absent_from_completion_logs(
    caplog: pytest.LogCaptureFixture,
) -> None:
    application = build_app(identifiers=(FIRST_ID,))

    with caplog.at_level(logging.INFO):
        async with client_for(application) as client:
            response = await client.get(
                "/context?credential=not-observed",
                headers={"X-Request-ID": EXTERNAL_CANARY},
            )

    assert response.status_code == 200
    assert EXTERNAL_CANARY not in caplog.text
    record = next(record for record in caplog.records if record.message == "request_completed")
    assert "credential=not-observed" not in record.getMessage()
    assert record.request_id == FIRST_ID
    assert record.status_code == 200
    assert isinstance(record.duration_ms, float)


@pytest.mark.asyncio
async def test_invalid_internal_factory_value_fails_closed_to_a_fresh_id() -> None:
    application = build_app(identifiers=(EXTERNAL_CANARY,))

    async with client_for(application) as client:
        response = await client.get("/context")

    returned = response.headers["X-Request-ID"]
    assert_server_id(returned)
    assert returned != EXTERNAL_CANARY
    assert response.json()["context"] == returned


@pytest.mark.asyncio
async def test_request_context_is_cleared_after_success() -> None:
    application = build_app(identifiers=(FIRST_ID,))

    assert get_current_request_id() is None
    async with client_for(application) as client:
        response = await client.get("/context")
    assert response.status_code == 200
    assert get_current_request_id() is None


@pytest.mark.asyncio
async def test_request_context_is_cleared_after_endpoint_failure(
    caplog: pytest.LogCaptureFixture,
) -> None:
    application = build_app(identifiers=(FIRST_ID,))

    with caplog.at_level(logging.ERROR):
        async with client_for(application, raise_app_exceptions=False) as client:
            response = await client.get("/failure", headers={"X-Request-ID": EXTERNAL_CANARY})

    assert response.status_code == 500
    assert get_current_request_id() is None
    assert EXTERNAL_CANARY not in caplog.text
    record = next(record for record in caplog.records if record.message == "request_failed")
    assert record.request_id == FIRST_ID
    assert record.error_type == "RuntimeError"
    assert not hasattr(record, "error")


@pytest.mark.asyncio
async def test_concurrent_requests_keep_distinct_contexts_across_awaits() -> None:
    application = build_app(identifiers=(FIRST_ID, SECOND_ID))

    async with client_for(application) as client:
        first, second = await asyncio.gather(client.get("/wait"), client.get("/wait"))

    bodies = (first.json(), second.json())
    headers = {first.headers["X-Request-ID"], second.headers["X-Request-ID"]}

    assert headers == {FIRST_ID, SECOND_ID}
    assert {body["before"] for body in bodies} == headers
    assert {body["after"] for body in bodies} == headers
    assert all(body["before"] == body["after"] for body in bodies)
    assert get_current_request_id() is None


@pytest.mark.asyncio
async def test_sequential_requests_receive_distinct_ids() -> None:
    application = build_app(identifiers=(FIRST_ID, SECOND_ID))

    async with client_for(application) as client:
        first = await client.get("/context")
        second = await client.get("/context")

    assert first.headers["X-Request-ID"] == FIRST_ID
    assert second.headers["X-Request-ID"] == SECOND_ID
    assert first.json()["context"] != second.json()["context"]


def request_with_state(**values: object) -> Request:
    request = Request({"type": "http", "method": "GET", "path": "/", "headers": []})
    for key, value in values.items():
        setattr(request.state, key, value)
    return request


@pytest.mark.parametrize(
    "request_instance",
    [
        None,
        request_with_state(),
        request_with_state(request_id=FIRST_ID),
        request_with_state(request_id_trusted=False, request_id=FIRST_ID),
        request_with_state(request_id_trusted=True, request_id=EXTERNAL_CANARY),
        request_with_state(request_id_trusted=True, request_id="A" * 32),
        request_with_state(request_id_trusted=True, request_id=None),
    ],
)
def test_trusted_request_helper_rejects_unmarked_or_malformed_state(
    request_instance: Request | None,
) -> None:
    assert get_trusted_request_id(request_instance) is None


def test_trusted_request_helper_accepts_only_middleware_shape() -> None:
    request = request_with_state(request_id_trusted=True, request_id=FIRST_ID)

    assert get_trusted_request_id(request) == FIRST_ID


def test_logging_filter_uses_dash_outside_request_context() -> None:
    record = logging.LogRecord(
        name="demo",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="outside",
        args=(),
        exc_info=None,
    )

    accepted = RequestIdLoggingFilter().filter(record)

    assert accepted is True
    assert record.request_id == "-"


@pytest.mark.asyncio
async def test_logging_filter_reads_the_active_request_context() -> None:
    application = FastAPI()
    application.add_middleware(
        RequestIdMiddleware,
        request_id_factory=lambda: FIRST_ID,
    )

    @application.get("/filtered")
    async def filtered() -> dict[str, object]:
        record = logging.LogRecord(
            name="demo",
            level=logging.INFO,
            pathname=__file__,
            lineno=1,
            msg="inside",
            args=(),
            exc_info=None,
        )
        accepted = RequestIdLoggingFilter().filter(record)
        return {"accepted": accepted, "record_id": record.request_id}

    async with client_for(application) as client:
        response = await client.get("/filtered")

    assert response.json() == {"accepted": True, "record_id": FIRST_ID}
    assert get_current_request_id() is None


@pytest.mark.asyncio
async def test_custom_response_header_does_not_change_input_trust_policy() -> None:
    application = FastAPI()
    application.add_middleware(
        RequestIdMiddleware,
        header_name="X-Demo-Correlation",
        request_id_factory=lambda: FIRST_ID,
    )

    @application.get("/custom")
    async def custom() -> dict[str, str | None]:
        return {"context": get_current_request_id()}

    async with client_for(application) as client:
        response = await client.get(
            "/custom",
            headers={"X-Demo-Correlation": EXTERNAL_CANARY},
        )

    assert response.headers["X-Demo-Correlation"] == FIRST_ID
    assert response.json() == {"context": FIRST_ID}
    assert EXTERNAL_CANARY not in response.text
