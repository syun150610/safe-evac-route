"""ハザード種別のカタログ — 種別・シナリオ・凡例・タイルURLを1箇所から配る。

**フロントに種別や凡例をハードコードさせない**のが目的。
特に「包絡は予測ではなく上限の保証」「範囲外は判断材料がない」の説明文は、
UIごとに書き写すと必ず表現がズレる。ここから配る。

種別の登録は prep 側の registry を単一の出所にする（二重に持たない）。
"""

from app.core.config import get_settings
from prep.hazard_sources import registry

# 浸水タイルのズーム範囲（prep.tile_render.render の ZOOMS と揃える）。
# ⚠️ maxz は「焼いてある上限」で、拡大の上限ではない。超えた分は地図側が引き伸ばす。
# データの格子が約10mなのでz16以降は情報が増えず、地図側のoverzoomに任せる。
# ⚠️ **`prep/tile_render/render.py` の `ZOOMS` と揃えること。** ここだけ広げると
# 焼いていないズームを取りに行って404になる。z10 まで下げたのは、東京都全体が
# 入る縮尺で浸水レイヤーが消えていたため（ユーザー指摘、2026-08-24）。
FLOOD_MINZ, FLOOD_MAXZ = 10, 15

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
    """タイルのベースURL。ローカルFastAPIと本番Worker/R2を設定で切り替える。"""
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
    """地震はベクタ。凡例はシナリオ共通なので種別の階層で返す（浸水と同じ形）。

    ⚠️ **以前はここで書き出し済みGeoJSONを読んでいた。** 本番Containerに
    `data/processed/tiles/` は無いので必ず None になり、地震の凡例が
    `/api/hazards` から取れていなかった。開発環境では凡例数行のために
    4.6MBのGeoJSONを丸ごとパースしていた。
    """
    from prep.hazard_sources.quake.source import SCENARIOS

    return [
        {
            "id": s["id"],
            "label": s["label"],
            "kind": "rank",
            "note": s["note"],
            "vector_url": f"{_tile_base()}/quake/{s['id']}.geojson",
        }
        for s in SCENARIOS
    ]


def _risk(hid):
    """カードや指標タイルが読むべき `routes[].stats` のキーと、危険区間の呼び名。

    ⚠️ **キー名をフロントに書かせない。** 種別ごとに違う（浸水は
    `ratio_over_03`、地震は `quake_r4plus_ratio`）ので、フロントが対応表を持つと
    **種別を増やすたびにフロントの修正が要る**。registry の `risk` ブロックを
    単一の出所にして、種別追加＝registry に1ブロックで済ませる。

    ⚠️ **`coverage_key` を落とさない。** 危険区間が0%でも、その経路の大半が
    整備範囲の外なら「安全」ではなく「判断材料が無い」。実測で経路の74.9%が
    想定図の範囲外だったODがある。割合だけ出して未評価を隠すと、
    `hazard_sources/base.py` が禁じている読み違えをそのまま画面に出す。

    ⚠️ 文言の組み立てに使うもの（`condition_note` など）はここから配らない。
    完成した文字列は `rationale` が返す（そちらが文言の単一の出所）。
    """
    spec = registry.risk(hid)
    if spec is None:
        return None
    return {
        "label": spec["label"],
        "length_key": spec["length_key"],
        "ratio_key": spec["ratio_key"],
        "coverage_key": spec["coverage_key"],
    }


def _quake_legend():
    """ランク1〜5と調査対象外。**係数は載せない。**

    係数はグラフへ焼き込み済みで、生成物に残った値は焼き直しで古くなりうる
    （実際に配信中のGeoJSONの凡例は PR #33 以前の係数のまま）。
    画面に出さない値を配らない。
    """
    from prep.hazard_sources.quake.source import legend_items

    return legend_items()


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
            "risk": _risk(hid),
        }
        if hid == "flood":
            h["scenarios"] = _flood_scenarios()
            h["legend"] = FLOOD_LEGEND
            h["zoom"] = {"min": FLOOD_MINZ, "max": FLOOD_MAXZ}
        elif hid == "quake":
            h["scenarios"] = _quake_scenarios()
            h["legend"] = _quake_legend()
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
