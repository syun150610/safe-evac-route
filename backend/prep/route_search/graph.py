#!/usr/bin/env python3
"""
タスクA: ハザード付き歩行者グラフの構築

OSM歩行者ネットワーク（OSMnx）の各エッジに、浸水予想区域図CSVから
浸水深を焼き込んで重み付きグラフを作り、pickle で保存する。

  depth_max      エッジ上サンプル点の最大浸水深(m)   ← 代表値（一箇所でも通れなければ通れない）
  depth_mean     同 平均浸水深(m)
  hazard_cost    重み係数（hazard_cost() 参照）
  weight_hazard  length * hazard_cost

設計上の決定（SPEC 4-5）:
  ランタイムで空間検索をしない。ここで全部焼き込む。実行時はただの重み付きグラフ探索。

依存: osmnx, networkx, numpy, pandas, shapely（+ make_tiles.py 経由で scipy, Pillow）

使い方:
    python3 build_graph.py                  # 北千住↔上野（デフォルト）
    python3 build_graph.py --rebuild        # OSMキャッシュを無視して取り直す
    python3 build_graph.py --graphml        # GraphML も併せて出力
"""

from __future__ import annotations

import argparse
import json
import math
import os
import pickle
import sys
import time

import networkx as nx
import numpy as np
import osmnx as ox
import pandas as pd
import shapely
from shapely.geometry import LineString

# ハザードの係数は種別ごとのモジュールが持つ（prep/hazard_sources/base.py の契約）
from prep.hazard_sources.flood.cost import (
    COVERAGE_PENALTY,
    IMPASSABLE_FINITE,
    _selftest_cost,
    hazard_cost_vec,
)

# load_grid はタイル生成と完全に同じロジックを使う。
# 自前で書き直すと格子原点がズレてタイルとエッジ値が食い違うので、必ず import する。
# （make_tiles.py は import しても副作用なし: 処理は __main__ ガード内）
from prep.hazard_sources.flood.grid import load_grid, lookup_covered
from prep.hazard_sources.flood.scenarios import (
    FLOOD_SOURCE_ID,
    FLOOD_SOURCE_LABEL,
    SCENARIOS,
)
from prep.hazard_sources.quake.cost import (
    QUAKE_COST,
    QUAKE_COVERAGE_PENALTY,
    QUAKE_GPKG,
    QUAKE_SOURCE_ID,
    QUAKE_SOURCE_LABEL,
)
from prep.paths import CACHE_DIR as CACHE_DIR_PATH
from prep.paths import graph_path, rel

# 「焼いたグラフを使う側」が要るものは snap.py に置いてある（osmnx 非依存）。
# ここから再エクスポートするので、既存の import 先は変えなくてよい
from prep.route_search.snap import (  # noqa: F401
    DEST_DEFAULT,
    MARGIN_KM,
    ORIGIN_DEFAULT,
    OUT_DEFAULT,
    bbox_from_points,
    nearest_node,
    snap_m,
)

# ---------------- 設定 ----------------
CSV_DEFAULT = SCENARIOS["sumidagawa"]["csv"][0]
CACHE_DIR = str(CACHE_DIR_PATH)

SAMPLE_M = 10.0  # エッジ上のサンプル間隔(m)（SPEC 5 タスクA-2）
MAX_SAMPLES_PER_EDGE = 500  # 異常に長いエッジの保険

# 北千住↔上野 区間の浸水深分布（隅田川CSV単体の実測値）。main() の末尾で
# CSVから再計算して突き合わせ、ズレたら「データが更新された可能性」として報告する。
# ⚠️ render.py の HATCH_* と同じく、2026-08-16 の切り出しで**落ちていた**。
#    --skip-spec-check を付けずに基準CSVで焼いたときだけ NameError になるので、
#    グラフを焼き直すまで露見しない。値は元の build_graph.py のまま
SPEC_STATS_BBOX = (35.705, 35.760, 139.770, 139.812)  # lat0, lat1, lon0, lon1
SPEC_STATS_EXPECTED = {
    "n_points": 181613,
    ">0.0": 75.2,
    ">0.2": 53.0,
    ">0.3": 45.1,
    ">0.5": 31.6,
    ">1.0": 3.6,
    ">2.0": 0.1,
}


# ---------------- OSM グラフ取得 ----------------


def fetch_graph(bbox, network_type="walk", rebuild=False):
    """歩行者ネットワークを取得。ローカル pickle にキャッシュして2回目以降はオフラインで回せる。"""
    os.makedirs(CACHE_DIR, exist_ok=True)
    ox.settings.use_cache = True
    ox.settings.cache_folder = os.path.join(CACHE_DIR, "osmnx")

    key = "_".join(f"{v:.5f}" for v in bbox) + f"_{network_type}"
    path = os.path.join(CACHE_DIR, f"osm_{key}.pkl")

    if os.path.exists(path) and not rebuild:
        with open(path, "rb") as f:
            G = pickle.load(f)
        print(f"  OSM graph from cache: {path}")
        return G

    print(f"  querying Overpass (network_type={network_type}) ...")
    t0 = time.time()
    G = ox.graph_from_bbox(
        bbox,
        network_type=network_type,
        simplify=True,
        retain_all=False,  # 最大連結成分のみ。孤立した小片は探索の邪魔になる
        truncate_by_edge=True,  # bbox境界をまたぐエッジを残し、端の接続を切らない
    )
    print(f"  fetched in {time.time() - t0:.1f}s")
    with open(path, "wb") as f:
        pickle.dump(G, f, protocol=pickle.HIGHEST_PROTOCOL)
    print(f"  cached -> {path}")
    return G


# ---------------- エッジのサンプリング ----------------


def edge_geometries(G):
    """全エッジの (u, v, k) と LineString を返す。

    simplify=True のグラフでは、曲がった道だけが 'geometry' を持つ。
    持たないエッジは2ノードを結ぶ直線なので自前で組み立てる。
    """
    keys, lines, lengths = [], [], []
    nodes = G.nodes
    for u, v, k, d in G.edges(keys=True, data=True):
        geom = d.get("geometry")
        if geom is None:
            geom = LineString(
                [(nodes[u]["x"], nodes[u]["y"]), (nodes[v]["x"], nodes[v]["y"])]
            )
        keys.append((u, v, k))
        lines.append(geom)
        lengths.append(float(d.get("length", 0.0)))
    return keys, np.array(lines, dtype=object), np.array(lengths, dtype=np.float64)


def sample_points(lines, lengths, step_m: float):
    """各エッジ上に step_m 間隔でサンプル点を打つ。

    戻り値: coords (N,2) [lon, lat], offsets (E,) 各エッジの開始インデックス, counts (E,)

    距離は length 属性(m)で決め、位置は正規化距離でジオメトリ上を補間する。
    エッジ長は高々数百mなので、度空間での線形補間と実距離の差は無視できる。
    """
    counts = np.clip(
        np.floor(lengths / step_m).astype(np.int64) + 1, 2, MAX_SAMPLES_PER_EDGE
    )
    total = int(counts.sum())

    # 各サンプルの「どのエッジか」と「そのエッジ内で何番目か」を展開
    edge_idx = np.repeat(np.arange(len(lines)), counts)
    offsets = np.concatenate([[0], np.cumsum(counts)[:-1]])
    within = np.arange(total) - offsets[edge_idx]
    t = within / (counts[edge_idx] - 1).astype(np.float64)  # 0.0 .. 1.0

    pts = shapely.line_interpolate_point(lines[edge_idx], t, normalized=True)
    coords = shapely.get_coordinates(pts)  # (N, 2) = [lon, lat]
    return coords, offsets, counts


def lookup_depth(coords, grid, meta):
    """サンプル点(lon,lat) -> 最寄りグリッドセルの浸水深。

    make_tiles.render() と同じインデックス計算（最近傍）。KDTreeは使わない。
    グリッド範囲外は 0.0（＝浸水なし扱い）とし、件数を返して呼び出し側で警告できるようにする。
    """
    lon = coords[:, 0]
    lat = coords[:, 1]
    r = np.round((meta["lat_max"] - lat) / meta["dlat"]).astype(np.int64)
    c = np.round((lon - meta["lon_min"]) / meta["dlon"]).astype(np.int64)

    inside = (r >= 0) & (r < meta["nrow"]) & (c >= 0) & (c < meta["ncol"])
    np.clip(r, 0, meta["nrow"] - 1, out=r)
    np.clip(c, 0, meta["ncol"] - 1, out=c)

    depth = grid[r, c].astype(np.float64)
    depth[~inside] = 0.0
    return depth, int((~inside).sum())


def reduce_per_edge(depth, offsets, counts):
    """サンプル点の配列をエッジ単位の (max, mean) に畳む。"""
    dmax = np.maximum.reduceat(depth, offsets)
    dsum = np.add.reduceat(depth, offsets)
    dmean = dsum / counts
    return dmax, dmean


# ---------------- 焼き込み ----------------


def bake_hazard(G, grid, meta, step_m: float):
    keys, lines, lengths = edge_geometries(G)
    print(f"  edges={len(keys):,}  total_length={lengths.sum() / 1000:.1f}km")

    coords, offsets, counts = sample_points(lines, lengths, step_m)
    print(f"  sample points={len(coords):,}  (~{step_m:.0f}m interval)")

    depth, n_outside = lookup_depth(coords, grid, meta)

    # 「浸水なし(0m)」と「そのシナリオが覆っていない」を区別する。
    # 区別しないと、覆っていないだけの場所が 0.0m=安全 に見えてしまう。
    covered = lookup_covered(coords, meta)
    n_nocov = int((~covered).sum())
    if n_nocov:
        print(
            f"  ! {n_nocov:,} sample points ({n_nocov / len(depth) * 100:.2f}%) は"
            f"このシナリオの想定範囲外（グリッド外 {n_outside:,} を含む）"
        )
        print("  !   → depth は 0.0m として扱うが、edge属性 coverage で識別できる")

    cov_sum = np.add.reduceat(covered.astype(np.float64), offsets)
    cov_frac = cov_sum / counts

    dmax, dmean = reduce_per_edge(depth, offsets, counts)
    cost = hazard_cost_vec(dmax)  # 浸水深だけから決まる素のコスト（inf を含みうる）

    # 評価済み部分と未評価部分の加重平均を実効コストにする。
    #   cost_eff = cost * coverage + COVERAGE_PENALTY * (1 - coverage)
    # coverage=1 なら従来どおり。coverage=0 なら COVERAGE_PENALTY。
    #
    # inf の扱い: inf は「実測で1.0m超」を意味するので、少しでも評価済み部分が
    # あるなら通行不可のままにする（inf * 0 = nan を避けるため場合分けする）。
    inf_mask = np.isinf(cost)
    cost_finite = np.where(inf_mask, 0.0, cost)
    cost_eff = cost_finite * cov_frac + COVERAGE_PENALTY * (1.0 - cov_frac)
    cost_eff = np.where(inf_mask & (cov_frac > 0), np.inf, cost_eff)

    n_impassable = int(np.isinf(cost_eff).sum())
    w = np.where(np.isinf(cost_eff), lengths * IMPASSABLE_FINITE, lengths * cost_eff)

    for i, (u, v, k) in enumerate(keys):
        d = G.edges[u, v, k]
        d["depth_max"] = float(dmax[i])
        d["depth_mean"] = float(dmean[i])
        d["hazard_cost"] = float(cost[i])  # 浸水深のみ由来（inf のまま保持）
        d["hazard_cost_eff"] = float(
            cost_eff[i]
        )  # 想定範囲外ペナルティ込み。探索はこちら
        # 種別共通の名前。探索時に Π cost_h で掛け合わせる（route_search/weights.py）
        d["cost_flood"] = float(cost_eff[i])
        d["weight_hazard"] = float(w[i])  # 探索用は有限値
        d["impassable"] = bool(np.isinf(cost_eff[i]))
        d["coverage"] = float(cov_frac[i])  # 1.0=全部が想定範囲内 / 0.0=全部が範囲外

    return keys, lengths, dmax, cost_eff, n_impassable, (coords, offsets, counts)


# ---------------- 地震ハザードの焼き込み（SPEC_C C-2） ----------------


def bake_quake(G, keys, coords, offsets, counts, gpkg=QUAKE_GPKG):
    """東京都 地域危険度（町丁目ポリゴン）を各エッジへ空間結合で焼き込む。

    浸水と同じ方針: **ランタイムで空間検索をしない。ここで全部焼き込む。**

    旧プロジェクト homeward-route-poc の `_assign_edge_penalty()` を移植したが、
    3点変えている:

    1. 代表点を「エッジ中点1点」から**浸水と同じ10m間隔サンプル点**に上げた。
       中点だけだと、長いエッジが複数の町丁目にまたがる場合に取りこぼす。
    2. 代表値は**最大ランク**。浸水の「一箇所でも通れなければ通れない」と同じ考え方。
       旧版は最初にヒットした1件を採用していた。
    3. **範囲外(coverage)を区別する。** 旧版はポリゴン外を penalty 0（＝最も安全）
       として扱っていたが、これは「未評価の道が最安値になる」という、浸水側で
       潰したのと同じ問題を起こす（docs/findings/検証記録.md 6-2）。
       このデータは51市区町村しか含まないので範囲外は実在する。

    C-2 の範囲では**属性を焼き込むだけ**で、weight_hazard は変更しない。
    浸水コストとの合成は C-3 で行う。
    """
    from prep.hazard_sources.quake.source import COLUMNS as cols
    from prep.hazard_sources.quake.source import sample_ranks

    got = sample_ranks(coords, gpkg)
    if got is None:
        return None
    ranks, covered = got
    n_out = int((~covered).sum())  # 下の統計で使う

    # エッジ単位に畳む。代表値は最大ランク。
    # 範囲外(NaN)は -1 に置いてから最大を取るので、1点でも載っていればその値が残る
    out = {}
    for k, v in ranks.items():
        out[k] = np.maximum.reduceat(np.where(np.isnan(v), -1.0, v), offsets)
    cov_frac = np.add.reduceat(covered.astype(np.float64), offsets) / counts

    for i, (u, v, kk) in enumerate(keys):
        d = G.edges[u, v, kk]
        for name in cols:
            val = out[name][i]
            d[name] = None if val < 0 else int(val)  # None = このエッジは範囲外
        d["quake_coverage"] = float(cov_frac[i])

    # ---- C-3: 浸水コストと掛け合わせた合成重みを作る ----
    # 既存の weight_hazard（浸水のみ）は**変えない**。合成は別属性として足す。
    rank_total = out["quake_rank_total"]
    qc = np.array([QUAKE_COST.get(int(r), 1.0) if r >= 1 else 1.0 for r in rank_total])
    # 未評価部分は QUAKE_COVERAGE_PENALTY。浸水側と同じ加重平均
    qcost_eff = qc * cov_frac + QUAKE_COVERAGE_PENALTY * (1.0 - cov_frac)

    n_comb = 0
    for i, (u, v, kk) in enumerate(keys):
        d = G.edges[u, v, kk]
        L = float(d["length"])
        d["quake_cost_eff"] = float(qcost_eff[i])
        d["cost_quake"] = float(qcost_eff[i])  # 種別共通の名前（上と同じ）
        # 地震のみの重み（C-4「地震だけで経路を引く」用）
        d["weight_quake"] = L * float(qcost_eff[i])
        # 浸水 × 地震 の合成。浸水が inf(通行不可)ならそのまま有限フォールバック
        fc = d["hazard_cost_eff"]
        if math.isinf(fc):
            d["weight_combined"] = L * IMPASSABLE_FINITE
        else:
            d["weight_combined"] = L * fc * float(qcost_eff[i])
            n_comb += 1

    dist = {}
    for name in cols:
        vals = out[name]
        dist[name] = {str(r): int((vals == r).sum()) for r in range(1, 6)}
        dist[name]["out_of_coverage"] = int((vals < 0).sum())
    return {
        "quake_cost": QUAKE_COST,
        "quake_coverage_penalty": QUAKE_COVERAGE_PENALTY,
        "edges_fully_out_of_coverage": int((cov_frac == 0).sum()),
        "mean_coverage": round(float(cov_frac.mean()), 4),
        "sample_points_out_of_coverage_pct": round(n_out / len(coords) * 100, 2),
        "rank_distribution": dist,
    }


# ---------------- 検証 ----------------


def check_connectivity(G, orig_node, dest_node):
    """通行不可エッジ(inf)を全部落としても起終点が繋がるかを見る。

    繋がらない場合、weight_hazard は IMPASSABLE_FINITE のフォールバックが効いて
    「やむを得ず浸水1m超を通る」経路が出る。それは意図した挙動だが、黙って起きると
    誤読するので明示的に警告する（SPEC 5 タスクA 末尾の要求）。
    """
    P = nx.MultiDiGraph()
    P.add_nodes_from(G.nodes(data=True))
    for u, v, k, d in G.edges(keys=True, data=True):
        if not d["impassable"]:
            P.add_edge(u, v, k, **d)
    ok = (
        nx.has_path(P, orig_node, dest_node)
        if (orig_node in P and dest_node in P)
        else False
    )
    return ok, P


def edge_length_stats(lengths, dmax):
    """エッジ長で重み付けした浸水深の分布（経路の ratio_over_03 と同じ土俵で見るため）"""
    total = lengths.sum()
    out = {}
    for thr in (0.0, 0.2, 0.3, 0.5, 1.0, 2.0):
        out[f">{thr:.1f}"] = float(lengths[dmax > thr].sum() / total * 100)
    return out


def verify_spec_stats(csv_path):
    """SPEC 3 の実測値をCSVから再計算して照合する。

    ズレたら「データが更新された可能性」なので報告対象（SPEC 8「報告してほしいこと」）。
    グリッド化前の生の点で数える（SPECの数値がそうなので）。
    """
    la0, la1, lo0, lo1 = SPEC_STATS_BBOX
    df = pd.read_csv(csv_path, encoding="utf-8-sig", usecols=["浸水深", "緯度", "経度"])
    for c in ("浸水深", "緯度", "経度"):
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df = df.dropna(subset=["浸水深", "緯度", "経度"])
    sub = df[df["緯度"].between(la0, la1) & df["経度"].between(lo0, lo1)]
    dep = sub["浸水深"].to_numpy()
    got = {"n_points": int(len(dep))}
    for thr in (0.0, 0.2, 0.3, 0.5, 1.0, 2.0):
        got[f">{thr:.1f}"] = float((dep > thr).mean() * 100)
    return got


# ---------------- main ----------------


def main():
    ap = argparse.ArgumentParser(
        description="ハザード付き歩行者グラフの構築（タスクA）"
    )
    ap.add_argument(
        "--csv",
        nargs="+",
        default=None,
        help="浸水深CSV（複数指定すると同一シナリオとして結合する）",
    )
    ap.add_argument(
        "--scenario",
        choices=sorted(SCENARIOS),
        default=None,
        help="make_tiles.py のシナリオ定義からCSVを引く（--csv より優先）",
    )
    ap.add_argument("--out", default=None, help="出力 pickle パス")
    ap.add_argument(
        "--origin",
        nargs=2,
        type=float,
        default=ORIGIN_DEFAULT,
        metavar=("LAT", "LON"),
        help="起点（既定: 北千住駅）",
    )
    ap.add_argument(
        "--dest",
        nargs=2,
        type=float,
        default=DEST_DEFAULT,
        metavar=("LAT", "LON"),
        help="終点（既定: 上野駅）",
    )
    ap.add_argument(
        "--margin-km", type=float, default=MARGIN_KM, help="bboxの片側マージン(km)"
    )
    ap.add_argument(
        "--sample-m", type=float, default=SAMPLE_M, help="エッジ上サンプル間隔(m)"
    )
    ap.add_argument("--network-type", default="walk", help="OSMnx network_type")
    ap.add_argument(
        "--rebuild", action="store_true", help="OSMキャッシュを無視して取り直す"
    )
    ap.add_argument("--graphml", action="store_true", help="GraphMLも併せて出力")
    ap.add_argument(
        "--skip-spec-check",
        action="store_true",
        help="SPEC 3 の実測値照合をスキップ（CSVを2回読むので少し遅い）",
    )
    args = ap.parse_args()

    # シナリオ指定 → CSVリストと既定の出力先を決める
    if args.scenario:
        csvs = list(SCENARIOS[args.scenario]["csv"])
        out = args.out or graph_path(f"kitasenju_ueno_{args.scenario}.pkl")
    else:
        csvs = args.csv or [CSV_DEFAULT]
        out = args.out or OUT_DEFAULT
    args.out = out

    # SPEC 3 の実測値は隅田川CSV単体に対する値なので、それ以外では照合しない
    is_reference = len(csvs) == 1 and os.path.basename(csvs[0]) == os.path.basename(
        CSV_DEFAULT
    )
    if not is_reference:
        args.skip_spec_check = True

    _selftest_cost()

    origin = tuple(args.origin)
    dest = tuple(args.dest)
    bbox = bbox_from_points([origin, dest], args.margin_km)
    print(
        f"bbox (left,bottom,right,top) = "
        f"({bbox[0]:.5f}, {bbox[1]:.5f}, {bbox[2]:.5f}, {bbox[3]:.5f})"
    )

    # 1) 浸水深グリッド
    # BBOXは渡さずCSV全域を読む。全域でも約 1770x1546 float32 = 11MB と軽く、
    # かつ make_tiles.py が生成したタイルと格子原点が完全に一致するので、
    # 「タイルの見た目」と「エッジの値」が食い違わない。
    print("loading depth grid ...")
    t0 = time.time()
    grid, meta = load_grid(csvs, None)
    print(
        f"  grid {grid.shape}  max={grid.max():.2f}m  "
        f"wet={(grid >= 0.01).mean() * 100:.1f}%  ({time.time() - t0:.1f}s)"
    )

    # 2) OSM 歩行者ネットワーク
    print("fetching OSM walk network ...")
    G = fetch_graph(bbox, args.network_type, args.rebuild)
    print(f"  nodes={G.number_of_nodes():,}  edges={G.number_of_edges():,}")

    # 3) ハザード焼き込み
    print("baking hazard onto edges ...")
    t0 = time.time()
    keys, lengths, dmax, cost, n_impassable, samples = bake_hazard(
        G, grid, meta, args.sample_m
    )

    print("baking earthquake hazard onto edges ...")
    quake = bake_quake(G, keys, *samples)
    print(f"  done in {time.time() - t0:.1f}s")

    # 4) 統計
    stats = edge_length_stats(lengths, dmax)
    print("\n--- edge depth distribution (length-weighted, %) ---")
    for k, v in stats.items():
        print(f"  depth_max {k:>5}m : {v:5.1f}%")
    print(
        f"  impassable edges (>=1.0m, cost=inf): {n_impassable:,} / {len(keys):,} "
        f"({n_impassable / len(keys) * 100:.2f}%)"
    )

    # 5) 起終点ノードと連結性
    orig_node = nearest_node(G, origin[0], origin[1])
    dest_node = nearest_node(G, dest[0], dest[1])
    print(f"\norigin node={orig_node}  dest node={dest_node}")

    ok, _ = check_connectivity(G, orig_node, dest_node)
    if ok:
        print("  connectivity: OK — 通行不可エッジを全て除いても起終点は接続している")
    else:
        print("  ! WARNING: 通行不可(inf)エッジを除くと起終点が分断される。")
        print(
            f"  ! weight_hazard は inf を {IMPASSABLE_FINITE:.0e} 倍の有限値に置換済みなので"
        )
        print("  ! 探索自体は成功するが、結果の経路は浸水1.0m超区間を含みうる。")

    # 6) 保存
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "wb") as f:
        pickle.dump(G, f, protocol=pickle.HIGHEST_PROTOCOL)
    size_mb = os.path.getsize(args.out) / 1e6
    print(f"\nsaved: {args.out} ({size_mb:.1f} MB)")

    meta_out = {
        "csv": [rel(c) for c in csvs],
        "scenario": args.scenario,
        "source_profile": (
            f"flood-{FLOOD_SOURCE_ID}_quake-{QUAKE_SOURCE_ID}"
            if args.scenario
            else f"flood-custom_quake-{QUAKE_SOURCE_ID}"
        ),
        "sources": {
            "flood": {
                "id": FLOOD_SOURCE_ID if args.scenario else "custom",
                "label": FLOOD_SOURCE_LABEL if args.scenario else "CLI指定CSV",
                "files": [rel(c) for c in csvs],
            },
            "quake": {
                "id": QUAKE_SOURCE_ID,
                "label": QUAKE_SOURCE_LABEL,
                "file": rel(QUAKE_GPKG),
            },
        },
        "scope": {
            "id": (
                "kitasenju-ueno"
                if origin == tuple(ORIGIN_DEFAULT) and dest == tuple(DEST_DEFAULT)
                else "custom"
            ),
            "margin_km": args.margin_km,
        },
        "bbox_left_bottom_right_top": list(bbox),
        "origin_latlon": list(origin),
        "dest_latlon": list(dest),
        "origin_node": int(orig_node),
        "dest_node": int(dest_node),
        "network_type": args.network_type,
        "sample_interval_m": args.sample_m,
        "nodes": G.number_of_nodes(),
        "edges": G.number_of_edges(),
        "impassable_edges": n_impassable,
        "impassable_finite_fallback": IMPASSABLE_FINITE,
        "passable_subgraph_connects_od": ok,
        "edge_depth_pct_length_weighted": stats,
        "hazard_cost_bins": {
            "<0.10": 1.0,
            "<0.20": 1.3,
            "<0.30": 2.0,
            "<0.50": 4.0,
            "<1.00": 12.0,
            ">=1.00": "inf",
        },
        "coverage_penalty": COVERAGE_PENALTY,
        "quake": quake,
    }
    meta_path = os.path.splitext(args.out)[0] + "_meta.json"
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta_out, f, ensure_ascii=False, indent=2)
    print(f"saved: {meta_path}")

    if args.graphml:
        gml = os.path.splitext(args.out)[0] + ".graphml"
        H = G.copy()
        for _, _, d in H.edges(data=True):
            # GraphMLはinfを往復できないので有限値に落とす（pickle側は inf のまま）
            if math.isinf(d.get("hazard_cost", 0.0)):
                d["hazard_cost"] = IMPASSABLE_FINITE
        ox.save_graphml(H, gml)
        print(f"saved: {gml} ({os.path.getsize(gml) / 1e6:.1f} MB)")

    # 7) SPEC 3 の実測値との照合
    if not args.skip_spec_check:
        print(
            "\n--- SPEC 3 の実測値との照合（生の点群, 緯度35.705-35.760 / 経度139.770-139.812） ---"
        )
        got = verify_spec_stats(csvs[0])
        diffs = []
        for k, exp in SPEC_STATS_EXPECTED.items():
            g = got[k]
            if k == "n_points":
                mark = "OK" if g == exp else "DIFF"
                if g != exp:
                    diffs.append(k)
                print(f"  {k:>9}: spec={exp:>10,}  got={g:>10,}  {mark}")
            else:
                mark = "OK" if abs(g - exp) < 0.15 else "DIFF"
                if mark == "DIFF":
                    diffs.append(k)
                print(f"  {k:>9}: spec={exp:>6.1f}%  got={g:>6.1f}%  {mark}")
        if diffs:
            print(
                f"  ! SPECの記載と食い違い: {diffs} — データ更新の可能性あり。報告すること。"
            )
        else:
            print("  all match — SPEC 3 の数値は再現できた。")


if __name__ == "__main__":
    sys.exit(main())
