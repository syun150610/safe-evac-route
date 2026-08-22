"""Workerのoutbound handlerが提供するD1操作用HTTPクライアント。"""

from typing import Protocol

import httpx

from app.core.config import Settings, get_settings


class D1Writer(Protocol):
    """POSTリクエストを送れるD1クライアントのインターフェース。"""

    async def post(self, path: str, json: dict) -> httpx.Response: ...


class D1Client:
    """Container内部のWorkerゲートウェイへHTTPリクエストを送る。"""

    def __init__(self, gateway_url: str, timeout_seconds: float) -> None:
        self._gateway_url = gateway_url.rstrip("/")
        self._timeout_seconds = timeout_seconds

    async def get(self, path: str) -> httpx.Response:
        """D1ゲートウェイの指定パスへGETリクエストを送る。"""

        normalized_path = path if path.startswith("/") else f"/{path}"
        async with httpx.AsyncClient(timeout=self._timeout_seconds) as client:
            response = await client.get(f"{self._gateway_url}{normalized_path}")
            response.raise_for_status()

        return response

    async def post(self, path: str, json: dict) -> httpx.Response:
        """D1ゲートウェイの指定パスへPOSTリクエストを送る。"""

        normalized_path = path if path.startswith("/") else f"/{path}"
        async with httpx.AsyncClient(timeout=self._timeout_seconds) as client:
            response = await client.post(
                f"{self._gateway_url}{normalized_path}", json=json
            )
            response.raise_for_status()

        return response


async def get_d1_client() -> D1Client:
    """FastAPIの依存性注入で使用するD1クライアントを生成する。"""

    settings: Settings = get_settings()
    return D1Client(
        gateway_url=str(settings.d1_gateway_url),
        timeout_seconds=settings.request_timeout_seconds,
    )
