from collections.abc import AsyncIterator

import httpx
import pytest

from app.clients.d1 import D1HealthResult, get_d1_client
from app.main import app


class HealthyD1Client:
    async def health(self) -> D1HealthResult:
        return D1HealthResult(status="ok", result=1)


class UnavailableD1Client:
    async def health(self) -> D1HealthResult:
        request = httpx.Request("GET", "http://d1.internal/health")
        raise httpx.ConnectError("D1 is unavailable", request=request)


async def get_healthy_d1_client() -> HealthyD1Client:
    return HealthyD1Client()


async def get_unavailable_d1_client() -> UnavailableD1Client:
    return UnavailableD1Client()


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
    app.dependency_overrides[get_d1_client] = get_healthy_d1_client
    try:
        response = await client.get("/api/health/d1")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.anyio
async def test_d1_health_when_unavailable(client: httpx.AsyncClient) -> None:
    app.dependency_overrides[get_d1_client] = get_unavailable_d1_client
    try:
        response = await client.get("/api/health/d1")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 503
    assert response.json() == {"detail": "D1 is unavailable"}
