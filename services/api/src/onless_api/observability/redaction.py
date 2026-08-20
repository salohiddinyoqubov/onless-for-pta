"""Cycle-safe, size-bounded redaction for structured diagnostic fields.

The boundary is deliberately conservative. Sensitive mappings are omitted, text
is scanned for common credential representations, unknown objects become type
markers, and hostile containers cannot exhaust recursion or output budgets.
"""

from __future__ import annotations

import ipaddress
import json
import math
import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import date, datetime
from enum import Enum
from typing import Any
from uuid import UUID

REDACTED = "[REDACTED]"
TRUNCATED = "[TRUNCATED]"
CYCLE = "[CYCLE]"

MAX_DEPTH = 8
MAX_ITEMS = 128
MAX_STRING_CHARS = 4_096
MAX_TOTAL_CHARS = 16_384
MAX_JSON_INPUT_CHARS = 8_192

_SAFE_EXACT_KEYS = frozenset({"error_code", "event_id", "request_id", "status_code"})
_SENSITIVE_EXACT_KEYS = frozenset(
    {
        "auth",
        "account_id",
        "authorization",
        "body",
        "challenge",
        "code",
        "cookie",
        "cookies",
        "credential",
        "email",
        "full_name",
        "headers",
        "input",
        "ip_address",
        "key",
        "password",
        "payload",
        "phone",
        "phone_number",
        "pin",
        "profile_id",
        "secret",
        "session",
        "state",
        "token",
        "user_id",
    }
)
_SENSITIVE_PARTS = (
    "api_key",
    "account_id",
    "accountid",
    "apikey",
    "auth_header",
    "authorization",
    "client_secret",
    "code_verifier",
    "cookie",
    "credential",
    "email",
    "full_name",
    "fullname",
    "csrf",
    "id_token",
    "ip_address",
    "ipaddress",
    "magic_link",
    "oauth_code",
    "otp",
    "passcode",
    "password",
    "phone",
    "phone_number",
    "profile_id",
    "profileid",
    "refresh_token",
    "reset_code",
    "reset_link",
    "reset_token",
    "secret",
    "session_token",
    "telegram_hash",
    "user_id",
    "userid",
    "verification_code",
)
_SECRET_SEGMENTS = frozenset(
    {
        "auth",
        "code",
        "cookie",
        "credential",
        "email",
        "key",
        "password",
        "payload",
        "phone",
        "secret",
        "session",
        "token",
        "user",
    }
)

_AUTH_SCHEME_PATTERN = re.compile(r"(?i)\b(?:basic|bearer)\s+[^\s,;]+")
_COOKIE_PATTERN = re.compile(r"(?i)\b(?:set-cookie|cookie)\s*[:=]\s*[^\r\n]+")
_URL_USERINFO_PATTERN = re.compile(r"(?i)\b([a-z][a-z0-9+.-]*://)([^/@\s]+)@")
_SECRET_ASSIGNMENT_PATTERN = re.compile(
    r"""(?ix)
    (?P<prefix>(?:^|[?&;,\s{]))
    (?P<quote>["']?)
    (?P<key>[a-z0-9_.\[\]-]*(?:token|code|auth|password|secret|key|session|cookie|email|phone|user_?id)
        [a-z0-9_.\[\]-]*)
    (?P=quote)
    (?P<separator>\s*[:=]\s*)
    (?P<value>"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^&\s;,}]+)
    """
)
_DIRECT_IDENTIFIER_ASSIGNMENT_PATTERN = re.compile(
    r"""(?ix)
    (?P<prefix>(?:^|[?&;,\s{]))
    (?P<quote>["']?)
    (?P<key>[a-z0-9_.\[\]-]*(?:
        account_?id|profile_?id|full_?name|ip_?address|email|phone|user_?id
    )[a-z0-9_.\[\]-]*)
    (?P=quote)
    (?P<separator>\s*[:=]\s*)
    (?P<value>"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^&;,\r\n}]+)
    """
)
_JWT_PATTERN = re.compile(
    r"(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}"
    r"(?![A-Za-z0-9_-])"
)
_EMAIL_PATTERN = re.compile(
    r"(?i)(?<![a-z0-9.!#$%&'*+/=?^_`{|}~-])"
    r"[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+"
    r"(?![a-z0-9-])"
)
_PHONE_PATTERN = re.compile(r"(?<![a-z0-9])\+?\d(?:[\d() -]{5,}\d)(?![a-z0-9])", re.I)
_ISO_DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_IPV4_PATTERN = re.compile(r"(?<![a-z0-9])(?:\d{1,3}\.){3}\d{1,3}(?![a-z0-9])", re.I)
_IPV6_PATTERN = re.compile(r"(?i)(?<![a-z0-9:])(?:[0-9a-f]*:){2,7}[0-9a-f]+(?![a-z0-9:])")


@dataclass(slots=True)
class _Budget:
    items_left: int = MAX_ITEMS
    chars_left: int = MAX_TOTAL_CHARS
    active_ids: set[int] = field(default_factory=set)

    def claim_item(self) -> bool:
        if self.items_left <= 0:
            return False
        self.items_left -= 1
        return True

    def bound_text(self, value: str) -> str:
        allowed = min(MAX_STRING_CHARS, max(self.chars_left, 0))
        if len(value) <= allowed:
            self.chars_left -= len(value)
            return value
        self.chars_left = 0
        if allowed <= len(TRUNCATED):
            return TRUNCATED
        return value[: allowed - len(TRUNCATED)] + TRUNCATED


def _normalize_key(key: object) -> str:
    if isinstance(key, Enum):
        key = key.value
    if not isinstance(key, (str, int, float, bool, UUID)):
        return type(key).__name__.lower()
    bounded = str(key)[:MAX_STRING_CHARS]
    return re.sub(r"[^a-z0-9]+", "_", bounded.strip().lower()).strip("_")


def is_sensitive_key(key: object) -> bool:
    """Return whether a field name can identify or contain a credential."""
    normalized = _normalize_key(key)
    if normalized in _SAFE_EXACT_KEYS:
        return False
    if normalized in _SENSITIVE_EXACT_KEYS:
        return True
    segments = frozenset(part for part in normalized.split("_") if part)
    if segments & _SECRET_SEGMENTS:
        return True
    compact = normalized.replace("_", "")
    if any(compact.endswith(alias) for alias in _SECRET_SEGMENTS):
        return True
    return any(part in normalized or part.replace("_", "") in compact for part in _SENSITIVE_PARTS)


def _redact_assignment(match: re.Match[str]) -> str:
    if not is_sensitive_key(match.group("key")):
        return match.group(0)
    return (
        f"{match.group('prefix')}{match.group('quote')}{match.group('key')}"
        f"{match.group('quote')}{match.group('separator')}{REDACTED}"
    )


def redact_text(value: str) -> str:
    """Remove common credentials and direct identifiers from free text."""
    redacted = _AUTH_SCHEME_PATTERN.sub(REDACTED, value)
    redacted = _COOKIE_PATTERN.sub(f"Cookie: {REDACTED}", redacted)
    redacted = _URL_USERINFO_PATTERN.sub(rf"\1{REDACTED}@", redacted)
    redacted = _DIRECT_IDENTIFIER_ASSIGNMENT_PATTERN.sub(_redact_assignment, redacted)
    redacted = _SECRET_ASSIGNMENT_PATTERN.sub(_redact_assignment, redacted)
    redacted = _JWT_PATTERN.sub(REDACTED, redacted)
    redacted = _EMAIL_PATTERN.sub(REDACTED, redacted)
    redacted = _PHONE_PATTERN.sub(_redact_phone_candidate, redacted)
    redacted = _IPV4_PATTERN.sub(_redact_ip_candidate, redacted)
    return _IPV6_PATTERN.sub(_redact_ip_candidate, redacted)


def _redact_phone_candidate(match: re.Match[str]) -> str:
    candidate = match.group(0)
    digit_count = sum(character.isdigit() for character in candidate)
    if not 7 <= digit_count <= 15 or _ISO_DATE_PATTERN.fullmatch(candidate):
        return candidate
    return REDACTED


def _redact_ip_candidate(match: re.Match[str]) -> str:
    candidate = match.group(0)
    try:
        ipaddress.ip_address(candidate)
    except ValueError:
        return candidate
    return REDACTED


def _repr_free_set_key(value: object) -> tuple[str, str]:
    """Build a deterministic ordering key without invoking object representations."""
    sanitized = _sanitize(value, depth=0, budget=_Budget())
    encoded = json.dumps(sanitized, separators=(",", ":"), sort_keys=True)
    return type(value).__name__, encoded


def _valid_safe_identifier(key: str, value: object) -> bool:
    if key == "request_id":
        return (
            isinstance(value, str)
            and len(value) == 32
            and all(character in "0123456789abcdef" for character in value)
        )
    if key == "event_id":
        try:
            UUID(str(value))
        except (ValueError, TypeError, AttributeError):
            return False
    return True


def _sanitize(value: Any, *, depth: int, budget: _Budget) -> Any:
    if depth > MAX_DEPTH or not budget.claim_item():
        return TRUNCATED

    if isinstance(value, str):
        bounded_input = value[:MAX_JSON_INPUT_CHARS]
        if bounded_input.lstrip().startswith(("{", "[")):
            try:
                decoded = json.loads(bounded_input)
            except (json.JSONDecodeError, TypeError, ValueError, RecursionError):
                pass
            else:
                nested = _sanitize(decoded, depth=depth + 1, budget=budget)
                return budget.bound_text(json.dumps(nested, separators=(",", ":"), sort_keys=True))
        return budget.bound_text(redact_text(bounded_input))

    if value is None or isinstance(value, (bool, int)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else f"<{str(value).lower()}>"
    if isinstance(value, UUID):
        return budget.bound_text(str(value))
    if isinstance(value, Enum):
        return _sanitize(value.value, depth=depth + 1, budget=budget)
    if isinstance(value, (datetime, date)):
        return budget.bound_text(value.isoformat())

    if isinstance(value, (Mapping, list, tuple, set, frozenset)):
        if isinstance(value, (set, frozenset)) and len(value) > min(MAX_ITEMS, budget.items_left):
            return [TRUNCATED]
        object_id = id(value)
        if object_id in budget.active_ids:
            return CYCLE
        budget.active_ids.add(object_id)
        try:
            if isinstance(value, Mapping):
                result: dict[str, Any] = {}
                for index, (key, item) in enumerate(value.items()):
                    if index >= MAX_ITEMS or budget.items_left <= 0:
                        result["_truncated"] = TRUNCATED
                        break
                    if is_sensitive_key(key):
                        continue
                    normalized = _normalize_key(key) or "field"
                    safe_key = budget.bound_text(normalized)
                    if safe_key in _SAFE_EXACT_KEYS and not _valid_safe_identifier(safe_key, item):
                        result[safe_key] = REDACTED
                    else:
                        result[safe_key] = _sanitize(item, depth=depth + 1, budget=budget)
                return result

            result_list: list[Any] = []
            iterable = value
            if isinstance(value, (set, frozenset)):
                iterable = sorted(value, key=_repr_free_set_key)
            for index, item in enumerate(iterable):
                if index >= MAX_ITEMS or budget.items_left <= 0:
                    result_list.append(TRUNCATED)
                    break
                result_list.append(_sanitize(item, depth=depth + 1, budget=budget))
            return result_list
        finally:
            budget.active_ids.discard(object_id)

    return f"<{type(value).__name__}>"


def sanitize_data(value: Any) -> Any:
    """Return a bounded, cycle-safe and JSON-compatible representation."""
    sanitized = _sanitize(value, depth=0, budget=_Budget())
    if len(json.dumps(sanitized, separators=(",", ":"), sort_keys=True)) > MAX_TOTAL_CHARS:
        return {"_truncated": TRUNCATED}
    return sanitized


def serialize_redacted(value: Any) -> str:
    """Serialize sanitized data with a strict total-character upper bound."""
    encoded = json.dumps(sanitize_data(value), separators=(",", ":"), sort_keys=True)
    if len(encoded) <= MAX_TOTAL_CHARS:
        return encoded
    return json.dumps({"_truncated": TRUNCATED}, separators=(",", ":"))
