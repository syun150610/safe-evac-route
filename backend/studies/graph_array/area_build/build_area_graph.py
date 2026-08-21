"""23区＋多摩（市街化区域）の歩行者グラフを、Geofabrik の pbf から作る。

工程ごとに中間結果を残す。**既に出力があればその工程は飛ばす**ので、
途中で落ちても同じコマンドで再開できる。

    python -m studies.graph_array.area_build.build_area_graph --pbf <kanto.osm.pbf>

工程
    1 area   … 地域危険度（市街化区域の町丁目5,192件）を融合して対象範囲のGeoJSON
    2 cut    … osmium extract で対象範囲だけ切り出す（complete_ways）
    3 filter … osmnx の walk フィルタと同じ条件で .osm XML を作る（Python 3.12）
    4 graph  … osmnx.graph_from_xml で MultiDiGraph を作り pickle で保存

⚠️ 取得条件は現行（graph_from_bbox network_type="walk"）に合わせる。
   simplify=True / retain_all=False / bidirectional=True（osmnx は walk を
   `settings.bidirectional_network_types` に入れており、一方通行を無視する）。
   範囲境界をまたぐ道は `osmium extract --strategy complete_ways` が丸ごと残すので、
   `truncate_by_edge=True` と同じ扱いになる。

⚠️ Overpass は使わない（段階2で実際にタイムアウトした）。使う場合の代替手順は
   `--fallback-note` を参照。
"""

from __future__ import annotations

import json
import os
import pickle
import subprocess
import sys
import time

OUT_DIR = "../data/processed/graph_build"
AREA_GEOJSON = f"{OUT_DIR}/area_23ku_tama.geojson"
AREA_PBF = f"{OUT_DIR}/area.osm.pbf"
WALK_OSM = f"{OUT_DIR}/area_walk.osm"
GRAPH_PKL = f"{OUT_DIR}/area_walk_graph.pkl"
META_JSON = f"{OUT_DIR}/area_walk_graph_meta.json"
QUAKE_GPKG = "../data/raw/hazard/hazard.gpkg"

# 町丁目の境界を融合したあとに落とす頂点の許容差（度）。約20m。
SIMPLIFY_TOL = 0.0002


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def stage_area() -> None:
    if os.path.exists(AREA_GEOJSON):
        log(f"1 area: 既にある -> {AREA_GEOJSON}")
        return
    import geopandas as gpd
    from shapely.geometry import mapping

    log("1 area: 地域危険度ポリゴンを読む")
    g = gpd.read_file(QUAKE_GPKG)
    log(f"  町丁目 {len(g):,}件 / {g['区市町村名'].nunique()}市区町村")
    # ⚠️ 配布データに自己交差がある（union_all が TopologyException を出す）。
    #    buffer(0) で各ポリゴンを正規化してから融合する。面積は変えない。
    fixed = g.geometry.buffer(0)
    merged = fixed.union_all()
    log(f"  融合後の頂点 {sum(len(p.exterior.coords) for p in merged.geoms):,}")
    simple = merged.simplify(SIMPLIFY_TOL)
    log(f"  簡略化後の頂点 {sum(len(p.exterior.coords) for p in simple.geoms):,}")
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(AREA_GEOJSON, "w", encoding="utf-8") as f:
        json.dump({"type": "Feature", "properties": {}, "geometry": mapping(simple)}, f)
    log(f"  saved {AREA_GEOJSON} ({os.path.getsize(AREA_GEOJSON):,}B)")


def stage_cut(pbf: str) -> None:
    if os.path.exists(AREA_PBF):
        log(f"2 cut: 既にある -> {AREA_PBF}")
        return
    log("2 cut: osmium extract（complete_ways）")
    cmd = [
        "osmium",
        "extract",
        "-p",
        AREA_GEOJSON,
        "--strategy",
        "complete_ways",
        "-o",
        AREA_PBF,
        "--overwrite",
        pbf,
    ]
    subprocess.run(cmd, check=True)
    log(f"  saved {AREA_PBF} ({os.path.getsize(AREA_PBF):,}B)")


def stage_filter() -> None:
    if os.path.exists(WALK_OSM):
        log(f"3 filter: 既にある -> {WALK_OSM}")
        return
    log("3 filter: osmnx の walk フィルタ相当（Python 3.12 + pyosmium）")
    script = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "osm_walk_filter.py"
    )
    cmd = [
        "uv",
        "run",
        "--no-project",
        "--python",
        "3.12",
        "--with",
        "osmium",
        "python",
        script,
        AREA_PBF,
        WALK_OSM,
    ]
    subprocess.run(cmd, check=True)
    log(f"  saved {WALK_OSM} ({os.path.getsize(WALK_OSM):,}B)")


def stage_graph() -> None:
    if os.path.exists(GRAPH_PKL):
        log(f"4 graph: 既にある -> {GRAPH_PKL}")
        return
    import osmnx as ox

    log("4 graph: osmnx.graph_from_xml")
    log("  simplify=True / retain_all=False / bidirectional=True")
    t0 = time.perf_counter()
    G = ox.graph_from_xml(WALK_OSM, bidirectional=True, simplify=True, retain_all=False)
    took = time.perf_counter() - t0
    log(f"  nodes={G.number_of_nodes():,} edges={G.number_of_edges():,} ({took:.0f}s)")
    with open(GRAPH_PKL, "wb") as f:
        pickle.dump(G, f, protocol=pickle.HIGHEST_PROTOCOL)
    meta = {
        "source_pbf": os.path.basename(sys.argv[-1]),
        "area": "23ku+tama_shigaika（地域危険度の町丁目5,192件を融合）",
        "network_type": "walk（osmnxのwalkフィルタ相当をpbfへ適用）",
        "simplify": True,
        "retain_all": False,
        "bidirectional": True,
        "truncate": "osmium extract --strategy complete_ways",
        "nodes": G.number_of_nodes(),
        "edges": G.number_of_edges(),
        "build_seconds": round(took, 1),
    }
    with open(META_JSON, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    log(f"  saved {GRAPH_PKL} ({os.path.getsize(GRAPH_PKL):,}B)")


def main() -> None:
    import argparse

    ap = argparse.ArgumentParser(
        description="23区+多摩（市街化区域）の歩行者グラフ構築"
    )
    ap.add_argument("--pbf", required=True)
    ap.add_argument(
        "--stage", choices=("area", "cut", "filter", "graph"), action="append"
    )
    args = ap.parse_args()
    stages = args.stage or ["area", "cut", "filter", "graph"]
    if "area" in stages:
        stage_area()
    if "cut" in stages:
        stage_cut(args.pbf)
    if "filter" in stages:
        stage_filter()
    if "graph" in stages:
        stage_graph()
    log("完了")


if __name__ == "__main__":
    main()
