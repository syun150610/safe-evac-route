"""事前計算したバンドルを読んで返すだけ。

いまはこれだけで発表デモが成立する（**コンテナを1回も起こさずに配信できる**
＝ Workers + R2 で足りる。05_チーム移行案 §4-5）。
その場で経路を引く `search.py` は必要になってから足す。

⚠️ **ファイルの中身は加工しない。** バイト列をそのまま返すことで、
静的配信していたときと同一であることを確認できるようにしてある。
"""

import json
import os

from app.core.config import get_settings


class NotGenerated(Exception):
    """out/demo が無い（prep.route_search.bundles を実行していない）"""


def _path(*parts):
    return os.path.join(get_settings().bundles_dir, *parts)


def index_raw() -> bytes:
    p = _path("index.json")
    if not os.path.exists(p):
        raise NotGenerated(
            "backend/prep/out/demo/index.json が無い。"
            "cd backend && python3 -m prep.route_search.bundles を実行すること"
        )
    with open(p, "rb") as f:
        return f.read()


def index() -> dict:
    return json.loads(index_raw())


def bundle_raw(scenario: str, od: str) -> bytes:
    # パス要素にスラッシュや .. が来ないことを確かめる（ディレクトリ横断の防止）
    for v in (scenario, od):
        if not v or "/" in v or "\\" in v or v.startswith("."):
            raise ValueError(f"不正な識別子: {v!r}")
    p = _path(scenario, f"{od}.json")
    if not os.path.exists(p):
        raise NotGenerated(f"{scenario}/{od}.json が無い")
    with open(p, "rb") as f:
        return f.read()


def scenarios() -> list[dict]:
    return index().get("scenarios", [])


def od_list() -> list[dict]:
    return index().get("od", [])
