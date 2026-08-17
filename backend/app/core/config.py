"""環境変数からバックエンド設定を読み込み、検証する。"""

from functools import lru_cache
from pathlib import Path

from pydantic import AnyHttpUrl
from pydantic_settings import BaseSettings, SettingsConfigDict

# ⚠️ 生成物の置き場は prep.paths が単一の出所。ここで二重に定義しない
#    （ズレるとタイルとグラフで別の場所を見に行く）。
#    prep.paths は標準ライブラリだけで動く
from prep.paths import BUNDLES_DIR, TILES_DIR

BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    """ローカル環境またはContainerから渡される実行時設定。"""

    app_env: str = "development"
    d1_gateway_url: AnyHttpUrl = AnyHttpUrl("http://d1.internal")
    r2_gateway_url: AnyHttpUrl = AnyHttpUrl("http://r2.internal")
    request_timeout_seconds: float = 10.0

    # ---- 地図まわり ----
    # 事前計算したプリセット（prep.route_search.bundles の出力）
    bundles_dir: str = str(BUNDLES_DIR)
    # 開発中だけ FastAPI から配るタイル。**本番は Worker + R2**（開発サーバ専用）
    tiles_dir: str = str(TILES_DIR)
    # タイルURLの組み立て先。R2 に移したらここを差し替えるだけでフロントは無改修
    tile_base_url: str = "/tiles"

    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    """検証済みの設定をシングルトンとして返す。"""

    return Settings()
