"""CSR配列の上での探索。**アルゴリズム・コスト式は現行と同じもの。**

置き換えたのは「グラフの持ち方」だけで、次は現行と同一にしてある。

  * 重み: `length × Π cost_h`（`prep.route_search.weights.edge_cost` と同じ順序）
  * 通行不可: `cost_flood` が inf のとき `length × IMPASSABLE_FINITE`
    （既存の規則。**新しい番兵値は導入しない**）
  * 平行エッジ: 同じ (u,v) は最小コストで緩和する
  * 同着: networkx の `_dijkstra_multisource` と同じ扱い
    （strict `<` でのみ更新、押し込み順を保つ、先に見つけた前任者を残す）

⚠️ コストは**リクエストのたびに**計算する。組み合わせごとの重み配列は持たない。
"""

from __future__ import annotations

import math
from heapq import heappop, heappush
from itertools import count

import numpy as np

from prep.hazard_sources.flood.cost import IMPASSABLE_FINITE
from prep.route_search.csr_graph import CsrGraph

# `weights.cost_key` と同じ並び（sorted された種別ID → cost_<id>）
COST_FIELD = {"flood": "cost_flood", "quake": "cost_quake"}


def edge_costs(g: CsrGraph, hazards) -> np.ndarray:
    """全エッジの重み（float64）。**リクエスト時に掛け合わせる。**

    ⚠️ 掛ける順序は `length × cost_flood × cost_quake`。浮動小数の乗算に結合則は
    無いので、順序を変えると最下位ビットがずれる（weights.py の注意書きと同じ理由）。
    """
    length = g.edge_float["length"].astype(np.float64)
    hs = tuple(sorted(hazards or ()))
    if not hs:
        return length
    out = length.copy()
    inf = np.zeros(out.shape, dtype=bool)
    for h in hs:
        c = g.edge_float[COST_FIELD[h]].astype(np.float64)
        inf |= np.isinf(c)
        out = out * np.where(np.isinf(c), 1.0, c)
    # inf を含む種別が1つでもあれば、既存と同じく length の有限フォールバックへ落とす
    return np.where(inf, length * IMPASSABLE_FINITE, out)


def dijkstra(
    g: CsrGraph, source: int, target: int, cost: np.ndarray, mask=None
) -> list[int]:
    """ノード添字で最短経路を返す。networkx の Dijkstra と同じ順序で緩和する。

    `mask` を渡すと False のエッジは**無いものとして**扱う（部分グラフ相当）。
    """
    node_offset = g.node_offset
    edge_to = g.edge_to
    dist: dict[int, float] = {}
    seen = {source: 0.0}
    pred: dict[int, int] = {}
    c = count()
    fringe: list[tuple[float, int, int]] = [(0.0, next(c), source)]
    while fringe:
        dist_v, _, v = heappop(fringe)
        if v in dist:
            continue
        dist[v] = dist_v
        if v == target:
            break
        # ⚠️ networkx は「隣接ノード単位」で緩和する（平行エッジは min）。
        #    スロット単位で押し込むと同着の順序が変わるので、必ずまとめる。
        best: dict[int, float] = {}
        for i in range(int(node_offset[v]), int(node_offset[v + 1])):
            if mask is not None and not mask[i]:
                continue
            u = int(edge_to[i])
            w = float(cost[i])
            if u not in best or w < best[u]:
                best[u] = w
        for u, w in best.items():
            vu_dist = dist_v + w
            if u in dist:
                continue
            if u not in seen or vu_dist < seen[u]:
                seen[u] = vu_dist
                heappush(fringe, (vu_dist, next(c), u))
                pred[u] = v
    if target not in dist:
        raise ValueError(f"経路が無い: {source} -> {target}")
    path = [target]
    while path[-1] in pred:
        path.append(pred[path[-1]])
    path.reverse()
    return path


def shortest_path(g: CsrGraph, source_id: int, target_id: int, hazards) -> list[int]:
    """OSMノードIDで最短経路を返す。"""
    cost = edge_costs(g, hazards)
    idx = dijkstra(g, g.node_index(source_id), g.node_index(target_id), cost)
    return [int(g.node_id[i]) for i in idx]


def nearest_node(g: CsrGraph, lat: float, lon: float) -> int:
    """`snap.nearest_node` と同じ式・同じ同着の決め方。

    ⚠️ 現行は NPZ の並び順で `argmin` を取る。CSR はノードIDでソートしてあるので、
    同着のときだけ `node_orig`（元の並び）が小さい方を選んで一致させる。
    """
    kx = math.cos(math.radians(lat))
    d2 = ((g.node_x - lon) * kx) ** 2 + (g.node_y - lat) ** 2
    best = float(d2.min())
    tied = np.flatnonzero(d2 == best)
    if tied.size == 1:
        return int(g.node_id[int(tied[0])])
    return int(g.node_id[int(tied[int(np.argmin(g.node_orig[tied]))])])


def snap_m(g: CsrGraph, node_id: int, lat: float, lon: float) -> float:
    i = g.node_index(node_id)
    dx = (float(g.node_x[i]) - lon) * 111_320.0 * math.cos(math.radians(lat))
    dy = (float(g.node_y[i]) - lat) * 111_320.0
    return math.hypot(dx, dy)


def _reachable(g: CsrGraph, source: int, target: int, mask: np.ndarray) -> bool:
    """mask が True のエッジだけで source から target へ到達できるか（有向）。"""
    if source == target:
        return True
    seen = np.zeros(g.n_nodes, dtype=bool)
    seen[source] = True
    stack = [source]
    node_offset = g.node_offset
    edge_to = g.edge_to
    while stack:
        v = stack.pop()
        for i in range(int(node_offset[v]), int(node_offset[v + 1])):
            if not mask[i]:
                continue
            u = int(edge_to[i])
            if not seen[u]:
                if u == target:
                    return True
                seen[u] = True
                stack.append(u)
    return False


def min_achievable_max_depth(g: CsrGraph, source_id: int, target_id: int):
    """`prep.route_search.search.min_achievable_max_depth` と同じ二分探索。

    深さの候補値を昇順に並べ、「その閾値以下のエッジだけで連結するか」を二分探索し、
    決まった閾値の中で length 最短の経路を取る。
    ⚠️ 閾値を超えるエッジは**存在しないものとして扱う**（重みを大きくするのではない）。
    `nx.subgraph_view(filter_edge=...)` と同じ扱いにするため。
    """
    depth = g.edge_float["depth_max"].astype(np.float64)
    vals = np.unique(depth)
    source = g.node_index(source_id)
    target = g.node_index(target_id)
    if not _reachable(g, source, target, depth <= vals[-1]):
        return None, None, None

    lo, hi = 0, len(vals) - 1
    while lo < hi:
        mid = (lo + hi) // 2
        if _reachable(g, source, target, depth <= vals[mid]):
            hi = mid
        else:
            lo = mid + 1
    thr = float(vals[lo])

    mask = depth <= thr
    length = g.edge_float["length"].astype(np.float64)
    path = dijkstra(g, source, target, length, mask)
    return thr, [int(g.node_id[i]) for i in path], mask
