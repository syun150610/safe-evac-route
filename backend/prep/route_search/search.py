#!/usr/bin/env python3
"""
タスクB: 経路探索とGeoJSON出力

build_graph.py が焼き込んだグラフから2本の経路を出す。

  baseline  weight="length"         単純最短（既存の地図アプリ相当）
  hazard    weight="weight_hazard"  ハザード重み付き（本作品の主張）

出力:
  data/processed/route.geojson           SPEC準拠。baseline / hazard の LineString 2本
  data/processed/route_analysis.geojson  タスクC用。経路をエッジ単位に割ったものと最小最大深経路
  data/processed/route_analysis.json     数値サマリ

使い方:
    python3 route.py
    python3 route.py --origin 35.7497 139.8050 --dest 35.7141 139.7774
"""
from __future__ import annotations

import argparse
import json
import math
import os
import pickle
import sys

import networkx as nx

# ⚠️ **graph.py から取らない。** あれは osmnx を import しているので、
#    ここ経由で API が osmnx を抱え込む（05_チーム移行案 §3-3）。
#    探索に要るぶんだけ snap.py に切り出してある
from prep.route_search.snap import (nearest_node, ORIGIN_DEFAULT, DEST_DEFAULT,
                                    OUT_DEFAULT, snap_m)
from prep.paths import OUT_DIR

# ---------------- 設定 ----------------
GRAPH_DEFAULT = OUT_DEFAULT
OUTDIR_DEFAULT = str(OUT_DIR)

WALK_SPEED_NORMAL = 80.0   # m/min 平常時（SPEC 4-2）
WALK_SPEED_DISASTER = 60.0  # m/min 災害時（SPEC 4-2）

DEPTH_THRESHOLD = 0.30     # ratio_over_03 の閾値。歩行困難ライン（SPEC 4-4）
# --------------------------------------


# ---------------- パラレルエッジの厳密な解決 ----------------

def resolve_path_edges(G, path, weight):
    """ノード列 -> 実際に使われた (u, v, key) 列。

    MultiDiGraph では同じ (u,v) に複数のエッジ（=key）がぶら下がる。
    networkx の Dijkstra は各 (u,v) について weight 最小のものを選んで緩和するので、
    **探索に使ったのと同じ weight で argmin を取る**のが厳密な復元になる。
    長さで選ぶと weight="weight_hazard" の経路では別のエッジを拾いうる。

    同点（weight が完全に一致する平行エッジ）は探索上どちらも最適なので
    key の小さい方を決定的に選ぶ。ただし同点かつ depth_max が異なる場合は
    統計値が選び方に依存してしまうので、件数を返して可視化できるようにする。

    `weight` は属性名（str）でも、エッジ1本ぶんの属性dictを取る関数でもよい。
    掛け合わせを探索時に計算する場合は `weights.edge_cost(hazards)` を渡す
    （事前計算した属性が無い組み合わせでも復元できるようにするため）。
    """
    val = (lambda a: a[weight]) if isinstance(weight, str) else weight
    edges, ambiguous = [], 0
    for u, v in zip(path[:-1], path[1:]):
        bundle = G[u][v]
        best_k = min(bundle, key=lambda k: (val(bundle[k]), k))
        best_w = val(bundle[best_k])
        tied = [k for k in bundle if val(bundle[k]) == best_w]
        if len(tied) > 1 and len({round(bundle[k]["depth_max"], 6) for k in tied}) > 1:
            ambiguous += 1
        edges.append((u, v, best_k))
    return edges, ambiguous


def edge_coords(G, u, v, k):
    """エッジのジオメトリを u -> v 向きの座標列 [(lon, lat), ...] で返す。

    simplify 済みグラフでは曲線路だけが 'geometry' を持つ。
    向きは保証されていないので、始点がノードuに近い方へ揃える
    （逆向きのまま繋ぐと経路が折り返して描画される）。
    """
    d = G[u][v][k]
    ux, uy = G.nodes[u]["x"], G.nodes[u]["y"]
    geom = d.get("geometry")
    if geom is None:
        return [(ux, uy), (G.nodes[v]["x"], G.nodes[v]["y"])]
    cs = [(x, y) for x, y in geom.coords]
    head = (cs[0][0] - ux) ** 2 + (cs[0][1] - uy) ** 2
    tail = (cs[-1][0] - ux) ** 2 + (cs[-1][1] - uy) ** 2
    if head > tail:
        cs.reverse()
    return cs


def stitch(G, edges):
    """エッジ列 -> 連続した1本の座標列（接合部の重複点を落とす）"""
    out = []
    for u, v, k in edges:
        cs = edge_coords(G, u, v, k)
        if out and out[-1] == cs[0]:
            cs = cs[1:]
        out.extend(cs)
    return out


# ---------------- 経路の統計 ----------------

def route_stats(G, edges):
    """SPEC 5 タスクB が要求するプロパティを実距離ベースで計算する。

    distance_m は weight ではなく length の総和（重み1e6倍が混ざらないように）。
    """
    total = 0.0
    over = 0.0
    dmax = 0.0
    dsum_w = 0.0     # 長さ重み付き平均深のため
    nocov = 0.0      # シナリオの想定範囲外の長さ
    n_impassable = 0
    qsum = qmax = q4 = qnocov = 0.0   # 地震（SPEC_C C-3）
    has_quake = False
    for u, v, k in edges:
        d = G[u][v][k]
        L = float(d["length"])
        dm = float(d["depth_max"])
        # 地震ハザード。属性を持たない旧グラフでも動くようにする
        if "quake_rank_total" in d:
            has_quake = True
            r = d["quake_rank_total"]
            qnocov += L * (1.0 - float(d.get("quake_coverage", 1.0)))
            if r is not None:
                qsum += float(r) * L
                qmax = max(qmax, float(r))
                if r >= 4:
                    q4 += L
        total += L
        dmax = max(dmax, dm)
        dsum_w += dm * L
        if dm > DEPTH_THRESHOLD:
            over += L
        # coverage は 1.0=全て想定範囲内。属性が無い旧グラフでは1.0扱い
        nocov += L * (1.0 - float(d.get("coverage", 1.0)))
        if d.get("impassable"):
            n_impassable += 1
    return {
        "distance_m": round(total, 1),
        "duration_min_80": round(total / WALK_SPEED_NORMAL, 1),
        "duration_min_60": round(total / WALK_SPEED_DISASTER, 1),
        "max_depth_m": round(dmax, 2),
        "ratio_over_03": round(over / total, 4) if total else 0.0,
        "mean_depth_m": round(dsum_w / total, 3) if total else 0.0,
        # このシナリオの浸水想定図が及んでいない区間の割合。
        # ここが大きいと、max_depth や ratio_over_03 の「低さ」は
        # 「安全」ではなく「評価できていない」を意味する。
        "out_of_coverage_ratio": round(nocov / total, 4) if total else 0.0,
        "length_over_03_m": round(over, 1),
        "n_edges": len(edges),
        "n_impassable_edges": n_impassable,
        # ---- 地震（総合危険度ランク）。旧 score_route.py の指標と同型 ----
        # ⚠️ ランクは都内での**相対評価**。「ランク1だから安全」ではない
        **({"quake_max_rank": int(qmax),
            "quake_r4plus_ratio": round(q4 / total, 4) if total else 0.0,
            "quake_weighted_avg_rank": round(qsum / total, 3) if total else 0.0,
            "quake_out_of_coverage_ratio": round(qnocov / total, 4) if total else 0.0}
           if has_quake else {}),
    }


# ---------------- ボトルネック解析（タスクC用の材料） ----------------

def min_achievable_max_depth(G, o, d):
    """起終点を結ぶ経路の「最大浸水深」を最小化したときの値（minimax / bottleneck path）。

    これが「0.40mは迂回不能か、係数不足で突っ切ったのか」を切り分ける決定的な指標。

      得られた値 == hazard経路の max_depth  -> それより浅い経路は物理的に存在しない
                                               = 迂回不能なボトルネック
      得られた値 <  hazard経路の max_depth  -> より浅い経路は存在したが選ばれなかった
                                               = 係数（またはコストとの釣り合い）の問題

    深さの候補値を二分探索し、その閾値以下のエッジだけで連結するかを見る。
    """
    vals = sorted({float(a["depth_max"]) for _, _, a in G.edges(data=True)})

    def reachable(thr):
        view = nx.subgraph_view(
            G, filter_edge=lambda u, v, k: G[u][v][k]["depth_max"] <= thr)
        return nx.has_path(view, o, d)

    if not reachable(vals[-1]):
        return None, None   # そもそも連結していない（起こらないはずだが保険）

    lo, hi = 0, len(vals) - 1
    while lo < hi:
        mid = (lo + hi) // 2
        if reachable(vals[mid]):
            hi = mid
        else:
            lo = mid + 1
    thr = vals[lo]

    # その閾値の中で最短のものを実際の経路として取る（＝最も浅く、その中で最短）
    view = nx.subgraph_view(G, filter_edge=lambda u, v, k: G[u][v][k]["depth_max"] <= thr)
    path = nx.shortest_path(view, o, d, weight="length")
    edges, _ = resolve_path_edges(view, path, "length")
    return thr, edges


def binding_segments(G, edges, depth):
    """経路上で depth 以上の深さを持つエッジ（＝そのボトルネックを構成する区間）"""
    return [(u, v, k) for u, v, k in edges
            if float(G[u][v][k]["depth_max"]) >= depth - 1e-9]


def escape_depth(G, node, others):
    """あるノードから others のどれかへ到達するのに、最低限くぐる必要のある最大深。

    「北千住駅周辺は浸水域の中心にあり、出発地点付近は物理的に迂回不能ではないか」
    という仮説を、起点だけ切り出して検証するためのもの。
    others は「そこまで行ければ後は自由」と見なす到達目標（ここでは終点）。
    """
    thr, _ = min_achievable_max_depth(G, node, others)
    return thr


# ---------------- GeoJSON ----------------

def feature(coords, props):
    return {"type": "Feature",
            "geometry": {"type": "LineString", "coordinates": [list(c) for c in coords]},
            "properties": props}


def segment_features(G, edges, route_name):
    """経路をエッジ単位のFeatureに割る。地図上で「どこが深いか」を色分けするため。"""
    feats = []
    for i, (u, v, k) in enumerate(edges):
        d = G[u][v][k]
        feats.append(feature(edge_coords(G, u, v, k), {
            "kind": "segment",
            "route": route_name,
            "seq": i,
            "u": int(u), "v": int(v), "key": int(k),
            "name": _name_of(d),
            "length_m": round(float(d["length"]), 1),
            "depth_max": round(float(d["depth_max"]), 2),
            "depth_mean": round(float(d["depth_mean"]), 2),
            "hazard_cost": (None if math.isinf(float(d["hazard_cost"]))
                            else round(float(d["hazard_cost"]), 2)),
            "impassable": bool(d.get("impassable", False)),
        }))
    return feats


def bottleneck_features(G, edges, thr, route_name, o_ll, d_ll, total):
    """経路上で thr 以上の深さを持つ区間を、ビューアで強調表示するためのFeatureにする。

    「ボトルネックが起終点ではなく中間にある」ことが地図上で一目で分かるよう、
    両端からの距離と経路上の位置(0..1)をプロパティに持たせる。
    """
    feats, run = [], 0.0
    for u, v, k in edges:
        e = G[u][v][k]
        L = float(e["length"])
        dm = float(e["depth_max"])
        if dm >= thr - 1e-9:
            cs = edge_coords(G, u, v, k)
            mx = sum(c[0] for c in cs) / len(cs)
            my = sum(c[1] for c in cs) / len(cs)
            feats.append(feature(cs, {
                "kind": "bottleneck", "route": route_name,
                "depth_max": round(dm, 2), "length_m": round(L, 1),
                "name": _name_of(e),
                "lon": round(mx, 6), "lat": round(my, 6),
                "dist_from_origin_km": round(_km(o_ll[0], o_ll[1], my, mx), 2),
                "dist_from_dest_km": round(_km(d_ll[0], d_ll[1], my, mx), 2),
                "route_frac": round(run / total, 3) if total else 0.0,
            }))
        run += L
    return feats


def _km(lat1, lon1, lat2, lon2):
    return math.hypot((lon1 - lon2) * 111.320 * math.cos(math.radians(lat1)),
                      (lat1 - lat2) * 111.320)


def _name_of(d):
    """OSMのname属性はstrだったりlistだったりする"""
    n = d.get("name")
    if isinstance(n, list):
        return ", ".join(str(x) for x in n)
    return n if isinstance(n, str) else None


# ---------------- main ----------------

def main():
    ap = argparse.ArgumentParser(description="ハザード考慮経路の探索とGeoJSON出力（タスクB）")
    ap.add_argument("--graph", default=GRAPH_DEFAULT, help="build_graph.py が出力した pickle")
    ap.add_argument("--origin", nargs=2, type=float, default=ORIGIN_DEFAULT,
                    metavar=("LAT", "LON"), help="起点（既定: 北千住駅）")
    ap.add_argument("--dest", nargs=2, type=float, default=DEST_DEFAULT,
                    metavar=("LAT", "LON"), help="終点（既定: 上野駅）")
    ap.add_argument("--outdir", default=OUTDIR_DEFAULT)
    ap.add_argument("--no-analysis", action="store_true",
                    help="ボトルネック解析と区間分割出力を省略")
    args = ap.parse_args()

    with open(args.graph, "rb") as f:
        G = pickle.load(f)
    print(f"graph: {args.graph}  nodes={G.number_of_nodes():,} edges={G.number_of_edges():,}")

    o_lat, o_lon = args.origin
    d_lat, d_lon = args.dest
    o = nearest_node(G, o_lat, o_lon)
    d = nearest_node(G, d_lat, d_lon)
    snap_o = snap_m(G, o, o_lat, o_lon)
    snap_d = snap_m(G, d, d_lat, d_lon)
    print(f"origin node={o} (snap {snap_o:.0f}m)   dest node={d} (snap {snap_d:.0f}m)")

    # --- 2本の経路 ---
    results = {}
    for name, w in (("baseline", "length"), ("hazard", "weight_hazard")):
        path = nx.shortest_path(G, o, d, weight=w)
        edges, ambiguous = resolve_path_edges(G, path, w)
        st = route_stats(G, edges)
        st["weight"] = w
        st["ambiguous_parallel_edges"] = ambiguous
        results[name] = {"edges": edges, "stats": st, "coords": stitch(G, edges)}
        print(f"\n[{name}] weight={w}")
        for k2 in ("distance_m", "duration_min_80", "duration_min_60",
                   "max_depth_m", "ratio_over_03", "mean_depth_m", "n_edges"):
            print(f"   {k2:16} = {st[k2]}")
        if ambiguous:
            print(f"   ! 同weight・異depth の平行エッジ {ambiguous}箇所（key昇順で決定的に選択）")
        if st["n_impassable_edges"]:
            print(f"   ! 通行不可(depth>=1.0m)エッジを {st['n_impassable_edges']}本 含む")

    base = results["baseline"]["stats"]
    haz = results["hazard"]["stats"]
    delta_pct = (haz["distance_m"] - base["distance_m"]) / base["distance_m"] * 100
    print(f"\n距離差: {haz['distance_m'] - base['distance_m']:+.0f}m ({delta_pct:+.1f}%)")
    print(f"浸水域(>0.3m)通過率: {base['ratio_over_03']*100:.1f}% -> {haz['ratio_over_03']*100:.1f}%")
    print(f"最大浸水深: {base['max_depth_m']:.2f}m -> {haz['max_depth_m']:.2f}m")

    os.makedirs(args.outdir, exist_ok=True)

    # --- SPEC準拠の出力 ---
    fc = {"type": "FeatureCollection", "features": [
        feature(results["baseline"]["coords"],
                {"route": "baseline", "label": "単純最短（距離のみ）", **base}),
        feature(results["hazard"]["coords"],
                {"route": "hazard", "label": "ハザード考慮", **haz}),
    ]}
    p = os.path.join(args.outdir, "route.geojson")
    with open(p, "w", encoding="utf-8") as f:
        json.dump(fc, f, ensure_ascii=False)
    print(f"\nsaved: {p}")

    if args.no_analysis:
        return

    # --- ボトルネック解析 ---
    print("\n--- ボトルネック解析 ---")
    thr, mm_edges = min_achievable_max_depth(G, o, d)
    if thr is None:
        print("  起終点が連結していない（想定外）")
        return
    mm_stats = route_stats(G, mm_edges)
    print(f"  到達可能な最小の最大浸水深 (minimax) = {thr:.2f}m")
    print(f"    その制約下での最短経路: {mm_stats['distance_m']:.0f}m "
          f"({(mm_stats['distance_m']-base['distance_m'])/base['distance_m']*100:+.1f}% vs baseline), "
          f"ratio>0.3m={mm_stats['ratio_over_03']*100:.1f}%")

    verdict_key = "bottleneck" if thr >= haz["max_depth_m"] - 1e-9 else "coefficient"
    if verdict_key == "bottleneck":
        print(f"  => 判定: 迂回不能。hazard経路の max_depth={haz['max_depth_m']:.2f}m は")
        print(f"     どう迂回しても避けられない下限（{thr:.2f}m）に達している。係数不足ではない。")
    else:
        print(f"  => 判定: 迂回余地あり。max_depth を {thr:.2f}m まで下げる経路は存在するが、")
        print(f"     hazard経路は {haz['max_depth_m']:.2f}m を選んだ。距離との釣り合いの問題。")

    # 起点・終点それぞれの「脱出に必要な深さ」
    # 北千住が浸水域中心にあるという仮説の検証
    esc_o = escape_depth(G, o, d)
    print(f"\n  起点(北千住)→終点 の minimax = {esc_o:.2f}m  … 上と同値（全経路の下限）")
    bind = binding_segments(G, results["hazard"]["edges"], haz["max_depth_m"])
    print(f"  hazard経路上で max_depth({haz['max_depth_m']:.2f}m) を作っている区間: {len(bind)}本")
    for u, v, k in bind[:10]:
        e = G[u][v][k]
        seq = results["hazard"]["edges"].index((u, v, k))
        frac = sum(float(G[a][b][c]["length"])
                   for a, b, c in results["hazard"]["edges"][:seq]) / haz["distance_m"]
        nm = _name_of(e) or "(名称なし)"
        print(f"    - {nm}  len={float(e['length']):.0f}m  depth={float(e['depth_max']):.2f}m"
              f"  経路の{frac*100:.0f}%地点")

    # --- 解析用GeoJSON ---
    o_ll, d_ll = (o_lat, o_lon), (d_lat, d_lon)
    afeats = []
    afeats += segment_features(G, results["baseline"]["edges"], "baseline")
    afeats += segment_features(G, results["hazard"]["edges"], "hazard")
    afeats += segment_features(G, mm_edges, "minimax")
    afeats.append(feature(stitch(G, mm_edges),
                          {"kind": "minimax", "route": "minimax",
                           "label": f"最大浸水深を最小化した経路 (max={thr:.2f}m)", **mm_stats}))
    # ボトルネック: hazard経路の最深区間と、minimax経路の下限を作っている区間
    bfeats = (bottleneck_features(G, results["hazard"]["edges"], haz["max_depth_m"],
                                  "hazard", o_ll, d_ll, haz["distance_m"])
              + bottleneck_features(G, mm_edges, thr,
                                    "minimax", o_ll, d_ll, mm_stats["distance_m"]))
    afeats += bfeats
    ap_ = os.path.join(args.outdir, "route_analysis.geojson")
    with open(ap_, "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": afeats}, f, ensure_ascii=False)
    n_seg = sum(1 for f in afeats if f["properties"]["kind"] == "segment")
    print(f"\nsaved: {ap_}  (segments={n_seg}, bottleneck={len(bfeats)}, minimax=1)")

    summary = {
        "origin_latlon": [o_lat, o_lon], "dest_latlon": [d_lat, d_lon],
        "origin_node": int(o), "dest_node": int(d),
        "snap_distance_m": {"origin": round(snap_o, 1), "dest": round(snap_d, 1)},
        "baseline": base, "hazard": haz,
        "distance_delta_m": round(haz["distance_m"] - base["distance_m"], 1),
        "distance_delta_pct": round(delta_pct, 2),
        "bottleneck": {
            "min_achievable_max_depth_m": round(thr, 2),
            "verdict": verdict_key,
            "minimax_route": mm_stats,
            "binding_segment_count": len(bind),
            "binding_segments": [
                {"u": int(u), "v": int(v), "key": int(k),
                 "name": _name_of(G[u][v][k]),
                 "length_m": round(float(G[u][v][k]["length"]), 1),
                 "depth_max": round(float(G[u][v][k]["depth_max"]), 2)}
                for u, v, k in bind],
        },
        "walk_speed_m_per_min": {"normal": WALK_SPEED_NORMAL, "disaster": WALK_SPEED_DISASTER},
        "depth_threshold_m": DEPTH_THRESHOLD,
    }
    sp = os.path.join(args.outdir, "route_analysis.json")
    with open(sp, "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    print(f"saved: {sp}")


if __name__ == "__main__":
    sys.exit(main())
