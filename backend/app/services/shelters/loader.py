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


def eligible(hazard_ids=(), type_filter: str = "urgent") -> list[dict]:
    """避難先として提案してよい施設だけを返す（Featureのリスト）。

    ⚠️ **災害種別を持つのは指定緊急避難場所だけ。** 元データ
    （130001_evacuation_area.csv）に洪水・地震などの対応欄があるのはこちらで、
    指定避難所2,560件は `hazard_types` が空である（災害後に滞在する場所で、
    どの災害向けかの情報を持たない）。したがって種別で絞ると指定避難所は
    1件も残らない。**空だから「対応していない」ではなく「情報が無い」。**

    Args:
        hazard_ids: 選択中の災害種別（"flood" / "quake" …）。
            **空なら絞らない**（災害を選んでいない＝単純に近い避難場所を探す）。
        type_filter: "urgent" | "designated" | "all"。
    """
    features = _all_features()
    if type_filter and type_filter != "all":
        features = [f for f in features if f["properties"]["type"] == type_filter]
    wanted = set(hazard_ids or ())
    if wanted:
        features = [
            f
            for f in features
            if wanted <= set(f["properties"].get("hazard_types") or ())
        ]
    return features
