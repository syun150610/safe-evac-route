"""ハザード種別のカタログ — 種別・シナリオ・凡例・タイルURLを1箇所から配る。

**フロントに種別や凡例をハードコードさせない**のが目的（05_チーム移行案 §5-2）。
特に「包絡は予測ではなく上限の保証」「範囲外は判断材料がない」の説明文は、
UIごとに書き写すと必ず表現がズレる。ここから配る。

種別の登録は prep 側の registry を単一の出所にする（二重に持たない）。
"""

import json
import os

from app.core.config import get_settings
from prep.hazard_sources import registry
from prep.paths import TILES_DIR

# 浸水タイルのズーム範囲（prep.tile_render.render の ZOOMS と揃える）。
# ⚠️ maxz は「焼いてある上限」で、拡大の上限ではない。超えた分は地図側が引き伸ばす。
# データの格子が約10mなので z16以降は情報が増えない（docs/dev/07 §2-7-0）
FLOOD_MINZ, FLOOD_MAXZ = 12, 15

# 浸水の凡例。色は tile_render のパレットと同じ（国交省 浸水深標準色）
FLOOD_LEGEND = [
    {"color": "#F7F5A9", "label": "0 〜 0.5m"},
    {"color": "#FFD8C0", "label": "0.5 〜 3m"},
    {"color": "#FFB7B7", "label": "3 〜 5m"},
    {"color": "#FF9191", "label": "5 〜 10m"},
    {
        "hatch": True,
        "label": "想定図の範囲外",
        "note": "**浸水しないのではなく、判断材料がない。**"
        "このシナリオの浸水想定図が及んでいない範囲",
    },
]


def _tile_base():
    """タイルのベースURL。**R2 + Worker に移したら設定だけで切り替わる。**
    フロントはこのURLをそのまま使うので、移しても表示側は無改修"""
    return get_settings().tile_base_url


def _flood_scenarios():
    """シナリオの表示名と説明文は bundles の出力と同じものを使う。

    ⚠️ 包絡の説明を「全河川が同時に氾濫した場合」と書くと**誤り**。
    ここは prep 側（SCENARIO_META）を出所にする。
    """
    from prep.route_search.bundles import SCENARIO_META

    settings = get_settings()
    out = []
    for sid, meta in SCENARIO_META.items():
        out.append(
            {
                "id": sid,
                "label": meta["display"],
                "kind": meta["kind"],
                "note": meta["note"],
                "tile_url": f"{_tile_base()}/flood/"
                f"{settings.hazard_data_profile}/{sid}/{{z}}/{{x}}/{{y}}.png",
            }
        )
    return out


def _quake_scenarios():
    """地震はベクタ。凡例は書き出し済みの GeoJSON に同梱してある"""
    from prep.hazard_sources.quake.source import SCENARIOS

    out = []
    for s in SCENARIOS:
        legend = None
        p = os.path.join(str(TILES_DIR), "quake", f"{s['id']}.geojson")
        if os.path.exists(p):
            # 凡例だけ読む（本体は数MBあるので配信はファイルごと）
            with open(p, "rb") as f:
                legend = json.load(f).get("legend")
        out.append(
            {
                "id": s["id"],
                "label": s["label"],
                "kind": "rank",
                "note": s["note"],
                "vector_url": f"{_tile_base()}/quake/{s['id']}.geojson",
                "legend": legend,
            }
        )
    return out


def catalog():
    """GET /api/hazards の中身"""
    settings = get_settings()
    hazards = []
    for hid in registry.ids():
        meta = registry.meta(hid)
        h = {
            "id": hid,
            "label": meta["label"],
            "display_kind": meta["display_kind"],
            "note": meta["note"],
        }
        if hid == "flood":
            h["scenarios"] = _flood_scenarios()
            h["legend"] = FLOOD_LEGEND
            h["zoom"] = {"min": FLOOD_MINZ, "max": FLOOD_MAXZ}
        elif hid == "quake":
            h["scenarios"] = _quake_scenarios()
        hazards.append(h)
    return {
        "data_profile": settings.hazard_data_profile,
        "data_profile_id": settings.hazard_profile_id,
        "hazards": hazards,
        # 同時に出すのは1つ（単位の違うものを重ねない。§3-4）
        "display_policy": "one_at_a_time",
        "note": "経路のコストは選ばれた種別を掛け合わせて計算する。"
        "表示は分けて、判断は掛け合わせる",
        "api_prefix": "/api",
    }
