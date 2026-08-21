"""探索が遅いODの原因調査。**対処はしない。数えるだけ。**

本番の `csr_search.dijkstra` と**同じ手順**の計測用コピーを使い、
heapからpopした回数（＝確定させたノード数）を数える。
本番コードは変更しない。
"""

from __future__ import annotations

import math
import time
from heapq import heappop, heappush
from itertools import count

import numpy as np

from prep.route_search import bundles as B
from prep.route_search import csr_search as CS
from prep.route_search.csr_graph import load_csr
from prep.route_search.csr_view import CsrGraphView
from prep.route_search.search import resolve_path_edges, route_stats, stitch
from prep.route_search.weights import edge_cost

NPZ = "../data/processed/graph_build/area_envelope.npz"

OD = [
    ("三軒茶屋→渋谷", (35.6437, 139.6689), (35.6580, 139.7016)),
    ("北千住→上野", (35.7497, 139.8050), (35.7141, 139.7774)),
    ("立川→国分寺", (35.6980, 139.4130), (35.7003, 139.4805)),
    ("八王子駅周辺", (35.6558, 139.3389), (35.6700, 139.3200)),
    ("蒲田→三軒茶屋", (35.5620, 139.7160), (35.6437, 139.6689)),
    ("石神井→池袋", (35.7370, 139.5990), (35.7295, 139.7109)),
    ("葛西→錦糸町", (35.6650, 139.8720), (35.6970, 139.8146)),
    ("三鷹→吉祥寺", (35.7027, 139.5604), (35.7030, 139.5800)),
    ("町田駅周辺", (35.5430, 139.4470), (35.5530, 139.4360)),
    ("青梅→福生", (35.7880, 139.2750), (35.7386, 139.3266)),
]

COND = [
    ("距離のみ", ()),
    ("地震のみ", ("quake",)),
    ("浸水のみ", ("flood",)),
    ("浸水×地震", ("flood", "quake")),
]


def dijkstra_counted(g, source, target, cost):
    """`csr_search.dijkstra` と同じ手順。popした回数などを一緒に返す。"""
    node_offset, edge_to = g.node_offset, g.edge_to
    dist, seen, pred = {}, {source: 0.0}, {}
    c = count()
    fringe = [(0.0, next(c), source)]
    pops = pushes = 0
    max_heap = 1
    while fringe:
        dist_v, _, v = heappop(fringe)
        pops += 1
        if v in dist:
            continue
        dist[v] = dist_v
        if v == target:
            break
        best = {}
        for i in range(int(node_offset[v]), int(node_offset[v + 1])):
            u = int(edge_to[i])
            w = float(cost[i])
            if u not in best or w < best[u]:
                best[u] = w
        for u, w in best.items():
            if u in dist:
                continue
            vu = dist_v + w
            if u not in seen or vu < seen[u]:
                seen[u] = vu
                heappush(fringe, (vu, next(c), u))
                pushes += 1
                max_heap = max(max_heap, len(fringe))
                pred[u] = v
    path = [target]
    while path[-1] in pred:
        path.append(path[-1] if False else pred[path[-1]])
    path.reverse()
    return path, {
        "pops": pops,
        "finalized": len(dist),
        "pushes": pushes,
        "max_heap": max_heap,
        "dist_target": dist.get(target),
    }


def haversine_m(a, b):
    lat1, lon1 = a
    lat2, lon2 = b
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def cost_histogram(g):
    c = g.edge_float["cost_flood"].astype(np.float64)
    bins = [(0, 1.0), (1.0, 1.3), (1.3, 2.0), (2.0, 4.0), (4.0, 12.0), (12.0, np.inf)]
    print(f"[浸水コスト cost_flood の分布]（全 {g.n_edges:,} エッジ）")
    for lo, hi in bins:
        if np.isinf(hi):
            n = int(np.isinf(c).sum())
            label = "inf（→ length×1e6）"
        else:
            m = (c >= lo) & (c < hi) if lo else (c <= lo)
            n = int(m.sum())
            label = f"{lo:g} 以下" if not lo else f"{lo:g} 以上 {hi:g} 未満"
        pct = 100 * n / g.n_edges
        print(f"  {label:24s} {n:>9,} ({pct:5.2f}%)")


def local_inf_ratio(g, o_ll, d_ll, margin_deg=0.01):
    """OD周辺（bbox+margin）に含まれるエッジのうち、1e6置換されるものの割合。"""
    c = g.edge_float["cost_flood"].astype(np.float64)
    lat0, lat1 = sorted([o_ll[0], d_ll[0]])
    lon0, lon1 = sorted([o_ll[1], d_ll[1]])
    x = g.node_x[g.edge_src.astype(np.int64)]
    y = g.node_y[g.edge_src.astype(np.int64)]
    m = (
        (x >= lon0 - margin_deg)
        & (x <= lon1 + margin_deg)
        & (y >= lat0 - margin_deg)
        & (y <= lat1 + margin_deg)
    )
    n = int(m.sum())
    if n == 0:
        return 0, 0.0, 0.0
    inf_ratio = float(np.isinf(c[m]).mean())
    over1 = float((c[m] > 1.0).mean())
    return n, inf_ratio, over1


def main() -> None:
    g = load_csr(NPZ)
    view = CsrGraphView(g)
    view.edge_attrs(0)
    cost_histogram(g)
    print()

    rows = []
    for label, o_ll, d_ll in OD:
        o = CS.nearest_node(g, *o_ll)
        d = CS.nearest_node(g, *d_ll)
        oi, di = g.node_index(o), g.node_index(d)
        rec = {"label": label, "straight_m": haversine_m(o_ll, d_ll)}
        for cname, hz in COND:
            t0 = time.perf_counter()
            cost = CS.edge_costs(g, hz)
            t_cost = time.perf_counter() - t0
            t0 = time.perf_counter()
            path, st = dijkstra_counted(g, oi, di, cost)
            t_dij = time.perf_counter() - t0
            ids = [int(g.node_id[i]) for i in path]
            t0 = time.perf_counter()
            edges, _ = resolve_path_edges(
                view, ids, "length" if not hz else edge_cost(hz)
            )
            stats = route_stats(view, edges)
            stitch(view, edges)
            B.segment_features(view, edges, "x")
            t_asm = time.perf_counter() - t0
            rec[cname] = {
                "t_cost_ms": t_cost * 1000,
                "t_dij_ms": t_dij * 1000,
                "t_asm_ms": t_asm * 1000,
                "pops": st["pops"],
                "finalized": st["finalized"],
                "max_heap": st["max_heap"],
                "dist_target": st["dist_target"],
                "path_nodes": len(path),
                "distance_m": stats["distance_m"],
                "n_impassable": stats["n_impassable_edges"],
            }
        n_local, inf_ratio, over1 = local_inf_ratio(g, o_ll, d_ll)
        rec["local"] = {
            "edges": n_local,
            "inf_pct": 100 * inf_ratio,
            "over1_pct": 100 * over1,
        }
        rows.append(rec)

        f = rec["浸水×地震"]
        print(f"[{label}] 直線 {rec['straight_m']:.0f}m")
        for cname, _ in COND:
            r = rec[cname]
            ratio = r["pops"] / r["path_nodes"]
            print(
                f"   {cname:10s} {r['t_dij_ms']:8.0f}ms"
                f"  pop {r['pops']:>9,}  経路{r['path_nodes']:4d}ノード"
                f"  pop/経路 {ratio:8.0f}  距離{r['distance_m']:7.0f}m"
                f"  通行不可{r['n_impassable']:3d}本  d={r['dist_target']:.3e}"
            )
        loc = rec["local"]
        print(
            f"   周辺エッジ {loc['edges']:,} / 1e6置換 {loc['inf_pct']:.1f}%"
            f" / コスト1.0超 {loc['over1_pct']:.1f}%"
        )
        print(
            f"   内訳(浸水×地震) cost {f['t_cost_ms']:.0f}ms"
            f" + dij {f['t_dij_ms']:.0f}ms + 組立 {f['t_asm_ms']:.0f}ms"
        )
        print()
    return rows


if __name__ == "__main__":
    main()


# ---------------- 通行不可の置換値を変えた場合の実測（調査専用） ----------------
# ⚠️ **本番のコスト式は変更していない。** ここで作るコスト配列は診断用で、
#    `csr_search.edge_costs` の IMPASSABLE_FINITE 相当だけを差し替えたもの。

FALLBACKS = (1e6, 1e4, 1e3, 1e2)


def edge_costs_with(g, hazards, fallback: float) -> np.ndarray:
    """`csr_search.edge_costs` と同じ計算で、inf の置換値だけを変える。"""
    length = g.edge_float["length"].astype(np.float64)
    hs = tuple(sorted(hazards or ()))
    out = length.copy()
    inf = np.zeros(out.shape, dtype=bool)
    for h in hs:
        c = g.edge_float[CS.COST_FIELD[h]].astype(np.float64)
        inf |= np.isinf(c)
        out = out * np.where(np.isinf(c), 1.0, c)
    return np.where(inf, length * fallback, out)


def fallback_sweep() -> None:
    g = load_csr(NPZ)
    view = CsrGraphView(g)
    view.edge_attrs(0)
    hz = ("flood", "quake")
    targets = [
        ("三軒茶屋→渋谷", (35.6437, 139.6689), (35.6580, 139.7016)),
        ("葛西→錦糸町", (35.6650, 139.8720), (35.6970, 139.8146)),
        ("北千住→上野", (35.7497, 139.8050), (35.7141, 139.7774)),
        ("石神井→池袋", (35.7370, 139.5990), (35.7295, 139.7109)),
    ]
    for label, o_ll, d_ll in targets:
        o = CS.nearest_node(g, *o_ll)
        d = CS.nearest_node(g, *d_ll)
        oi, di = g.node_index(o), g.node_index(d)
        base_path = None
        print(f"[{label}]")
        for fb in FALLBACKS:
            cost = edge_costs_with(g, hz, fb)
            t0 = time.perf_counter()
            path, st = dijkstra_counted(g, oi, di, cost)
            t_dij = time.perf_counter() - t0
            ids = [int(g.node_id[i]) for i in path]
            edges, _ = resolve_path_edges(view, ids, edge_cost(hz))
            stats = route_stats(view, edges)
            if base_path is None:
                base_path = ids
                changed = "基準"
            else:
                changed = "同一" if ids == base_path else "**変化**"
            over = 100 * stats["ratio_over_03"]
            print(
                f"   {fb:>8.0e}: pop {st['pops']:>9,}  {t_dij * 1000:8.0f}ms"
                f"  d={st['dist_target']:.3e}  経路 {changed}"
                f"  距離 {stats['distance_m']:8.1f}m"
                f"  30cm超 {stats['length_over_03_m']:7.1f}m ({over:.1f}%)"
                f"  最大 {stats['max_depth_m']:.2f}m"
                f"  通行不可 {stats['n_impassable_edges']}本"
            )
        print()
