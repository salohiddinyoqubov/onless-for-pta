"""Composition root for the public, synthetic Onless showcase API."""

from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel, ConfigDict

from onless_api.learning.routes import router as learning_router
from onless_api.observability.request_id import RequestIdMiddleware


class HealthResponse(BaseModel):
    """Process health without internal dependency or topology details."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    status: Literal["alive", "ready"]


def create_app() -> FastAPI:
    """Build the stateless showcase application."""
    application = FastAPI(
        title="Onless Showcase API",
        version="1.0.0",
        docs_url=None,
        redoc_url=None,
    )
    application.add_middleware(RequestIdMiddleware)
    application.include_router(learning_router)

    @application.get("/health", response_model=HealthResponse, include_in_schema=False)
    @application.get("/health/live", response_model=HealthResponse)
    async def liveness() -> HealthResponse:
        return HealthResponse(status="alive")

    @application.get("/health/ready", response_model=HealthResponse)
    async def readiness() -> HealthResponse:
        return HealthResponse(status="ready")

    return application


app = create_app()
