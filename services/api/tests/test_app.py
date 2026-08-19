"""HTTP boundary tests using injected Redis fakes."""

import time
from uuid import uuid4

from fastapi.testclient import TestClient
from redis.exceptions import ConnectionError

from onless_api.app import Settings, create_app


class HealthyRedis:
    def __init__(self) -> None:
        self.closed = False

    async def ping(self) -> bool:
        return True

    async def aclose(self) -> None:
        self.closed = True

    async def eval(self, script: str, numkeys: int, *keys_and_args: str) -> object:
        del script, numkeys
        payload = keys_and_args[1]
        lease_seconds = int(keys_and_args[3])
        return [1, lease_seconds, payload]


class OfflineRedis(HealthyRedis):
    async def ping(self) -> bool:
        raise ConnectionError("not available")


def test_liveness_does_not_require_redis() -> None:
    redis = OfflineRedis()

    with TestClient(create_app(redis_factory=lambda settings: redis)) as client:
        response = client.get("/health/live")

    assert response.status_code == 200
    assert response.json() == {"status": "alive"}
    assert redis.closed is True


def test_health_alias_matches_liveness_contract() -> None:
    with TestClient(create_app(redis_factory=lambda settings: HealthyRedis())) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "alive"}


def test_interactive_documentation_is_available() -> None:
    with TestClient(create_app(redis_factory=lambda settings: HealthyRedis())) as client:
        response = client.get("/docs")
        schema = client.get("/openapi.json")

    assert response.status_code == 200
    assert "Onless Showcase API" in response.text
    assert schema.status_code == 200
    assert schema.json()["info"]["title"] == "Onless Showcase API"


def test_readiness_reports_available_redis() -> None:
    with TestClient(create_app(redis_factory=lambda settings: HealthyRedis())) as client:
        response = client.get("/health/ready")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ready",
        "dependencies": {"redis": {"status": "available"}},
    }


def test_readiness_returns_503_without_leaking_connection_details() -> None:
    settings = Settings(redis_url="redis://example.invalid:6379/0")

    with TestClient(
        create_app(settings, redis_factory=lambda configured_settings: OfflineRedis())
    ) as client:
        response = client.get("/health/ready")

    assert response.status_code == 503
    assert response.json() == {
        "status": "not_ready",
        "dependencies": {"redis": {"status": "unavailable"}},
    }
    assert "example.invalid" not in response.text


def test_focus_lease_endpoint_projects_typed_atomic_result() -> None:
    redis = HealthyRedis()
    request = {
        "user_id": str(uuid4()),
        "session_id": str(uuid4()),
        "question_id": str(uuid4()),
    }

    with TestClient(create_app(redis_factory=lambda settings: redis)) as client:
        response = client.post("/focus-leases/acquire", json=request)

    assert response.status_code == 200
    assert response.json() == {
        "status": "acquired",
        "allowed": True,
        "acquired": True,
        "reopened": False,
        "remaining_seconds": 60,
        "expires_at": response.json()["expires_at"],
    }
    assert abs(response.json()["expires_at"] - (int(time.time()) + 60)) <= 1


def test_focus_lease_rejects_extra_input_fields() -> None:
    request = {
        "user_id": str(uuid4()),
        "session_id": str(uuid4()),
        "question_id": str(uuid4()),
        "unexpected": "value",
    }

    with TestClient(create_app(redis_factory=lambda settings: HealthyRedis())) as client:
        response = client.post("/focus-leases/acquire", json=request)

    assert response.status_code == 422
