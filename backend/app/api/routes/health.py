"""API本体と依存先D1のヘルスチェック。"""

from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ValidationError

from app.repositories.health import HealthRepository, get_health_repository


class HealthResponse(BaseModel):
    """正常なヘルスチェックで返す共通レスポンス。"""

    status: str


router = APIRouter(tags=["health"])


@router.get("/api/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    """FastAPIプロセスがリクエストを受け付けられることを返す。"""

    return HealthResponse(status="ok")


@router.get("/api/health/d1", response_model=HealthResponse)
async def d1_health(
    repository: Annotated[HealthRepository, Depends(get_health_repository)],
) -> HealthResponse:
    """Worker Binding経由でD1へ接続できるかを返す。"""

    try:
        result = await repository.get_d1_health()
    except (httpx.HTTPError, ValidationError) as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="D1 is unavailable",
        ) from exc

    return HealthResponse(status=result.status)
