"""Workerのoutbound handlerが提供するR2操作用HTTPクライアント。"""

import httpx

from app.core.config import Settings, get_settings


class R2Client:
    """Container内部のWorkerゲートウェイへHTTPリクエストを送る。"""

    def __init__(self, gateway_url: str, timeout_seconds: float) -> None:
        self._gateway_url = gateway_url.rstrip("/")
        self._timeout_seconds = timeout_seconds

    async def get(self, path: str) -> httpx.Response:
        """R2ゲートウェイの指定パスへGETリクエストを送る。"""

        normalized_path = path if path.startswith("/") else f"/{path}"
        async with httpx.AsyncClient(timeout=self._timeout_seconds) as client:
            response = await client.get(f"{self._gateway_url}{normalized_path}")
            response.raise_for_status()

        return response


async def get_r2_client() -> R2Client:
    """FastAPIの依存性注入で使用するR2クライアントを生成する。"""

    settings: Settings = get_settings()
    return R2Client(
        gateway_url=str(settings.r2_gateway_url),
        timeout_seconds=settings.request_timeout_seconds,
    )
