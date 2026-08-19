"""Small FastAPI boundary for the public focus-lease demonstration."""

from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager, suppress
from typing import Annotated, Literal, Protocol, cast
from uuid import UUID

from fastapi import Depends, FastAPI, Response, status
from pydantic import BaseModel, ConfigDict, Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from redis.asyncio import Redis
from redis.exceptions import RedisError

from onless_api.focus_lease import FocusLease, FocusLeaseStatus, RedisEvalPort


class Settings(BaseSettings):
    """Environment-backed settings for the standalone showcase service."""

    model_config = SettingsConfigDict(env_prefix="ONLESS_API_", extra="ignore")

    redis_url: str = "redis://127.0.0.1:6382/0"
    redis_connect_timeout_seconds: float = Field(default=1.0, gt=0, le=10)


class ApiRedisPort(RedisEvalPort, Protocol):
    """Redis operations used at the HTTP boundary and during shutdown."""

    async def ping(self) -> bool: ...

    async def aclose(self) -> None: ...


RedisFactory = Callable[[Settings], ApiRedisPort]


class LivenessResponse(BaseModel):
    """Process-level liveness response."""

    model_config = ConfigDict(extra="forbid")

    status: Literal["alive"] = "alive"


class DependencyHealth(BaseModel):
    """Public-safe dependency status without connection details."""

    model_config = ConfigDict(extra="forbid")

    status: Literal["available", "unavailable"]


class ReadinessResponse(BaseModel):
    """Readiness response for traffic routing."""

    model_config = ConfigDict(extra="forbid")

    status: Literal["ready", "not_ready"]
    dependencies: dict[str, DependencyHealth]


class FocusLeaseRequest(BaseModel):
    """Public input for the focus-lease example."""

    model_config = ConfigDict(extra="forbid")

    user_id: UUID
    session_id: UUID
    question_id: UUID


class FocusLeaseResponse(BaseModel):
    """Typed projection of a focus-lease decision."""

    model_config = ConfigDict(extra="forbid")

    status: FocusLeaseStatus
    allowed: bool
    acquired: bool
    reopened: bool
    remaining_seconds: int
    expires_at: int | None


def _create_redis(settings: Settings) -> ApiRedisPort:
    client = Redis.from_url(
        settings.redis_url,
        decode_responses=True,
        socket_connect_timeout=settings.redis_connect_timeout_seconds,
        socket_timeout=settings.redis_connect_timeout_seconds,
    )
    return cast(ApiRedisPort, client)


def create_app(
    settings: Settings | None = None,
    *,
    redis_factory: RedisFactory = _create_redis,
) -> FastAPI:
    """Build an application with injectable settings and Redis lifecycle."""

    resolved_settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        redis = redis_factory(resolved_settings)
        application.state.redis = redis
        try:
            yield
        finally:
            await redis.aclose()

    application = FastAPI(
        title="Onless Showcase API",
        version="1.0.0",
        docs_url="/docs",
        redoc_url=None,
        lifespan=lifespan,
    )

    async def get_redis() -> ApiRedisPort:
        return cast(ApiRedisPort, application.state.redis)

    async def get_focus_lease(
        redis: Annotated[ApiRedisPort, Depends(get_redis)],
    ) -> FocusLease:
        return FocusLease(redis)

    @application.get("/health", response_model=LivenessResponse, include_in_schema=False)
    @application.get("/health/live", response_model=LivenessResponse)
    async def liveness() -> LivenessResponse:
        return LivenessResponse()

    @application.get(
        "/health/ready",
        response_model=ReadinessResponse,
        responses={status.HTTP_503_SERVICE_UNAVAILABLE: {"model": ReadinessResponse}},
    )
    async def readiness(
        response: Response,
        redis: Annotated[ApiRedisPort, Depends(get_redis)],
    ) -> ReadinessResponse:
        available = False
        with suppress(RedisError, OSError, TimeoutError):
            available = bool(await redis.ping())

        dependency_status: Literal["available", "unavailable"] = (
            "available" if available else "unavailable"
        )
        if not available:
            response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return ReadinessResponse(
            status="ready" if available else "not_ready",
            dependencies={"redis": DependencyHealth(status=dependency_status)},
        )

    @application.post("/focus-leases/acquire", response_model=FocusLeaseResponse)
    async def acquire_focus_lease(
        request: FocusLeaseRequest,
        lease: Annotated[FocusLease, Depends(get_focus_lease)],
    ) -> FocusLeaseResponse:
        result = await lease.acquire(
            user_id=request.user_id,
            session_id=request.session_id,
            question_id=request.question_id,
        )
        return FocusLeaseResponse(
            status=result.status,
            allowed=result.allowed,
            acquired=result.acquired,
            reopened=result.reopened,
            remaining_seconds=result.remaining_seconds,
            expires_at=result.expires_at,
        )

    return application


app = create_app()
