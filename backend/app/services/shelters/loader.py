"""避難所・避難場所データの読み込みとフィルタ。

shelters.json は prep.shelters.convert で生成したもので、git に同梱する。
起動時に一度だけ読み込み、リクエストごとの I/O を避ける。
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

_SHELTERS_FILE = Path(__file__).resolve().parents[3] / "shelters" / "shelters.json"


@lru_cache(maxsize=1)
def _all_features() -> list[dict]:
    with open(_SHELTERS_FILE, encoding="utf-8") as f:
        return json.load(f)["features"]


def get(
    bbox: tuple[float, float, float, float] | None = None,
    type_filter: str | None = None,
) -> dict:
    """GeoJSON FeatureCollection を返す。

    Args:
        bbox: (left, bottom, right, top)。None のとき全件。
        type_filter: "urgent" | "designated" | None（全件）。
    """
    features = _all_features()

    if type_filter and type_filter != "all":
        features = [f for f in features if f["properties"]["type"] == type_filter]

    if bbox is not None:
        left, bottom, right, top = bbox
        features = [
            f
            for f in features
            if left <= f["geometry"]["coordinates"][0] <= right
            and bottom <= f["geometry"]["coordinates"][1] <= top
        ]

    return {
        "type": "FeatureCollection",
        "features": features,
        "meta": {"total": len(features)},
    }
