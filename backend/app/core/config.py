"""環境変数からバックエンド設定を読み込み、検証する。"""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import AnyHttpUrl, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

# ⚠️ 生成物の置き場は prep.paths が単一の出所。ここで二重に定義しない
#    （ズレるとタイルとグラフで別の場所を見に行く）。
#    prep.paths は標準ライブラリだけで動く
from prep.paths import RUNTIME_BUNDLES_DIR, RUNTIME_GRAPH_DIR, TILES_DIR
from prep.route_search import scopes

BACKEND_DIR = Path(__file__).resolve().parents[2]

HazardDataProfile = Literal["gesuido", "kensetsu"]

# 浸水の入力元と地震データ、探索範囲をまとめたruntime成果物の識別子。
# 短い設定値はWorkerのタイルprefixにも使い、API・グラフ・プリセット・タイルを
# 必ず同じ世代へ揃える。
PROFILE_DIRS: dict[HazardDataProfile, str] = {
    "gesuido": "flood-gesuido_quake-risk9",
    "kensetsu": "flood-kensetsu_quake-risk9",
}
# 探索グラフの対象範囲。**IDだけを持ち、ディレクトリ名も呼び名もここに書かない。**
# 定義は prep.route_search.scopes が単一の出所で、そちらも標準ライブラリだけで動く。
# 2026-08-21に 23区+多摩（市街化区域 1,324.85 km²）へ切り替えた。
# ⚠️ 浸水想定図はこの範囲を覆いきらない（envelopeで実測83.8%）。覆えていない
#    エッジは「0m」ではなく「未評価」として応答に出る（rationale の3段階表示）。
#    流域の本数はここに書かない。単一の出所は hazard_sources/flood/scenarios.py。
# ⚠️ 段階6で環境変数 `RUNTIME_SCOPE` から選べるようにする。それまでは定数。
RUNTIME_SCOPE_ID = scopes.DEFAULT_SCOPE_ID


def runtime_scope() -> scopes.Scope:
    """いま使っている探索範囲。呼び名・ディレクトリ名・ファイル名はここから取る。"""

    return scopes.get(RUNTIME_SCOPE_ID)


class Settings(BaseSettings):
    """ローカル環境またはContainerから渡される実行時設定。"""

    app_env: str = "development"
    d1_gateway_url: AnyHttpUrl = AnyHttpUrl("http://d1.internal")
    r2_gateway_url: AnyHttpUrl = AnyHttpUrl("http://r2.internal")
    request_timeout_seconds: float = 10.0

    # 公開時に使うデータ世代。変更後はContainerを再起動すること。
    # グラフはプロセス内にキャッシュするため、起動中の差し替えには対応しない。
    hazard_data_profile: HazardDataProfile = "kensetsu"

    # ---- 地図まわり ----
    # 事前計算して本番配布物として同梱したプリセット。
    # data/processed/bundles は前処理の出力先で、gitignore対象なので参照しない。
    bundles_dir: str = str(RUNTIME_BUNDLES_DIR)
    # 任意地点探索に使う圧縮NPZのルート。profile/scopeは設定から解決する。
    graph_dir: str = str(RUNTIME_GRAPH_DIR)
    # 開発中だけ FastAPI から配るタイル。**本番は Worker + R2**（開発サーバ専用）
    tiles_dir: str = str(TILES_DIR)
    # タイルURLの組み立て先。ローカルFastAPIと本番Worker/R2を環境設定で切り替える
    tile_base_url: str = "/tiles"

    # ---- 認証まわり ----
    # デフォルトなし。未設定のまま起動するとValidationErrorで落ちる
    jwt_secret_key: SecretStr
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 30

    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def hazard_profile_id(self) -> str:
        """入力元・地震データを含む、成果物ディレクトリの識別子。"""

        return PROFILE_DIRS[self.hazard_data_profile]

    @property
    def active_bundles_dir(self) -> str:
        """選択中profile・探索範囲のプリセットディレクトリ。"""

        return str(
            Path(self.bundles_dir) / self.hazard_profile_id / runtime_scope().dir_name
        )

    @property
    def active_graph_dir(self) -> str:
        """選択中profile・探索範囲のNPZディレクトリ。"""

        return str(
            Path(self.graph_dir) / self.hazard_profile_id / runtime_scope().dir_name
        )


@lru_cache
def get_settings() -> Settings:
    """検証済みの設定をシングルトンとして返す。"""

    return Settings()
