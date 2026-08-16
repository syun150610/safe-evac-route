from typing import Literal

import httpx
from pydantic import BaseModel

from app.core.config import Settings, get_settings


class D1HealthResult(BaseModel):
    status: Literal["ok"]
    result: int


class D1Client:
    def __init__(self, gateway_url: str, timeout_seconds: float) -> None:
        self._gateway_url = gateway_url.rstrip("/")
        self._timeout_seconds = timeout_seconds

    async def health(self) -> D1HealthResult:
        async with httpx.AsyncClient(timeout=self._timeout_seconds) as client:
            response = await client.get(f"{self._gateway_url}/health")
            response.raise_for_status()

        return D1HealthResult.model_validate(response.json())


async def get_d1_client() -> D1Client:
    settings: Settings = get_settings()
    return D1Client(
        gateway_url=str(settings.d1_gateway_url),
        timeout_seconds=settings.request_timeout_seconds,
    )
