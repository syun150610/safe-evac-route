"""Cloudflare Bindingsのヘルス状態を取得するRepository。"""

from typing import Annotated, Literal, Protocol

import httpx
from fastapi import Depends
from pydantic import BaseModel

from app.clients.d1 import D1Client, get_d1_client
from app.clients.r2 import R2Client, get_r2_client


class D1HealthResult(BaseModel):
    """WorkerからD1への疎通確認結果。"""

    status: Literal["ok"]
    result: int


class R2HealthResult(BaseModel):
    """WorkerからR2への疎通確認結果。"""

    status: Literal["ok"]
    object_count: int


class D1Reader(Protocol):
    """HealthRepositoryが必要とするD1クライアントの読み取り操作。"""

    async def get(self, path: str) -> httpx.Response: ...


class R2Reader(Protocol):
    """HealthRepositoryが必要とするR2クライアントの読み取り操作。"""

    async def get(self, path: str) -> httpx.Response: ...


class HealthRepository:
    """ヘルスチェックに必要なデータ操作を提供する。"""

    def __init__(self, d1_client: D1Reader, r2_client: R2Reader) -> None:
        self._d1_client = d1_client
        self._r2_client = r2_client

    async def get_d1_health(self) -> D1HealthResult:
        """Worker Binding経由でD1の疎通状態を取得する。"""

        response = await self._d1_client.get("/health")
        return D1HealthResult.model_validate(response.json())

    async def get_r2_health(self) -> R2HealthResult:
        """Worker Binding経由でR2の疎通状態を取得する。"""

        response = await self._r2_client.get("/health")
        return R2HealthResult.model_validate(response.json())


async def get_health_repository(
    d1_client: Annotated[D1Client, Depends(get_d1_client)],
    r2_client: Annotated[R2Client, Depends(get_r2_client)],
) -> HealthRepository:
    """FastAPIの依存性注入で使用するHealthRepositoryを生成する。"""

    return HealthRepository(d1_client, r2_client)
