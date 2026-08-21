"""ハザード種別の登録表。

**新しい災害を足す手順:**

1. `hazard_sources/<種別ID>/` を作り、`base.HazardSource` の契約を実装する
2. ここに1行足す
3. タイル（またはベクタ）を作る
4. グラフに係数を焼く
5. `/api/hazards` に自動で出る（この表から生成するため）
6. **他種別での評価値も併記する**（単一種別の経路を誤読させないため）

種別IDは **API・タイルパス・ディレクトリ名で同じ文字列**を使うこと。

## `risk` ブロック（経路選択の根拠に使う）

`app/services/evac_routes/rationale.py` は**この表しか見ない。**
種別を増やしても、判定ロジックとフロントは無変更で済むようにしてある。
新しい種別を足すときは `risk` を書き、`route_stats()` に対応する
「危険区間の距離(m)」「同 割合」「未評価区間の割合」を出させること。

⚠️ **未評価（coverage 外）を「安全」に混ぜないこと。** `coverage_key` を
省くと、判断材料が無い区間が危険0mとして数えられてしまう。
"""

# 実装が進んだものから足していく。
#   flood … 点群CSV → 格子 → ラスタタイル + 経路コスト
#   quake … 町丁目ポリゴン(GPKG) → GeoJSON + 経路コスト
HAZARDS = {
    "flood": {
        "label": "浸水",
        "display_kind": "raster",
        "module": "prep.hazard_sources.flood",
        "note": "河川氾濫の浸水想定。連続値の格子なのでラスタタイルで描く",
        "risk": {
            # 画面に出す危険区間の呼び名。ここだけで文言が決まる
            "label": "浸水30cm超",
            # route_stats() のキー名。distance は m、ratio は 0〜1
            "length_key": "length_over_03_m",
            "ratio_key": "ratio_over_03",
            "coverage_key": "out_of_coverage_ratio",
            # 詳細表示の「条件」行。閾値が何かを必ず書く
            "threshold_label": "浸水深0.3m超（歩行困難ライン）",
            # 同「条件」行の後半。{scenario_display} を使ってよい
            "condition_note": "想定図は{scenario_display}",
        },
    },
    "quake": {
        "label": "地震",
        "display_kind": "vector",
        "module": "prep.hazard_sources.quake",
        "note": "地域危険度（町丁目単位のランク1〜5）。"
        "離散のポリゴンなのでベクタで描く",
        "risk": {
            "label": "危険度4以上",
            "length_key": "quake_r4plus_m",
            "ratio_key": "quake_r4plus_ratio",
            "coverage_key": "quake_out_of_coverage_ratio",
            "threshold_label": "地域危険度ランク4以上",
            # ⚠️ ランクは都内での相対評価。「ランク1だから安全」ではない
            "condition_note": "ランクは都内での相対評価",
        },
    },
}


def ids():
    return list(HAZARDS)


def meta(hazard_id):
    if hazard_id not in HAZARDS:
        raise KeyError(f"未登録のハザード種別: {hazard_id} / 登録済み={ids()}")
    return HAZARDS[hazard_id]


def risk(hazard_id):
    """経路選択の根拠に使う定義。未定義の種別は None（根拠から黙って外れる）"""
    return meta(hazard_id).get("risk")


def scenarios(hazard_id):
    """種別ごとのシナリオ一覧。IDは**その種別の中でだけ**一意（global に一意にしない）"""
    if hazard_id == "flood":
        from prep.hazard_sources.flood.scenarios import SCENARIOS

        return [
            {"id": k, "label": v["label"], "kind": v.get("kind", "single_basin")}
            for k, v in SCENARIOS.items()
        ]
    if hazard_id == "quake":
        from prep.hazard_sources.quake.source import SCENARIOS

        return [{"id": s["id"], "label": s["label"], "kind": "rank"} for s in SCENARIOS]
    raise KeyError(hazard_id)
