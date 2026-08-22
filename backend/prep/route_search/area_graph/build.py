"""23区＋多摩（市街化区域）の歩行者グラフを、Geofabrik の pbf から作る。

工程ごとに中間結果を残す。**既に出力があればその工程は飛ばす**ので、
途中で落ちても同じコマンドで再開できる。

    python -m prep.route_search.area_graph.build --pbf <kanto.osm.pbf>
    python -m prep.route_search.area_graph.build --pbf <pbf> --scope <スコープID>

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
from dataclasses import dataclass

from prep.paths import build_dir, build_path, quake_gpkg
from prep.route_search import scopes

# 既定で組み立てるスコープ。`--scope` で切り替える。範囲の作り方（融合元・簡略化の
# 許容差）は `prep.route_search.scopes` が単一の出所で、ここには値を書かない。
DEFAULT_SCOPE_ID = "tokyo-23ku-tama-shigaika"


@dataclass(frozen=True)
class Paths:
    """スコープ1つぶんの中間生成物の置き場。

    ⚠️ 生の相対パスを書かない（prep/paths.py の規約）。cwd 次第で黙って別の場所を
    読み書きする。中間生成物はスコープごとに分ける。
    """

    scope: scopes.Scope
    out_dir: str
    area_geojson: str
    area_pbf: str
    walk_osm: str
    graph_pkl: str
    meta_json: str

    @property
    def area(self) -> scopes.PolygonArea:
        return self.scope.area

    def area_source(self) -> str:
        """融合元の実パス。`PolygonArea.source_key` を prep.paths の関数へ結ぶ。"""
        if self.area.source_key == "quake_gpkg":
            return quake_gpkg()
        raise KeyError(f"未知の範囲データ: {self.area.source_key!r}")


def paths_for(scope_id: str) -> Paths:
    """⚠️ このスクリプトが作れるのは**ポリゴン融合のスコープだけ**。

    矩形bboxのスコープ（旧スコープ）は `prep.route_search.graph` が作る。
    取り違えると、範囲を作らないまま以降の工程が走る。
    """
    scope = scopes.get(scope_id)
    if not isinstance(scope.area, scopes.PolygonArea):
        raise SystemExit(
            f"{scope_id} は矩形bboxのスコープ。これは作れない。\n    {scope.builder}"
        )
    return Paths(
        scope=scope,
        out_dir=build_dir(scope.id),
        area_geojson=build_path(scope.id, "area_23ku_tama.geojson"),
        area_pbf=build_path(scope.id, "area.osm.pbf"),
        walk_osm=build_path(scope.id, "area_walk.osm"),
        graph_pkl=build_path(scope.id, "area_walk_graph.pkl"),
        meta_json=build_path(scope.id, "area_walk_graph_meta.json"),
    )


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def stage_area(p: Paths) -> None:
    if os.path.exists(p.area_geojson):
        log(f"1 area: 既にある -> {p.area_geojson}")
        return
    import geopandas as gpd
    from shapely.geometry import mapping

    log("1 area: 地域危険度ポリゴンを読む")
    g = gpd.read_file(p.area_source())
    log(f"  町丁目 {len(g):,}件 / {g['区市町村名'].nunique()}市区町村")
    # ⚠️ 配布データに自己交差がある（union_all が TopologyException を出す）。
    #    buffer(0) で各ポリゴンを正規化してから融合する。面積は変えない。
    fixed = g.geometry.buffer(0)
    merged = fixed.union_all()
    log(f"  融合後の頂点 {sum(len(p.exterior.coords) for p in merged.geoms):,}")
    simple = merged.simplify(p.area.simplify_deg)
    log(f"  簡略化後の頂点 {sum(len(p.exterior.coords) for p in simple.geoms):,}")
    os.makedirs(p.out_dir, exist_ok=True)
    with open(p.area_geojson, "w", encoding="utf-8") as f:
        json.dump({"type": "Feature", "properties": {}, "geometry": mapping(simple)}, f)
    log(f"  saved {p.area_geojson} ({os.path.getsize(p.area_geojson):,}B)")


def stage_cut(p: Paths, pbf: str) -> None:
    if os.path.exists(p.area_pbf):
        log(f"2 cut: 既にある -> {p.area_pbf}")
        return
    log("2 cut: osmium extract（complete_ways）")
    cmd = [
        "osmium",
        "extract",
        "-p",
        p.area_geojson,
        "--strategy",
        "complete_ways",
        "-o",
        p.area_pbf,
        "--overwrite",
        pbf,
    ]
    subprocess.run(cmd, check=True)
    log(f"  saved {p.area_pbf} ({os.path.getsize(p.area_pbf):,}B)")


def stage_filter(p: Paths) -> None:
    if os.path.exists(p.walk_osm):
        log(f"3 filter: 既にある -> {p.walk_osm}")
        return
    log("3 filter: osmnx の walk フィルタ相当（Python 3.12 + pyosmium）")
    script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "walk_filter.py")
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
        p.area_pbf,
        p.walk_osm,
    ]
    subprocess.run(cmd, check=True)
    log(f"  saved {p.walk_osm} ({os.path.getsize(p.walk_osm):,}B)")


def stage_graph(p: Paths) -> None:
    if os.path.exists(p.graph_pkl):
        log(f"4 graph: 既にある -> {p.graph_pkl}")
        return
    import osmnx as ox

    log("4 graph: osmnx.graph_from_xml")
    log("  simplify=True / retain_all=False / bidirectional=True")
    t0 = time.perf_counter()
    G = ox.graph_from_xml(
        p.walk_osm, bidirectional=True, simplify=True, retain_all=False
    )
    took = time.perf_counter() - t0
    log(f"  nodes={G.number_of_nodes():,} edges={G.number_of_edges():,} ({took:.0f}s)")
    with open(p.graph_pkl, "wb") as f:
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
    with open(p.meta_json, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    log(f"  saved {p.graph_pkl} ({os.path.getsize(p.graph_pkl):,}B)")


def main() -> None:
    import argparse

    ap = argparse.ArgumentParser(description="ポリゴン融合スコープの歩行者グラフ構築")
    ap.add_argument("--pbf", required=True)
    ap.add_argument(
        "--scope",
        default=DEFAULT_SCOPE_ID,
        choices=scopes.ids(),
        help="対象範囲のID（既定: %(default)s）",
    )
    ap.add_argument(
        "--stage", choices=("area", "cut", "filter", "graph"), action="append"
    )
    args = ap.parse_args()
    p = paths_for(args.scope)
    log(f"対象範囲: {p.scope.id}（{p.scope.label}）-> {p.out_dir}")
    stages = args.stage or ["area", "cut", "filter", "graph"]
    if "area" in stages:
        stage_area(p)
    if "cut" in stages:
        stage_cut(p, args.pbf)
    if "filter" in stages:
        stage_filter(p)
    if "graph" in stages:
        stage_graph(p)
    log("完了")


if __name__ == "__main__":
    main()
