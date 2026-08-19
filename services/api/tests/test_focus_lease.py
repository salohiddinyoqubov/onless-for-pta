"""Focused behavior and concurrency tests for the Redis focus lease."""

import asyncio
import time
import uuid
from collections.abc import Iterator

import fakeredis.aioredis
import pytest
from redis.exceptions import ConnectionError

from onless_api.focus_lease import (
    MAX_LEASE_SECONDS,
    FocusLease,
    FocusLeaseStatus,
)


@pytest.fixture
async def redis_client() -> fakeredis.aioredis.FakeRedis:
    client = fakeredis.aioredis.FakeRedis()
    yield client
    await client.aclose()


@pytest.fixture
def ids() -> Iterator[uuid.UUID]:
    return iter(uuid.uuid4() for _ in range(100))


@pytest.mark.asyncio
async def test_first_request_acquires_user_scoped_lease(
    redis_client: fakeredis.aioredis.FakeRedis,
    ids: Iterator[uuid.UUID],
) -> None:
    user_id, session_id, question_id = next(ids), next(ids), next(ids)

    result = await FocusLease(redis_client).acquire(
        user_id=user_id,
        session_id=session_id,
        question_id=question_id,
    )

    assert result.status is FocusLeaseStatus.ACQUIRED
    assert result.allowed is True
    assert result.acquired is True
    assert result.reopened is False
    assert result.remaining_seconds == 60
    assert result.bound_session_id == session_id
    assert result.bound_question_id == question_id


@pytest.mark.asyncio
async def test_same_binding_reopens_without_extending_expiry(
    redis_client: fakeredis.aioredis.FakeRedis,
    ids: Iterator[uuid.UUID],
) -> None:
    user_id, session_id, question_id = next(ids), next(ids), next(ids)
    lease = FocusLease(redis_client)
    first = await lease.acquire(
        user_id=user_id,
        session_id=session_id,
        question_id=question_id,
    )
    key = next(iter(await redis_client.keys("showcase:focus-lease:*")))
    ttl_before_reopen = await redis_client.pttl(key)
    await asyncio.sleep(0.02)

    reopened = await lease.acquire(
        user_id=user_id,
        session_id=session_id,
        question_id=question_id,
    )
    ttl_after_reopen = await redis_client.pttl(key)

    assert reopened.status is FocusLeaseStatus.REOPENED
    assert reopened.allowed is True
    assert reopened.expires_at == first.expires_at
    assert reopened.remaining_seconds <= first.remaining_seconds
    assert 0 < ttl_after_reopen <= ttl_before_reopen


@pytest.mark.asyncio
async def test_non_expiring_store_value_is_repaired_with_a_bounded_lease(
    redis_client: fakeredis.aioredis.FakeRedis,
    ids: Iterator[uuid.UUID],
) -> None:
    user_id, stored_session, stored_question = next(ids), next(ids), next(ids)
    key = f"showcase:focus-lease:{user_id}"
    stored_payload = f"{stored_session}|{stored_question}|{int(time.time()) + 60}"
    await redis_client.set(key, stored_payload)

    requested_session, requested_question = next(ids), next(ids)
    result = await FocusLease(redis_client).acquire(
        user_id=user_id,
        session_id=requested_session,
        question_id=requested_question,
    )

    assert result.status is FocusLeaseStatus.ACQUIRED
    assert result.allowed is True
    assert result.bound_session_id == requested_session
    assert result.bound_question_id == requested_question
    assert await redis_client.get(key) != stored_payload.encode()
    assert 0 < await redis_client.pttl(key) <= 60_000


@pytest.mark.asyncio
async def test_different_binding_is_blocked_with_current_context(
    redis_client: fakeredis.aioredis.FakeRedis,
    ids: Iterator[uuid.UUID],
) -> None:
    user_id, first_session, first_question = next(ids), next(ids), next(ids)
    lease = FocusLease(redis_client)
    await lease.acquire(
        user_id=user_id,
        session_id=first_session,
        question_id=first_question,
    )

    result = await lease.acquire(
        user_id=user_id,
        session_id=next(ids),
        question_id=next(ids),
    )

    assert result.status is FocusLeaseStatus.BLOCKED
    assert result.allowed is False
    assert result.bound_session_id == first_session
    assert result.bound_question_id == first_question
    assert 1 <= result.remaining_seconds <= 60


@pytest.mark.asyncio
async def test_users_have_independent_leases(
    redis_client: fakeredis.aioredis.FakeRedis,
    ids: Iterator[uuid.UUID],
) -> None:
    first_user, second_user = next(ids), next(ids)
    session_id, question_id = next(ids), next(ids)
    lease = FocusLease(redis_client)

    first, second = await asyncio.gather(
        lease.acquire(
            user_id=first_user,
            session_id=session_id,
            question_id=question_id,
        ),
        lease.acquire(
            user_id=second_user,
            session_id=session_id,
            question_id=question_id,
        ),
    )

    assert first.status is FocusLeaseStatus.ACQUIRED
    assert second.status is FocusLeaseStatus.ACQUIRED
    assert len(await redis_client.keys("showcase:focus-lease:*")) == 2


@pytest.mark.asyncio
async def test_expired_lease_can_be_acquired_by_a_new_binding(
    redis_client: fakeredis.aioredis.FakeRedis,
    ids: Iterator[uuid.UUID],
) -> None:
    user_id = next(ids)
    lease = FocusLease(redis_client)
    await lease.acquire(
        user_id=user_id,
        session_id=next(ids),
        question_id=next(ids),
    )
    key = next(iter(await redis_client.keys("showcase:focus-lease:*")))
    await redis_client.pexpire(key, 1)
    await asyncio.sleep(0.02)
    replacement_session, replacement_question = next(ids), next(ids)

    result = await lease.acquire(
        user_id=user_id,
        session_id=replacement_session,
        question_id=replacement_question,
    )

    assert result.status is FocusLeaseStatus.ACQUIRED
    assert result.bound_session_id == replacement_session
    assert result.bound_question_id == replacement_question


@pytest.mark.asyncio
async def test_concurrent_different_bindings_have_one_atomic_winner(
    redis_client: fakeredis.aioredis.FakeRedis,
    ids: Iterator[uuid.UUID],
) -> None:
    user_id = next(ids)
    lease = FocusLease(redis_client)

    results = await asyncio.gather(
        *(
            lease.acquire(
                user_id=user_id,
                session_id=next(ids),
                question_id=next(ids),
            )
            for _ in range(20)
        )
    )

    assert sum(result.status is FocusLeaseStatus.ACQUIRED for result in results) == 1
    assert sum(result.status is FocusLeaseStatus.BLOCKED for result in results) == 19
    winner = next(result for result in results if result.acquired)
    assert all(
        result.allowed or result.bound_question_id == winner.bound_question_id for result in results
    )


@pytest.mark.asyncio
async def test_concurrent_same_binding_has_one_acquire_and_reopens_the_rest(
    redis_client: fakeredis.aioredis.FakeRedis,
    ids: Iterator[uuid.UUID],
) -> None:
    user_id, session_id, question_id = next(ids), next(ids), next(ids)
    lease = FocusLease(redis_client)

    results = await asyncio.gather(
        *(
            lease.acquire(
                user_id=user_id,
                session_id=session_id,
                question_id=question_id,
            )
            for _ in range(12)
        )
    )

    assert sum(result.acquired for result in results) == 1
    assert sum(result.reopened for result in results) == 11
    assert len({result.expires_at for result in results}) == 1


@pytest.mark.parametrize("lease_seconds", [True, 0, -1, MAX_LEASE_SECONDS + 1, 1.5])
def test_lease_duration_is_strictly_bounded(lease_seconds: object) -> None:
    with pytest.raises(ValueError, match="lease_seconds"):
        FocusLease(OfflineRedis(), lease_seconds=lease_seconds)  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_store_outage_fails_open_with_typed_status(ids: Iterator[uuid.UUID]) -> None:
    result = await FocusLease(OfflineRedis()).acquire(
        user_id=next(ids),
        session_id=next(ids),
        question_id=next(ids),
    )

    assert result.status is FocusLeaseStatus.STORE_UNAVAILABLE
    assert result.allowed is True
    assert result.bound_question_id is None


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "response",
    [
        [],
        [0, 60],
        [False, 60, "payload"],
        [0, 0, "payload"],
        [0, 61, "payload"],
        [9, 60, "payload"],
        [0, 50, b"\xff"],
        [0, 50, "not-a-uuid|still-not-a-uuid|1"],
        [0, 50, f"{uuid.uuid4()}|{uuid.uuid4()}|-1"],
    ],
)
async def test_invalid_store_responses_fail_open(
    response: object,
    ids: Iterator[uuid.UUID],
) -> None:
    result = await FocusLease(ScriptedRedis(response)).acquire(
        user_id=next(ids),
        session_id=next(ids),
        question_id=next(ids),
    )

    assert result.status is FocusLeaseStatus.INVALID_STORE_RESPONSE
    assert result.allowed is True
    assert result.remaining_seconds == 0


@pytest.mark.asyncio
async def test_response_binding_must_agree_with_result_code(ids: Iterator[uuid.UUID]) -> None:
    user_id, session_id, question_id = next(ids), next(ids), next(ids)
    other_session, other_question = next(ids), next(ids)
    payload = f"{other_session}|{other_question}|{int(time.time()) + 50}"

    result = await FocusLease(ScriptedRedis([1, 50, payload])).acquire(
        user_id=user_id,
        session_id=session_id,
        question_id=question_id,
    )

    assert result.status is FocusLeaseStatus.INVALID_STORE_RESPONSE


@pytest.mark.asyncio
@pytest.mark.parametrize("code", [0, 2])
async def test_existing_lease_result_rejects_expiry_that_disagrees_with_ttl(
    code: int,
    ids: Iterator[uuid.UUID],
) -> None:
    user_id, requested_session, requested_question = next(ids), next(ids), next(ids)
    if code == 2:
        stored_session, stored_question = requested_session, requested_question
    else:
        stored_session, stored_question = next(ids), next(ids)
    payload = f"{stored_session}|{stored_question}|{int(time.time()) + 60}"

    result = await FocusLease(ScriptedRedis([code, 10, payload])).acquire(
        user_id=user_id,
        session_id=requested_session,
        question_id=requested_question,
    )

    assert result.status is FocusLeaseStatus.INVALID_STORE_RESPONSE


@pytest.mark.asyncio
@pytest.mark.parametrize("remaining_seconds, expiry_offset", [(59, 60), (60, 59)])
async def test_acquisition_result_must_match_requested_lease(
    remaining_seconds: int,
    expiry_offset: int,
    ids: Iterator[uuid.UUID],
) -> None:
    user_id, session_id, question_id = next(ids), next(ids), next(ids)
    payload = f"{session_id}|{question_id}|{int(time.time()) + expiry_offset}"

    result = await FocusLease(ScriptedRedis([1, remaining_seconds, payload])).acquire(
        user_id=user_id,
        session_id=session_id,
        question_id=question_id,
    )

    assert result.status is FocusLeaseStatus.INVALID_STORE_RESPONSE


class OfflineRedis:
    async def eval(self, script: str, numkeys: int, *keys_and_args: str) -> object:
        del script, numkeys, keys_and_args
        raise ConnectionError("connection unavailable")


class ScriptedRedis:
    def __init__(self, response: object) -> None:
        self._response = response

    async def eval(self, script: str, numkeys: int, *keys_and_args: str) -> object:
        del script, numkeys, keys_and_args
        return self._response
