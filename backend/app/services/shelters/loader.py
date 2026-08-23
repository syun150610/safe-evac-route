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


def hazard_match(properties: dict, hazard_ids=()) -> bool:
    """その施設が、選んだ災害に対応していると**データ上言えるか**。

    ⚠️ **False は「対応していない」ではなく「登録が無い」。** 指定避難所は
    元データ（130001_evacuation_center.csv）に災害種別の欄そのものが無く、
    `hazard_types` は必ず空になる。安全側に倒して False を返すが、
    画面では「対応していない」と読ませないこと。
    """
    wanted = set(hazard_ids or ())
    if not wanted:
        return True
    return wanted <= set(properties.get("hazard_types") or ())


def eligible(hazard_ids=(), type_filter: str = "all") -> list[dict]:
    """避難先として提案してよい施設（Featureのリスト）。

    ## 種別ごとに扱いが違う

    * 指定緊急避難場所 … 災害種別を持つので、**一致するものだけ**残す。
      切迫した危険から逃げる先として自治体が災害別に指定したもの。
    * 指定避難所 … 種別の登録が無いので**絞らずに含める**。
      災害後に滞在する施設で、どの災害向けかの情報を持たない。

    ⚠️ **指定避難所を外さない**（2026-08-23に変更）。外していた頃は、
    調布駅のように近い9件（315m〜1,375m）がすべて指定避難所の場所で、
    1,424m先の多摩川河川敷まで案内していた。グラフ上の無作為400地点で
    測ると、**65%の地点で指定避難所の方が近い**（24%は500m以上近い）。

    ⚠️ ただし**「その災害に対応している」とは言えない**まま候補に入る。
    呼び出し側は `hazard_match()` の結果を応答に載せ、画面で明示すること。
    """
    features = _all_features()
    if type_filter and type_filter != "all":
        features = [f for f in features if f["properties"]["type"] == type_filter]
    wanted = set(hazard_ids or ())
    if not wanted:
        return features
    return [
        f
        for f in features
        # 指定避難所は種別を持たないので、ここでは落とさない
        if f["properties"]["type"] != "urgent"
        or wanted <= set(f["properties"].get("hazard_types") or ())
    ]
