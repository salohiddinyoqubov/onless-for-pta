"""Atomic, user-scoped focus leases backed by Redis."""

import logging
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

from redis.exceptions import RedisError

logger = logging.getLogger(__name__)

DEFAULT_LEASE_SECONDS = 60
MAX_LEASE_SECONDS = 300
_EXPIRY_CLOCK_SKEW_SECONDS = 5
_KEY_PREFIX = "showcase:focus-lease"

# The compare and write happen in one Redis operation. Reopening the same binding
# deliberately leaves the original value and expiry unchanged.
_COMPARE_OR_CREATE_LUA = """
local current = redis.call('GET', KEYS[1])
if not current then
    redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])
    return {1, tonumber(ARGV[3]), ARGV[1]}
end

local pttl = redis.call('PTTL', KEYS[1])
if pttl < 0 then
    redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])
    return {1, tonumber(ARGV[3]), ARGV[1]}
end

local ttl = math.max(1, math.ceil(pttl / 1000))
local marker = ARGV[2] .. '|'
if string.sub(current, 1, string.len(marker)) == marker then
    return {2, ttl, current}
end

return {0, ttl, current}
"""


class RedisEvalPort(Protocol):
    """Minimum async Redis capability required by :class:`FocusLease`."""

    async def eval(self, script: str, numkeys: int, *keys_and_args: str) -> object: ...


class FocusLeaseStatus(StrEnum):
    """Outcome of an atomic focus-lease request."""

    ACQUIRED = "acquired"
    REOPENED = "reopened"
    BLOCKED = "blocked"
    STORE_UNAVAILABLE = "store_unavailable"
    INVALID_STORE_RESPONSE = "invalid_store_response"


@dataclass(frozen=True, slots=True)
class FocusLeaseResult:
    """Validated result returned to the application boundary."""

    status: FocusLeaseStatus
    remaining_seconds: int = 0
    bound_session_id: uuid.UUID | None = None
    bound_question_id: uuid.UUID | None = None
    expires_at: int | None = None

    @property
    def allowed(self) -> bool:
        """Return whether content access may proceed."""
        return self.status is not FocusLeaseStatus.BLOCKED

    @property
    def acquired(self) -> bool:
        """Return whether this request created the lease."""
        return self.status is FocusLeaseStatus.ACQUIRED

    @property
    def reopened(self) -> bool:
        """Return whether this request matched the existing lease."""
        return self.status is FocusLeaseStatus.REOPENED


class FocusLease:
    """Atomically bind one user's focus window to one session question."""

    def __init__(
        self,
        redis: RedisEvalPort,
        *,
        lease_seconds: int = DEFAULT_LEASE_SECONDS,
        clock: Callable[[], float] = time.time,
    ) -> None:
        if (
            isinstance(lease_seconds, bool)
            or not isinstance(lease_seconds, int)
            or not 1 <= lease_seconds <= MAX_LEASE_SECONDS
        ):
            raise ValueError(f"lease_seconds must be an integer from 1 to {MAX_LEASE_SECONDS}")
        self._redis = redis
        self._lease_seconds = lease_seconds
        self._clock = clock

    async def acquire(
        self,
        *,
        user_id: uuid.UUID,
        session_id: uuid.UUID,
        question_id: uuid.UUID,
    ) -> FocusLeaseResult:
        """Create, reopen, or reject a lease without extending an existing one.

        Store outages and malformed store responses fail open, but have distinct
        statuses so callers can record and monitor degraded enforcement.
        """
        expires_at = int(self._clock()) + self._lease_seconds
        binding = f"{session_id}|{question_id}"
        payload = f"{binding}|{expires_at}"

        try:
            raw_result = await self._redis.eval(
                _COMPARE_OR_CREATE_LUA,
                1,
                self._key(user_id),
                payload,
                binding,
                str(self._lease_seconds),
            )
        except RedisError:
            logger.exception("Focus lease store unavailable")
            return FocusLeaseResult(status=FocusLeaseStatus.STORE_UNAVAILABLE)

        try:
            code, remaining_seconds, stored_payload = self._parse_triplet(raw_result)
            validation_time = int(self._clock())
            bound_session_id, bound_question_id, bound_expiry = self._parse_payload(
                stored_payload,
                now=validation_time,
            )
            same_binding = bound_session_id == session_id and bound_question_id == question_id
            if (code in {1, 2}) != same_binding:
                raise ValueError("Redis result contradicts the stored binding")
            if code == 1:
                if remaining_seconds != self._lease_seconds or bound_expiry != expires_at:
                    raise ValueError("Redis acquisition result contradicts the requested lease")
            else:
                expected_expiry = validation_time + remaining_seconds
                if abs(bound_expiry - expected_expiry) > _EXPIRY_CLOCK_SKEW_SECONDS + 1:
                    raise ValueError("Redis payload expiry contradicts its TTL")

            status = {
                0: FocusLeaseStatus.BLOCKED,
                1: FocusLeaseStatus.ACQUIRED,
                2: FocusLeaseStatus.REOPENED,
            }[code]
            return FocusLeaseResult(
                status=status,
                remaining_seconds=remaining_seconds,
                bound_session_id=bound_session_id,
                bound_question_id=bound_question_id,
                expires_at=bound_expiry,
            )
        except (KeyError, TypeError, ValueError, UnicodeError):
            logger.exception("Focus lease store returned invalid data")
            return FocusLeaseResult(status=FocusLeaseStatus.INVALID_STORE_RESPONSE)

    @staticmethod
    def _key(user_id: uuid.UUID) -> str:
        return f"{_KEY_PREFIX}:{user_id}"

    def _parse_triplet(self, value: object) -> tuple[int, int, object]:
        if not isinstance(value, (list, tuple)) or len(value) != 3:
            raise ValueError("Redis result must contain exactly three fields")
        raw_code, raw_ttl, payload = value
        if not isinstance(raw_code, int) or isinstance(raw_code, bool):
            raise TypeError("Redis result code must be an integer")
        if raw_code not in {0, 1, 2}:
            raise ValueError("Redis result code is unknown")
        if not isinstance(raw_ttl, int) or isinstance(raw_ttl, bool):
            raise TypeError("Redis result TTL must be an integer")
        if not 1 <= raw_ttl <= self._lease_seconds:
            raise ValueError("Redis result TTL is outside the configured lease duration")
        return raw_code, raw_ttl, payload

    def _parse_payload(self, value: object, *, now: int) -> tuple[uuid.UUID, uuid.UUID, int]:
        if isinstance(value, bytes):
            raw = value.decode("utf-8")
        elif isinstance(value, str):
            raw = value
        else:
            raise TypeError("Redis payload must be text")

        parts = raw.split("|")
        if len(parts) != 3:
            raise ValueError("Redis payload must contain exactly three fields")
        session_id = uuid.UUID(parts[0])
        question_id = uuid.UUID(parts[1])
        expires_at = int(parts[2])
        if not (
            now - _EXPIRY_CLOCK_SKEW_SECONDS
            <= expires_at
            <= now + self._lease_seconds + _EXPIRY_CLOCK_SKEW_SECONDS
        ):
            raise ValueError("Redis payload expiry is outside the lease horizon")
        return session_id, question_id, expires_at
