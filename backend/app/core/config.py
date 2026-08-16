"""環境変数からバックエンド設定を読み込み、検証する。"""

from functools import lru_cache
from pathlib import Path

from pydantic import AnyHttpUrl
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    """ローカル環境またはContainerから渡される実行時設定。"""

    app_env: str = "development"
    d1_gateway_url: AnyHttpUrl = AnyHttpUrl("http://d1.internal")
    r2_gateway_url: AnyHttpUrl = AnyHttpUrl("http://r2.internal")
    request_timeout_seconds: float = 10.0

    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    """検証済みの設定をシングルトンとして返す。"""

    return Settings()
