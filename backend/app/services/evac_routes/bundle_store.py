"""事前計算したプリセットバンドルを、選択中のprofileから読み出す。

任意地点探索は別のsearchサービスがNPZグラフから計算する。ここでは事前計算済みJSONだけを
扱い、プリセットAPIと任意地点探索の責務を混在させない。

⚠️ **ファイルの中身は加工しない。** バイト列をそのまま返すことで、
静的配信していたときと同一であることを確認できるようにしてある。
"""

import json
import os

from app.core.config import get_settings


class NotGenerated(Exception):
    """本番配布用プリセットが無い"""


def _path(*parts):
    return os.path.join(get_settings().active_bundles_dir, *parts)


def index_raw() -> bytes:
    p = _path("index.json")
    if not os.path.exists(p):
        raise NotGenerated(
            "選択中の本番配布用プリセット index.json がありません。"
            "Dockerイメージの作成元に backend/bundles が含まれているか確認してください"
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
