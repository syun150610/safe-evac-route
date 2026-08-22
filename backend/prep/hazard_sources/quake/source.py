"""地震（東京都 地域危険度）のデータ源 — GPKGを読み、座標にランクを付ける。

route_search/graph.py の bake_quake() から切り出した。**ロジックは変えていない。**

データは東京都の第9回地域危険度SHPを `quake/build.py` でGPKGへ正規化する
（5,192町丁目 / 51市区町村 / EPSG:4326）。
検証済みの内容（そのままテストにできる）:
  5,192町丁目 / 51市区町村 / EPSG:4326 / 足立区 269件（うちランク5が16件）

⚠️ **51市区町村しか含まないので「範囲外」は実在する。**
ポリゴンの外を「ランク0＝最も安全」として扱うと、探索器が未評価の道へ逃げ込む
（浸水側と同じ問題）。
だから covered を必ず一緒に返す。
"""

import os

# ⚠️ numpy / pandas / geopandas は **sample_ranks() の中で import する。**
#    このモジュールの COLUMNS と SCENARIOS は API（/api/hazards の凡例）も読むので、
#    モジュール先頭で重い依存を引くとAPIの実行時依存にpandas等が混ざる。

# ランク → 色。**凡例もここから作る。UIにもタイル生成側にも書き写さない。**
# ⚠️ 地図の塗り（export.py）と凡例（/api/hazards）が同じ表を読むことで、
#    「凡例の色と実際の色が違う」を構造的に起こせなくする。
PALETTE = {
    1: "#4d9221",
    2: "#a6d96a",
    3: "#fee08b",
    4: "#f46d43",
    5: "#a50026",
}
# ⚠️ 画面の表記は「危険度」で統一する。「ランク」と混ぜない
#    （凡例が「ランク4」、指標が「危険度4以上」だと別物に見える）。
#    内部のキー名（quake_rank_*）は東京都の配布データの列に対応するので変えない。
RANK_LABEL = {
    1: "危険度1（相対的に低い）",
    2: "危険度2",
    3: "危険度3",
    4: "危険度4",
    5: "危険度5（相対的に高い）",
}


def legend_items(cost_factor: dict | None = None) -> list[dict]:
    """UIがそのまま描く凡例。

    ⚠️ **末尾のハッチ項目を落とさない。** 調査対象外は「危険度が低い」ではなく
    「評価されていない」。これを消すと、データが無いだけの場所が安全に見える
    （`hazard_sources/base.py` が禁じている読み違え）。

    `cost_factor` を渡すと各ランクへ係数を添える。**APIでは渡さない**
    （画面に出さない値なので配らない。係数は焼き込み済みで、
    生成物に残った値が古くなりうる）。
    """
    items: list[dict] = []
    for rank in sorted(PALETTE):
        item = {"color": PALETTE[rank], "label": RANK_LABEL[rank]}
        if cost_factor is not None:
            item["cost_factor"] = cost_factor[rank]
        items.append(item)
    items.append(
        {
            "hatch": True,
            "label": "調査の範囲外（判断材料がない）",
            "note": "このデータは51市区町村ぶんしかない。"
            "「危険度が低い」ではなく「評価されていない」",
        }
    )
    return items


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
        "note": "揺れによる建物倒壊の危険度",
    },
    {
        "id": "fire",
        "label": "火災危険度",
        "column": "quake_rank_fire",
        "note": "延焼の危険度",
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
