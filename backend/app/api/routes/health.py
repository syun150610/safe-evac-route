"""API本体と依存先D1のヘルスチェック。"""

from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ValidationError

from app.clients.d1 import D1Client, get_d1_client


class HealthResponse(BaseModel):
    """正常なヘルスチェックで返す共通レスポンス。"""

    status: str


router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse, include_in_schema=False)
@router.get("/api/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    """FastAPIプロセスがリクエストを受け付けられることを返す。"""

    return HealthResponse(status="ok")


@router.get("/api/health/d1", response_model=HealthResponse)
async def d1_health(
    client: Annotated[D1Client, Depends(get_d1_client)],
) -> HealthResponse:
    """Worker Binding経由でD1へ接続できるかを返す。"""

    try:
        result = await client.health()
    except (httpx.HTTPError, ValidationError) as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="D1 is unavailable",
        ) from exc

    return HealthResponse(status=result.status)
