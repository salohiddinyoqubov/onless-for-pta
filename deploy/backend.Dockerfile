FROM mirror.gcr.io/library/python:3.12.13-slim-bookworm@sha256:4766d8b510c428e595d74b9cc5bbb2fae8e26316fffb4adc89908d79aacd58a2 AS builder

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    POETRY_NO_INTERACTION=1 \
    POETRY_VIRTUALENVS_IN_PROJECT=1

WORKDIR /build

RUN python -m pip install --no-cache-dir poetry==2.2.1

COPY services/api/pyproject.toml services/api/poetry.lock ./
RUN poetry install --only main --no-root --no-ansi \
    && /build/.venv/bin/python -m pip uninstall --yes pip

FROM mirror.gcr.io/library/python:3.12.13-slim-bookworm@sha256:4766d8b510c428e595d74b9cc5bbb2fae8e26316fffb4adc89908d79aacd58a2 AS runtime

ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN groupadd --gid 10001 onless \
    && useradd --uid 10001 --gid onless --no-create-home --shell /usr/sbin/nologin onless

WORKDIR /app

COPY --from=builder --chown=10001:10001 /build/.venv /opt/venv
COPY --chown=10001:10001 services/api/src/onless_api /app/onless_api

USER 10001:10001
EXPOSE 8000

CMD ["python", "-m", "uvicorn", "onless_api.app:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
