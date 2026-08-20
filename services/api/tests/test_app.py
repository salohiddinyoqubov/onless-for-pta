"""HTTP composition and exposure-boundary tests."""

import httpx
import pytest

from onless_api.app import create_app


@pytest.mark.asyncio
async def test_liveness_is_stateless() -> None:
    transport = httpx.ASGITransport(app=create_app())
    async with httpx.AsyncClient(transport=transport, base_url="http://example.test") as client:
        response = await client.get("/health/live")

    assert response.status_code == 200
    assert response.json() == {"status": "alive"}
    assert len(response.headers["X-Request-ID"]) == 32


@pytest.mark.asyncio
async def test_health_alias_matches_liveness_contract() -> None:
    transport = httpx.ASGITransport(app=create_app())
    async with httpx.AsyncClient(transport=transport, base_url="http://example.test") as client:
        response = await client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "alive"}


@pytest.mark.asyncio
async def test_readiness_has_no_external_dependency_contract() -> None:
    transport = httpx.ASGITransport(app=create_app())
    async with httpx.AsyncClient(transport=transport, base_url="http://example.test") as client:
        response = await client.get("/health/ready")

    assert response.status_code == 200
    assert response.json() == {"status": "ready"}


@pytest.mark.asyncio
async def test_interactive_documentation_is_disabled_to_avoid_external_assets() -> None:
    transport = httpx.ASGITransport(app=create_app())
    async with httpx.AsyncClient(transport=transport, base_url="http://example.test") as client:
        swagger = await client.get("/docs")
        redoc = await client.get("/redoc")
        schema = await client.get("/openapi.json")

    assert swagger.status_code == 404
    assert redoc.status_code == 404
    assert schema.status_code == 200
    assert schema.json()["info"] == {
        "title": "Onless Showcase API",
        "version": "1.0.0",
    }


def test_openapi_exposes_only_health_and_synthetic_demo_routes() -> None:
    schema = create_app().openapi()

    assert set(schema["paths"]) == {
        "/demo/learning-roadmap",
        "/health/live",
        "/health/ready",
    }
    assert all(set(operations) <= {"get"} for operations in schema["paths"].values())
