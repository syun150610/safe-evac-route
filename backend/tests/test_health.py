from collections.abc import AsyncIterator

import httpx
import pytest

from app.main import app
from app.repositories.health import (
    D1HealthResult,
    HealthRepository,
    get_health_repository,
)


class HealthyHealthRepository:
    async def get_d1_health(self) -> D1HealthResult:
        return D1HealthResult(status="ok", result=1)


class UnavailableHealthRepository:
    async def get_d1_health(self) -> D1HealthResult:
        request = httpx.Request("GET", "http://d1.internal/health")
        raise httpx.ConnectError("D1 is unavailable", request=request)


class FakeD1Client:
    def __init__(self) -> None:
        self.requested_paths: list[str] = []

    async def get(self, path: str) -> httpx.Response:
        self.requested_paths.append(path)
        return httpx.Response(200, json={"status": "ok", "result": 1})


async def get_healthy_repository() -> HealthyHealthRepository:
    return HealthyHealthRepository()


async def get_unavailable_repository() -> UnavailableHealthRepository:
    return UnavailableHealthRepository()


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture
async def client() -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://testserver",
    ) as test_client:
        yield test_client


@pytest.mark.anyio
async def test_health(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.anyio
async def test_d1_health(client: httpx.AsyncClient) -> None:
    app.dependency_overrides[get_health_repository] = get_healthy_repository
    try:
        response = await client.get("/api/health/d1")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.anyio
async def test_d1_health_when_unavailable(client: httpx.AsyncClient) -> None:
    app.dependency_overrides[get_health_repository] = get_unavailable_repository
    try:
        response = await client.get("/api/health/d1")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 503
    assert response.json() == {"detail": "D1 is unavailable"}


@pytest.mark.anyio
async def test_health_repository_gets_d1_health() -> None:
    d1_client = FakeD1Client()
    repository = HealthRepository(d1_client)

    result = await repository.get_d1_health()

    assert result == D1HealthResult(status="ok", result=1)
    assert d1_client.requested_paths == ["/health"]
