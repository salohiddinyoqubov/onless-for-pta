"""Typed construction of bounded, redacted diagnostic events.

This module is intentionally a narrow output boundary rather than a general
logging framework. Callers provide an event category and optional diagnostic
fields; the encoder owns correlation, timestamps, validation, redaction, and
serialization. It never accepts a caller-supplied request identifier.
"""

from __future__ import annotations

import json
import logging
import math
import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any, Self

from onless_api.observability.redaction import sanitize_data, serialize_redacted
from onless_api.observability.request_id import get_current_request_id

MAX_EVENT_NAME_CHARS = 64
MAX_DURATION_MS = 86_400_000.0
_EVENT_NAME_PATTERN = re.compile(r"^[a-z][a-z0-9]*(?:[._][a-z0-9]+)*$")


class DiagnosticLevel(StrEnum):
    """Supported event severities with an explicit logging-level mapping."""

    INFO = "info"
    WARNING = "warning"
    ERROR = "error"

    @property
    def logging_level(self) -> int:
        return {
            DiagnosticLevel.INFO: logging.INFO,
            DiagnosticLevel.WARNING: logging.WARNING,
            DiagnosticLevel.ERROR: logging.ERROR,
        }[self]


class InvalidDiagnosticEvent(ValueError):
    """Raised when event metadata violates the public diagnostic contract."""


@dataclass(frozen=True, slots=True, init=False)
class DiagnosticEvent:
    """Validated event with details stored as immutable canonical JSON."""

    name: str
    level: DiagnosticLevel
    occurred_at: datetime
    request_id: str | None
    status_code: int | None
    duration_ms: float | None
    _details_json: str

    def __init__(self) -> None:
        raise TypeError("DiagnosticEvent instances must be built by DiagnosticEventEncoder")

    @classmethod
    def _from_safe_fields(
        cls,
        *,
        name: str,
        level: DiagnosticLevel,
        occurred_at: datetime,
        status_code: int | None,
        duration_ms: float | None,
        details_json: str,
    ) -> Self:
        """Create an event while sourcing correlation exclusively from context."""
        instance = object.__new__(cls)
        object.__setattr__(instance, "name", name)
        object.__setattr__(instance, "level", level)
        object.__setattr__(instance, "occurred_at", occurred_at)
        object.__setattr__(instance, "request_id", get_current_request_id())
        object.__setattr__(instance, "status_code", status_code)
        object.__setattr__(instance, "duration_ms", duration_ms)
        object.__setattr__(instance, "_details_json", details_json)
        return instance

    @property
    def details(self) -> Mapping[str, Any]:
        """Return a fresh details tree that cannot mutate the stored event."""
        decoded = json.loads(self._details_json)
        if not isinstance(decoded, dict):
            raise RuntimeError("canonical diagnostic details must decode to an object")
        return decoded

    def as_dict(self) -> dict[str, Any]:
        """Return the stable wire representation with absent metadata omitted."""
        result: dict[str, Any] = {
            "event": self.name,
            "level": self.level.value,
            "occurred_at": self.occurred_at.astimezone(UTC).isoformat(),
            "details": dict(self.details),
        }
        if self.request_id is not None:
            result["request_id"] = self.request_id
        if self.status_code is not None:
            result["status_code"] = self.status_code
        if self.duration_ms is not None:
            result["duration_ms"] = self.duration_ms
        return result


EventClock = Callable[[], datetime]


def utc_now() -> datetime:
    """Return a timezone-aware timestamp; isolated for deterministic injection."""
    return datetime.now(UTC)


class DiagnosticEventEncoder:
    """Validate and serialize safe diagnostic events.

    The encoder deliberately reads request correlation from trusted context. A
    details mapping containing ``request_id`` has that reserved field removed at
    every depth. Only trusted request context can populate envelope correlation.
    """

    def __init__(self, *, clock: EventClock = utc_now) -> None:
        self._clock = clock

    def build(
        self,
        name: str,
        *,
        level: DiagnosticLevel = DiagnosticLevel.INFO,
        details: Mapping[object, object] | None = None,
        status_code: int | None = None,
        duration_ms: float | int | None = None,
    ) -> DiagnosticEvent:
        """Build an immutable event after validating all envelope metadata."""
        safe_name = self._validate_name(name)
        safe_level = self._validate_level(level)
        safe_status = self._validate_status_code(status_code)
        safe_duration = self._validate_duration(duration_ms)
        occurred_at = self._validate_timestamp(self._clock())
        safe_details_json = self._sanitize_details(details)
        return DiagnosticEvent._from_safe_fields(
            name=safe_name,
            level=safe_level,
            occurred_at=occurred_at,
            status_code=safe_status,
            duration_ms=safe_duration,
            details_json=safe_details_json,
        )

    def encode(
        self,
        name: str,
        *,
        level: DiagnosticLevel = DiagnosticLevel.INFO,
        details: Mapping[object, object] | None = None,
        status_code: int | None = None,
        duration_ms: float | int | None = None,
    ) -> str:
        """Build and serialize an event through the global output budget."""
        event = self.build(
            name,
            level=level,
            details=details,
            status_code=status_code,
            duration_ms=duration_ms,
        )
        return serialize_redacted(event.as_dict())

    def emit(
        self,
        logger: logging.Logger,
        name: str,
        *,
        level: DiagnosticLevel = DiagnosticLevel.INFO,
        details: Mapping[object, object] | None = None,
        status_code: int | None = None,
        duration_ms: float | int | None = None,
    ) -> None:
        """Write one already-redacted JSON event at its declared severity."""
        encoded = self.encode(
            name,
            level=level,
            details=details,
            status_code=status_code,
            duration_ms=duration_ms,
        )
        logger.log(level.logging_level, encoded)

    @staticmethod
    def _validate_name(value: object) -> str:
        if not isinstance(value, str):
            raise InvalidDiagnosticEvent("event name must be text")
        if not 1 <= len(value) <= MAX_EVENT_NAME_CHARS:
            raise InvalidDiagnosticEvent("event name length is outside the allowed range")
        if _EVENT_NAME_PATTERN.fullmatch(value) is None:
            raise InvalidDiagnosticEvent("event name must use lowercase dot or underscore notation")
        return value

    @staticmethod
    def _validate_level(value: object) -> DiagnosticLevel:
        if not isinstance(value, DiagnosticLevel):
            raise InvalidDiagnosticEvent("event level must be a DiagnosticLevel")
        return value

    @staticmethod
    def _validate_status_code(value: object) -> int | None:
        if value is None:
            return None
        if isinstance(value, bool) or not isinstance(value, int) or not 100 <= value <= 599:
            raise InvalidDiagnosticEvent("status code must be an integer from 100 to 599")
        return value

    @staticmethod
    def _validate_duration(value: object) -> float | None:
        if value is None:
            return None
        if isinstance(value, bool) or not isinstance(value, (float, int)):
            raise InvalidDiagnosticEvent("duration must be a finite number of milliseconds")
        duration = float(value)
        if not math.isfinite(duration) or not 0 <= duration <= MAX_DURATION_MS:
            raise InvalidDiagnosticEvent("duration must be within the diagnostic time budget")
        return duration

    @staticmethod
    def _validate_timestamp(value: object) -> datetime:
        if not isinstance(value, datetime) or value.tzinfo is None:
            raise InvalidDiagnosticEvent("event clock must return a timezone-aware datetime")
        return value.astimezone(UTC)

    @staticmethod
    def _sanitize_details(value: Mapping[object, object] | None) -> str:
        if value is None:
            return "{}"
        if not isinstance(value, Mapping):
            raise InvalidDiagnosticEvent("event details must be a mapping")
        sanitized = sanitize_data(value)
        if not isinstance(sanitized, Mapping):
            raise InvalidDiagnosticEvent("event details could not be represented as a mapping")
        without_reserved_ids = _strip_reserved_request_ids(sanitized)
        return json.dumps(without_reserved_ids, separators=(",", ":"), sort_keys=True)


def _strip_reserved_request_ids(value: Any) -> Any:
    """Remove normalized request-ID fields from any JSON-compatible details tree."""
    if isinstance(value, Mapping):
        return {
            str(key): _strip_reserved_request_ids(item)
            for key, item in value.items()
            if str(key) != "request_id"
        }
    if isinstance(value, list):
        return [_strip_reserved_request_ids(item) for item in value]
    if isinstance(value, str) and value.lstrip().startswith(("{", "[")):
        try:
            decoded = json.loads(value)
        except (json.JSONDecodeError, TypeError, ValueError, RecursionError):
            return value
        stripped = _strip_reserved_request_ids(decoded)
        return json.dumps(stripped, separators=(",", ":"), sort_keys=True)
    return value
