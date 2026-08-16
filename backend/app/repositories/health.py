"""D1のヘルス状態を取得するRepository。"""

from typing import Annotated, Literal, Protocol

import httpx
from fastapi import Depends
from pydantic import BaseModel

from app.clients.d1 import D1Client, get_d1_client


class D1HealthResult(BaseModel):
    """WorkerからD1への疎通確認結果。"""

    status: Literal["ok"]
    result: int


class D1Reader(Protocol):
    """HealthRepositoryが必要とするD1クライアントの読み取り操作。"""

    async def get(self, path: str) -> httpx.Response: ...


class HealthRepository:
    """ヘルスチェックに必要なデータ操作を提供する。"""

    def __init__(self, client: D1Reader) -> None:
        self._client = client

    async def get_d1_health(self) -> D1HealthResult:
        """Worker Binding経由でD1の疎通状態を取得する。"""

        response = await self._client.get("/health")
        return D1HealthResult.model_validate(response.json())


async def get_health_repository(
    client: Annotated[D1Client, Depends(get_d1_client)],
) -> HealthRepository:
    """FastAPIの依存性注入で使用するHealthRepositoryを生成する。"""

    return HealthRepository(client)
