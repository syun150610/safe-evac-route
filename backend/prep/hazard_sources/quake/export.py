#!/usr/bin/env python3
"""地震（地域危険度）を地図に出すためのベクタ書き出し。

**ラスタタイルにしない。** データが町丁目ポリゴン（5,192件）なので、
ベクタのまま描く方が正しい:

- 町丁目の境界がシャープに出る（ラスタだと拡大でぼやける・ギザギザになる）
- **クリックで「この町丁目はランク4」を出せる**（経路の区間クリックと同じUX）
- タイル生成のパイプラインが要らない（gpkg → GeoJSON の変換1回）
- サイズが小さい（ラスタなら100MB級 / ベクタは数MB）

**ラスタに焼かずベクタで描く理由**: 地域危険度は町丁目単位の離散ランクで、
境界がそのまま意味を持つ（隣の丁目でランクが変わる）。ラスタにすると
境界がぼやけ、クリックしてランクと係数を出すこともできなくなる。
浸水（連続値の格子）はラスタ、地震（離散のポリゴン）はベクタ。

出力（種別/シナリオの並びは浸水タイルと同じ）:

    data/processed/tiles/quake/{scenario}.geojson   total / building / fire

使い方（backend/ で実行する）:
    python3 -m prep.hazard_sources.quake.export            # 3シナリオぶん
    python3 -m prep.hazard_sources.quake.export --scenario total
    python3 -m prep.hazard_sources.quake.export --bbox 139.76 35.70 139.82 35.76
"""

from __future__ import annotations

import argparse
import json
import os
import sys

from prep.hazard_sources.quake.cost import QUAKE_COST
from prep.hazard_sources.quake.source import (
    COLUMNS,
    PALETTE,
    SCENARIOS,
    legend_items,
)
from prep.paths import quake_gpkg, tiles_path

# 座標の丸め。6桁で約0.1m。町丁目の境界にはこれで十分で、サイズが半分以下になる
COORD_DP = 6
# ジオメトリの簡略化（度）。0.00002度 ≒ 2m。境界の形は保ちつつ点数を落とす
SIMPLIFY_DEG = 0.00002


def legend(scenario):
    """GeoJSONへ同梱する凡例。**生成物には係数も残す**（何に効いていたかの記録）。

    ⚠️ 色とラベルの出所は `quake.source`。ここに書き写さない。
    ⚠️ `/api/hazards` が返す凡例には係数を含めない（`catalog.py` を参照）。
    """
    return legend_items(QUAKE_COST)


def export(scenario, bbox=None, gpkg=None, outdir=None):
    import geopandas as gpd

    gpkg = gpkg or quake_gpkg()
    if not os.path.exists(gpkg):
        print(f"! 地震ハザードGPKGが無い: {gpkg}", file=sys.stderr)
        print(
            "  data/raw/hazard/hazard.gpkg を生成するか、環境変数 HAZARD_QUAKE_GPKG を指定する",
            file=sys.stderr,
        )
        return None

    meta = next(s for s in SCENARIOS if s["id"] == scenario)
    col = COLUMNS[meta["column"]]

    gdf = gpd.read_file(gpkg)
    n_all = len(gdf)
    if bbox:
        w, s, e, n = bbox
        gdf = gdf.cx[w:e, s:n]
    # 必要な列だけにする。区市町村名と町丁目名はクリック時の表示に使う
    name_cols = [c for c in ("区市町村名", "町丁目名", "町丁名") if c in gdf.columns]
    gdf = gdf[[*name_cols, col, "geometry"]].copy()
    gdf["rank"] = gdf[col].astype("Int64")
    gdf = gdf[gdf["rank"].notna()]
    gdf["geometry"] = gdf.geometry.simplify(SIMPLIFY_DEG, preserve_topology=True)

    feats = []
    for _, row in gdf.iterrows():
        r = int(row["rank"])
        feats.append(
            {
                "type": "Feature",
                "geometry": json.loads(gpd.GeoSeries([row.geometry]).to_json())[
                    "features"
                ][0]["geometry"],
                "properties": {
                    "rank": r,
                    "color": PALETTE.get(r, "#999999"),
                    "cost_factor": QUAKE_COST.get(r, 1.0),
                    "city": row.get("区市町村名"),
                    "area": next(
                        (row.get(c) for c in name_cols if c != "区市町村名"), None
                    ),
                },
            }
        )

    fc = {
        "type": "FeatureCollection",
        "hazard": "quake",
        "scenario": scenario,
        "scenario_label": meta["label"],
        "note": meta["note"],
        "source": "東京都 地震に関する地域危険度測定調査（第9回）",
        "display_kind": "vector",
        "legend": legend(scenario),
        "features": feats,
    }

    out = os.path.join(outdir or tiles_path("quake"), f"{scenario}.geojson")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(_round(fc), f, ensure_ascii=False, separators=(",", ":"))
    size = os.path.getsize(out) / 1e6
    dist = {
        r: sum(1 for x in feats if x["properties"]["rank"] == r)
        for r in sorted(PALETTE)
    }
    print(f"saved: {out} ({size:.1f} MB)")
    print(
        f"  町丁目 {len(feats):,} / {n_all:,}"
        + ("（bboxで絞り込み）" if bbox else "（全域）")
    )
    print("  ランク分布: " + "  ".join(f"R{r}={c:,}" for r, c in dist.items()))
    return out


def _round(obj):
    """座標を COORD_DP 桁に丸める（サイズ削減）"""
    if isinstance(obj, float):
        return round(obj, COORD_DP)
    if isinstance(obj, list):
        return [_round(x) for x in obj]
    if isinstance(obj, dict):
        return {k: _round(v) for k, v in obj.items()}
    return obj


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument(
        "--scenario",
        choices=[s["id"] for s in SCENARIOS],
        default=None,
        help="省略すると3シナリオぶん出す",
    )
    ap.add_argument(
        "--bbox",
        nargs=4,
        type=float,
        default=None,
        metavar=("W", "S", "E", "N"),
        help="この範囲だけに絞る",
    )
    ap.add_argument("--gpkg", default=None)
    ap.add_argument("--outdir", default=None)
    args = ap.parse_args()

    targets = [args.scenario] if args.scenario else [s["id"] for s in SCENARIOS]
    for sc in targets:
        if export(sc, bbox=args.bbox, gpkg=args.gpkg, outdir=args.outdir) is None:
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
