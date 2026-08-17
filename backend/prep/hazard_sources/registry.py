"""ハザード種別の登録表。

**新しい災害を足す手順:**

1. `hazard_sources/<種別ID>/` を作り、`base.HazardSource` の契約を実装する
2. ここに1行足す
3. タイル（またはベクタ）を作る
4. グラフに係数を焼く
5. `/api/hazards` に自動で出る（この表から生成するため）
6. **他種別での評価値も併記する**（単一種別の経路の読み方。05_チーム移行案 §3-5）

種別IDは **API・タイルパス・ディレクトリ名で同じ文字列**を使うこと。
"""

# 実装が進んだものから足していく。
# いまは flood がタイル生成まで、quake がグラフ焼き込みまで実装済み。
#   flood … 点群CSV → 格子 → ラスタタイル + 経路コスト
#   quake … 町丁目ポリゴン(GPKG) → 経路コスト（表示はベクタ。05_チーム移行案 §3-2）
HAZARDS = {
    "flood": {
        "label": "浸水",
        "display_kind": "raster",
        "module": "prep.hazard_sources.flood",
        "note": "河川氾濫の浸水想定。連続値の格子なのでラスタタイルで描く",
    },
    "quake": {
        "label": "地震",
        "display_kind": "vector",
        "module": "prep.hazard_sources.quake",
        "note": "地域危険度（町丁目単位のランク1〜5）。"
                "離散のポリゴンなのでベクタで描く",
    },
}


def ids():
    return list(HAZARDS)


def meta(hazard_id):
    if hazard_id not in HAZARDS:
        raise KeyError(f"未登録のハザード種別: {hazard_id} / 登録済み={ids()}")
    return HAZARDS[hazard_id]


def scenarios(hazard_id):
    """種別ごとのシナリオ一覧。IDは**その種別の中でだけ**一意（global に一意にしない）"""
    if hazard_id == "flood":
        from prep.hazard_sources.flood.scenarios import SCENARIOS
        return [{"id": k, "label": v["label"], "kind": v.get("kind", "single_basin")}
                for k, v in SCENARIOS.items()]
    if hazard_id == "quake":
        from prep.hazard_sources.quake.source import SCENARIOS
        return [{"id": s["id"], "label": s["label"], "kind": "rank"} for s in SCENARIOS]
    raise KeyError(hazard_id)
