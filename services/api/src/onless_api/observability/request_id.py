"""Server-owned request correlation with async context isolation."""

import logging
import time
import uuid
from collections.abc import Callable
from contextvars import ContextVar

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.types import ASGIApp

_request_id_context: ContextVar[str | None] = ContextVar("onless_request_id", default=None)


def _is_server_request_id(value: object) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 32
        and all(character in "0123456789abcdef" for character in value)
    )


def generate_request_id() -> str:
    """Create the canonical server correlation representation."""
    return uuid.uuid4().hex


def get_current_request_id() -> str | None:
    """Return the current server-owned ID, if called within a request."""
    return _request_id_context.get()


def get_trusted_request_id(request: Request | None = None) -> str | None:
    """Return only an ID explicitly marked as middleware-generated."""
    if request is None or not getattr(request.state, "request_id_trusted", False):
        return None
    value = getattr(request.state, "request_id", None)
    return value if _is_server_request_id(value) else None


RequestIdFactory = Callable[[], str]


class RequestIdMiddleware(BaseHTTPMiddleware):
    """Generate, propagate, and then remove one correlation ID per request.

    Incoming correlation headers are intentionally never read. An external value
    may be a credential even when it happens to look like a UUID, so syntax alone
    cannot promote it into trusted state, logs, or response headers.
    """

    def __init__(
        self,
        app: ASGIApp,
        *,
        header_name: str = "X-Request-ID",
        request_id_factory: RequestIdFactory = generate_request_id,
    ) -> None:
        super().__init__(app)
        self._header_name = header_name
        self._request_id_factory = request_id_factory
        self._logger = logging.getLogger(__name__)

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        candidate = self._request_id_factory()
        request_id = candidate if _is_server_request_id(candidate) else generate_request_id()
        token = _request_id_context.set(request_id)
        request.state.request_id = request_id
        request.state.request_id_trusted = True
        started = time.monotonic()

        try:
            response = await call_next(request)
            response.headers[self._header_name] = request_id
            self._logger.info(
                "request_completed",
                extra={
                    "request_id": request_id,
                    "status_code": response.status_code,
                    "duration_ms": round((time.monotonic() - started) * 1_000, 2),
                },
            )
            return response
        except Exception as error:
            self._logger.error(
                "request_failed",
                extra={
                    "request_id": request_id,
                    "error_type": type(error).__name__,
                    "duration_ms": round((time.monotonic() - started) * 1_000, 2),
                },
            )
            raise
        finally:
            request.state.request_id_trusted = False
            _request_id_context.reset(token)


class RequestIdLoggingFilter(logging.Filter):
    """Attach the current trusted correlation ID to a log record."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = get_current_request_id() or "-"
        return True
