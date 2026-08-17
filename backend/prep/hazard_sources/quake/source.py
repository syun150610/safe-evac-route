"""地震（東京都 地域危険度）のデータ源 — GPKGを読み、座標にランクを付ける。

route_search/graph.py の bake_quake() から切り出した。**ロジックは変えていない。**

データは旧プロジェクト homeward-route-poc で整備・検証済みのものを再利用する
（5,192町丁目 / 51市区町村 / EPSG:4326）。作り直さない。
出所: 旧プロジェクト homeward-route-poc で shp.zip から整備したもの。
検証済みの内容（そのままテストにできる）:
  5,192町丁目 / 51市区町村 / EPSG:4326 / 足立区 269件（うちランク5が16件）

⚠️ **51市区町村しか含まないので「範囲外」は実在する。**
ポリゴンの外を「ランク0＝最も安全」として扱うと、探索器が未評価の道へ逃げ込む
（浸水側で潰したのと同じ問題。docs/findings/検証記録.md 6-2）。
だから covered を必ず一緒に返す。
"""

import os

# ⚠️ numpy / pandas / geopandas は **sample_ranks() の中で import する。**
#    このモジュールの COLUMNS と SCENARIOS は API（/api/hazards の凡例）も読むので、
#    モジュール先頭で重い依存を引くと API に pandas が要る（05_チーム移行案 §3-3）。

# GPKGの列名 → エッジ属性名。3つの「シナリオ」に相当する
COLUMNS = {
    "quake_rank_building": "建物_ラ",
    "quake_rank_fire": "火災_ラ",
    "quake_rank_total": "総合_ラ",
}

SCENARIOS = [
    {
        "id": "total",
        "label": "総合危険度",
        "column": "quake_rank_total",
        "note": "建物倒壊と火災を合わせた総合。既定",
    },
    {
        "id": "building",
        "label": "建物倒壊危険度",
        "column": "quake_rank_building",
        "note": "揺れによる建物倒壊のランク",
    },
    {
        "id": "fire",
        "label": "火災危険度",
        "column": "quake_rank_fire",
        "note": "延焼のランク",
    },
]


def sample_ranks(coords, gpkg):
    """座標(N,2 lon/lat) → ({属性名: ランク配列(N,)}, covered(N,) bool)

    見つからない点のランクは NaN、covered=False。GPKGが無ければ None を返す。
    """
    import geopandas as gpd
    import numpy as np
    import pandas as pd

    if not os.path.exists(gpkg):
        print(f"  ! 地震ハザードGPKGが無い: {gpkg} — 地震属性はスキップする")
        return None

    gdf = gpd.read_file(gpkg)
    print(
        f"  {os.path.basename(gpkg)}: {len(gdf):,}町丁目 / "
        f"{gdf['区市町村名'].nunique()}市区町村 / CRS {gdf.crs}"
    )

    missing = [v for v in COLUMNS.values() if v not in gdf.columns]
    if missing:
        raise ValueError(
            f"{gpkg}: 期待する列が無い {missing} / 実際={list(gdf.columns)}"
        )

    # サンプル点を GeoDataFrame にして sjoin。
    # 面積・距離を計算しないので、投影せず EPSG:4326 のまま within 判定してよい。
    pts = gpd.GeoDataFrame(
        geometry=gpd.points_from_xy(coords[:, 0], coords[:, 1]), crs=4326
    )
    j = gpd.sjoin(
        pts, gdf[["geometry"] + list(COLUMNS.values())], how="left", predicate="within"
    )
    # 境界上の点が複数ポリゴンにヒットしうる。最初の1件を採る
    j = j[~j.index.duplicated(keep="first")].sort_index()

    ranks = {
        k: pd.to_numeric(j[v], errors="coerce").to_numpy(np.float64)
        for k, v in COLUMNS.items()
    }
    covered = ~np.isnan(ranks["quake_rank_total"])
    n_out = int((~covered).sum())
    print(
        f"  サンプル点 {len(coords):,} のうち町丁目に載らなかった点: "
        f"{n_out:,} ({n_out / len(coords) * 100:.2f}%)"
    )
    return ranks, covered
