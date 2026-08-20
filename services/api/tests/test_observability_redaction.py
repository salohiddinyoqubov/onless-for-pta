"""Security and resource-boundary tests for diagnostic redaction."""

from __future__ import annotations

import json
from datetime import UTC, date, datetime
from enum import StrEnum
from uuid import UUID

import pytest

import onless_api.observability.redaction as redaction_module
from onless_api.observability.redaction import (
    CYCLE,
    MAX_DEPTH,
    MAX_ITEMS,
    MAX_JSON_INPUT_CHARS,
    MAX_STRING_CHARS,
    MAX_TOTAL_CHARS,
    REDACTED,
    TRUNCATED,
    is_sensitive_key,
    redact_text,
    sanitize_data,
    serialize_redacted,
)

CANARIES = (
    "demo-access-credential",
    "demo-refresh-credential",
    "demo-cookie-credential",
    "demo-oauth-credential",
    "demo-secret-credential",
)
REQUEST_ID = "4f581a8be5b6424ab66f252b1f35af09"
EVENT_ID = UUID("00000000-0000-4000-8000-000000000001")


def serialized(value: object) -> str:
    return json.dumps(value, sort_keys=True)


def assert_no_canary(value: object) -> None:
    encoded = serialized(value)
    for canary in CANARIES:
        assert canary not in encoded


def jwt_shape_canary() -> str:
    """Build a JWT-shaped value at runtime without storing a scanner signature."""
    header = "".join(("e", "y", "J", "demoheader"))
    return ".".join((header, "demopayload", "demosignature"))


def phone_shape_canary(style: str) -> str:
    """Build non-routable numeric shapes without tracking a phone-like literal."""
    if style == "spaced":
        return "+" + " ".join(("000", "00", "000", "00", "00"))
    if style == "grouped":
        return "(" + "000" + ") " + "000" + "-" + "0000"
    if style == "compact":
        return "".join(("000", "000", "000", "000"))
    raise ValueError("unknown synthetic phone shape")


@pytest.mark.parametrize(
    "key",
    [
        "authorization",
        "Authorization",
        "AUTHORIZATION",
        "access_token",
        "accessToken",
        "refreshToken",
        "client-secret",
        "apiKey",
        "password_hash",
        "oauth.code",
        "session_token",
        "verificationCode",
        "COOKIE",
        "telegram_hash",
        "request_payload",
        "email",
        "contactEmail",
        "phone_number",
        "mobilePhone",
        "user_id",
        "userId",
        "account_id",
        "accountId",
        "profile_id",
        "profileId",
        "full_name",
        "fullName",
        "ip_address",
        "ipAddress",
        "input",
        "pin",
    ],
)
def test_sensitive_key_detection_is_case_and_separator_insensitive(key: str) -> None:
    assert is_sensitive_key(key)


@pytest.mark.parametrize(
    "key",
    [
        "request_id",
        "event_id",
        "status_code",
        "error_code",
        "tokenizer_latency",
        "keynote_title",
        "sessionless_mode",
        "authentic_design",
    ],
)
def test_safe_diagnostic_keys_do_not_trigger_substring_false_positives(key: str) -> None:
    assert not is_sensitive_key(key)


def test_nested_sensitive_fields_are_removed_at_every_depth() -> None:
    unsafe = {
        "authorization": f"Bearer {CANARIES[0]}",
        "result": "accepted",
        "nested": [
            {"refreshToken": CANARIES[1], "count": 2},
            {
                "headers": {"Cookie": f"sid={CANARIES[2]}"},
                "message": f"oauth_code={CANARIES[3]}&page=1",
            },
        ],
        "metadata": {"client_secret": CANARIES[4], "status_code": 200},
    }

    safe = sanitize_data(unsafe)

    assert safe == {
        "result": "accepted",
        "nested": [
            {"count": 2},
            {"message": f"oauth_code={REDACTED}&page=1"},
        ],
        "metadata": {"status_code": 200},
    }
    assert_no_canary(safe)


def test_structural_direct_identifiers_are_omitted_recursively() -> None:
    unsafe = {
        "email": "Demo@example.test",
        "phone_number": "synthetic-phone-value",
        "user_id": "00000000-0000-4000-8000-000000000099",
        "account_id": "00000000-0000-4000-8000-000000000100",
        "profileId": "00000000-0000-4000-8000-000000000101",
        "full_name": "Demo",
        "ipAddress": "203.0.113.42",
        "nested": {
            "contactEmail": "Demo@example.test",
            "mobilePhone": "nested-synthetic-phone-value",
            "result": "ready",
        },
    }

    assert sanitize_data(unsafe) == {"nested": {"result": "ready"}}


@pytest.mark.parametrize(
    "unsafe",
    [
        "Contact Demo@example.test for support",
        "Email: Demo@example.test",
        f"Phone {phone_shape_canary('spaced')} is synthetic",
        f"Call {phone_shape_canary('grouped')} during the demo",
        f"phone={phone_shape_canary('compact')}",
        "user_id=00000000-0000-4000-8000-000000000099",
        "account_id=00000000-0000-4000-8000-000000000100, result=ignored",
        "profileId: 00000000-0000-4000-8000-000000000101; result=ignored",
        'full_name="Demo"',
        "ip_address=203.0.113.42",
        "Connection originated at 203.0.113.42",
        "IPv6 address 2001:db8::42 is synthetic",
    ],
)
def test_free_text_direct_identifiers_are_redacted(unsafe: str) -> None:
    result = redact_text(unsafe)

    assert REDACTED in result
    assert "example.test" not in result
    assert all(
        phone_shape_canary(style) not in result for style in ("spaced", "grouped", "compact")
    )
    assert "00000000-0000-4000-8000-000000000099" not in result
    assert "00000000-0000-4000-8000-000000000100" not in result
    assert "00000000-0000-4000-8000-000000000101" not in result
    assert "Demo" not in result
    assert "203.0.113.42" not in result
    assert "2001:db8::42" not in result


@pytest.mark.parametrize(
    ("unsafe", "safe_fragment"),
    [
        (f"Bearer {CANARIES[0]}", REDACTED),
        (f"Basic {CANARIES[0]}", REDACTED),
        (f"Cookie: sid={CANARIES[2]}", f"Cookie: {REDACTED}"),
        (f"Set-Cookie={CANARIES[2]}", f"Cookie: {REDACTED}"),
        (f"https://Demo:{CANARIES[4]}@example.test/path", f"https://{REDACTED}@"),
        (f"token={CANARIES[0]}&page=2", f"token={REDACTED}&page=2"),
        (f"password: '{CANARIES[4]}'", f"password: {REDACTED}"),
        (f'{{"oauth_code":"{CANARIES[3]}"}}', REDACTED),
        (jwt_shape_canary(), REDACTED),
    ],
)
def test_free_text_credential_shapes_are_redacted(unsafe: str, safe_fragment: str) -> None:
    result = redact_text(unsafe)

    assert safe_fragment in result
    assert_no_canary(result)


def test_json_text_is_parsed_and_structurally_redacted() -> None:
    payload = json.dumps(
        {
            "status_code": 429,
            "token": CANARIES[0],
            "nested": {"message": f"Bearer {CANARIES[1]}"},
        }
    )

    result = sanitize_data(payload)
    decoded = json.loads(result)

    assert decoded == {"nested": {"message": REDACTED}, "status_code": 429}
    assert_no_canary(result)


def test_malformed_json_falls_back_to_bounded_text_redaction() -> None:
    result = sanitize_data(f'{{"token":"{CANARIES[0]}"')

    assert result == f'{{"token":{REDACTED}'
    assert_no_canary(result)


def test_self_referencing_mapping_is_replaced_with_cycle_marker() -> None:
    value: dict[str, object] = {"result": "ok"}
    value["self"] = value

    assert sanitize_data(value) == {"result": "ok", "self": CYCLE}


def test_self_referencing_list_is_replaced_with_cycle_marker() -> None:
    value: list[object] = ["first"]
    value.append(value)

    assert sanitize_data(value) == ["first", CYCLE]


def test_shared_non_recursive_container_is_sanitized_each_time() -> None:
    shared = {"result": "ok", "token": CANARIES[0]}

    assert sanitize_data({"left": shared, "right": shared}) == {
        "left": {"result": "ok"},
        "right": {"result": "ok"},
    }


def test_depth_budget_stops_hostile_nesting() -> None:
    value: object = "leaf"
    for _ in range(MAX_DEPTH + 5):
        value = {"nested": value}

    result = sanitize_data(value)
    encoded = serialized(result)

    assert TRUNCATED in encoded
    assert "leaf" not in encoded


def test_item_budget_stops_large_mapping() -> None:
    value = {f"field-{index}": index for index in range(MAX_ITEMS * 3)}

    result = sanitize_data(value)

    assert isinstance(result, dict)
    assert result["_truncated"] == TRUNCATED
    assert len(result) <= MAX_ITEMS + 1


def test_item_budget_is_global_across_nested_collections() -> None:
    value = {"groups": [[index] for index in range(MAX_ITEMS * 2)]}

    result = sanitize_data(value)
    encoded = serialized(result)

    assert TRUNCATED in encoded
    assert len(encoded) <= MAX_TOTAL_CHARS


@pytest.mark.parametrize("container_type", [set, frozenset])
def test_oversized_sets_are_marked_before_sort_key_or_item_traversal(
    container_type: type[set[int]] | type[frozenset[int]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sort_key_calls = 0

    def counted_sort_key(value: object) -> tuple[str, str]:
        nonlocal sort_key_calls
        sort_key_calls += 1
        return type(value).__name__, str(value)

    monkeypatch.setattr(redaction_module, "_repr_free_set_key", counted_sort_key)
    oversized = container_type(range(MAX_ITEMS + 1))

    assert sanitize_data(oversized) == [TRUNCATED]
    assert sort_key_calls == 0


@pytest.mark.parametrize(
    "value",
    [
        "999.999.999.999",
        "release 2026-08-20",
        "duration 15.250000 seconds",
        "request 00000000000040008000000000000009",
    ],
)
def test_non_identifier_numeric_shapes_are_preserved(value: str) -> None:
    assert redact_text(value) == value


def test_individual_string_is_bounded_after_redaction() -> None:
    value = "prefix " + ("x" * (MAX_STRING_CHARS * 2)) + f" token={CANARIES[0]}"

    result = sanitize_data(value)

    assert isinstance(result, str)
    assert len(result) <= MAX_STRING_CHARS
    assert result.endswith(TRUNCATED)
    assert_no_canary(result)


def test_json_input_scan_is_bounded_before_parsing() -> None:
    value = "[" + (" " * MAX_JSON_INPUT_CHARS) + f'"token={CANARIES[0]}"]'

    result = sanitize_data(value)

    assert isinstance(result, str)
    assert len(result) <= MAX_STRING_CHARS
    assert_no_canary(result)


def test_total_serialized_output_never_exceeds_global_budget() -> None:
    value = {f"field-{index}": "x" * MAX_STRING_CHARS for index in range(MAX_ITEMS)}

    encoded = serialize_redacted(value)

    assert len(encoded) <= MAX_TOTAL_CHARS
    assert json.loads(encoded) is not None


def test_safe_server_identifiers_are_preserved_only_when_valid() -> None:
    safe = sanitize_data(
        {
            "request_id": REQUEST_ID,
            "event_id": EVENT_ID,
            "status_code": 200,
            "error_code": "demo_failure",
        }
    )

    assert safe == {
        "request_id": REQUEST_ID,
        "event_id": str(EVENT_ID),
        "status_code": 200,
        "error_code": "demo_failure",
    }


@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("request_id", "external-correlation"),
        ("request_id", "A" * 32),
        ("request_id", CANARIES[0]),
        ("event_id", "not-a-uuid"),
        ("event_id", CANARIES[1]),
    ],
)
def test_invalid_safe_identifier_shapes_are_replaced(key: str, value: str) -> None:
    result = sanitize_data({key: value})

    assert result == {key: REDACTED}
    assert_no_canary(result)


class DemoState(StrEnum):
    READY = "ready"


class Unknown:
    pass


class ReprRaises:
    def __repr__(self) -> str:
        raise RuntimeError("representation must not be evaluated")


def test_supported_scalar_types_are_json_compatible() -> None:
    value = {
        "none": None,
        "truth": True,
        "count": 4,
        "ratio": 0.5,
        "identifier": EVENT_ID,
        "state_value": DemoState.READY,
        "day": date(2026, 8, 20),
        "instant": datetime(2026, 8, 20, 12, 30, tzinfo=UTC),
    }

    result = sanitize_data(value)

    assert result == {
        "none": None,
        "truth": True,
        "count": 4,
        "ratio": 0.5,
        "identifier": str(EVENT_ID),
        "state_value": "ready",
        "day": "2026-08-20",
        "instant": "2026-08-20T12:30:00+00:00",
    }
    json.dumps(result)


@pytest.mark.parametrize(
    ("value", "expected"),
    [(float("nan"), "<nan>"), (float("inf"), "<inf>"), (float("-inf"), "<-inf>")],
)
def test_non_finite_floats_become_explicit_markers(value: float, expected: str) -> None:
    assert sanitize_data(value) == expected


def test_unknown_objects_expose_only_their_type() -> None:
    value = Unknown()

    assert sanitize_data(value) == "<Unknown>"
    assert repr(value) not in serialized(sanitize_data(value))


def test_sets_are_deterministic_and_json_safe() -> None:
    value = {"values": frozenset({"b", "a", "c"})}

    assert sanitize_data(value) == {"values": ["a", "b", "c"]}
    assert serialize_redacted(value) == '{"values":["a","b","c"]}'


@pytest.mark.parametrize("container_type", [set, frozenset])
def test_set_ordering_never_invokes_unsafe_object_repr(
    container_type: type[set[object]] | type[frozenset[object]],
) -> None:
    first = ReprRaises()
    second = ReprRaises()
    value = container_type((first, second, "safe"))

    assert sanitize_data(value) == ["<ReprRaises>", "<ReprRaises>", "safe"]
    assert serialize_redacted(value) == '["<ReprRaises>","<ReprRaises>","safe"]'


def test_non_string_mapping_keys_are_normalized_without_repr() -> None:
    result = sanitize_data({42: "answer", EVENT_ID: "event", Unknown(): "unknown"})

    assert result == {
        "42": "answer",
        str(EVENT_ID).replace("-", "_"): "event",
        "unknown": "unknown",
    }


def test_sensitive_fields_are_omitted_instead_of_leaving_redacted_key_names() -> None:
    result = sanitize_data(
        {
            "token": CANARIES[0],
            "password": CANARIES[1],
            "status_code": 401,
        }
    )

    assert result == {"status_code": 401}
    assert "token" not in serialized(result)
    assert "password" not in serialized(result)


def test_serialization_is_compact_and_key_order_is_deterministic() -> None:
    value = {"zeta": 1, "alpha": 2, "middle": 3}

    assert serialize_redacted(value) == '{"alpha":2,"middle":3,"zeta":1}'
