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


# ---------------- 目的地を決めずに探す（近隣の避難先） ----------------

# 1件目が見つかったあと、どこまでコストを伸ばして候補を集めるか。
# 「1件目のコスト × RATIO + FLOOR」を超えたら打ち切る。
# ⚠️ コストは `length × Π cost_h` で、係数はどれも 1.0 以上（flood.cost /
#    quake.cost）。よってコストは必ず距離(m)以上になり、FLOOR をメートルで
#    決めてよい。出発地が避難所ノードに一致して1件目が 0 になっても、
#    FLOOR のぶんは探して候補一覧を作れる。
CANDIDATE_COST_RATIO = 3.0
CANDIDATE_COST_FLOOR_M = 1000.0

# 打ち切りの最後の砦。1件も到達できないと全域（652,828ノード / 実測3.1秒）を
# 掘ってしまうので、settled 数で止める。実測の最大は 32,686（江戸川区平井）。
MAX_SETTLED = 150_000


def nearest_targets(
    g: CsrGraph,
    source_id: int,
    target_ids,
    hazards,
    k: int = 5,
    cost_ratio: float = CANDIDATE_COST_RATIO,
    cost_floor: float = CANDIDATE_COST_FLOOR_M,
    max_settled: int = MAX_SETTLED,
) -> list[tuple[int, float, list[int]]]:
    """**目的地を1つに決めずに**、近い目的地から順に k 件返す。

    `dijkstra` の `if v == target: break` を「目的地の集合」に替えただけで、
    緩和の順序・平行エッジの扱い・同着の決め方は**すべて同じ**。
    ダイクストラは確定した順がコスト昇順なので、k件目が確定した時点で
    打ち切れば上位k件は正しい。

    Returns:
        (目的地のノードID, コスト, 経路のノードID列) をコスト昇順で。
        到達できなければ空リスト。
    """
    targets = {g.node_index(t) for t in target_ids}
    source = g.node_index(source_id)
    cost = edge_costs(g, hazards)

    node_offset = g.node_offset
    edge_to = g.edge_to
    dist: dict[int, float] = {}
    seen = {source: 0.0}
    pred: dict[int, int] = {}
    c = count()
    fringe: list[tuple[float, int, int]] = [(0.0, next(c), source)]
    found: list[tuple[int, float]] = []
    limit: float | None = None
    settled = 0

    while fringe:
        dist_v, _, v = heappop(fringe)
        if v in dist:
            continue
        # 打ち切りは**取り出した直後**に見る。ここで止めれば、返した候補より
        # 安いものを見落とすことはない（fringe の先頭＝残りの最小コスト）
        if limit is not None and dist_v > limit:
            break
        settled += 1
        if settled > max_settled:
            break
        dist[v] = dist_v
        if v in targets:
            found.append((v, dist_v))
            if limit is None:
                limit = dist_v * cost_ratio + cost_floor
            if len(found) >= k:
                break
        # ⚠️ `dijkstra` と同じく隣接ノード単位で緩和する（平行エッジは min）
        best: dict[int, float] = {}
        for i in range(int(node_offset[v]), int(node_offset[v + 1])):
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

    out = []
    for node, dist_v in found:
        path = [node]
        while path[-1] in pred:
            path.append(pred[path[-1]])
        path.reverse()
        out.append((int(g.node_id[node]), dist_v, [int(g.node_id[i]) for i in path]))
    return out


# 最寄りノードを緯度で絞るときの初期の帯幅（度）。約445m。
# 帯の中の最良が帯幅より遠ければ、全域と一致しなくなるので広げ直す
_SNAP_BAND_DEG = 0.004
_DEG_M = 111_320.0


def _lat_sorted(g: CsrGraph):
    """緯度でソートしたノードの索引。**最初に要るときだけ作る。**

    652,828ノードで実測0.08秒、常駐は order(int32) + 緯度(float64) の約7.8MB。
    避難所4,811件を全部スナップしても0.26秒で、1件あたりは 0.06ms
    （`nearest_node` の総当たりは1件3ms）。
    """
    if g.lat_order is None:
        order = np.argsort(g.node_y, kind="stable")
        g.lat_order = order.astype(np.int32)
        g.lat_values = g.node_y[order]
    return g.lat_order, g.lat_values


def snap_many(g: CsrGraph, lats, lons):
    """複数地点の最寄りノードをまとめて求める。

    ⚠️ **`nearest_node` と同じ答えを返すこと。** 緯度の帯で候補を絞るだけで、
    距離の式も同着の決め方（`node_orig` が小さい方）も変えない。
    帯の中の最良が帯幅より遠い場合は、外にもっと近いノードがありうるので
    帯を広げ直す。

    Returns:
        (ノードID, 直線距離m) のリスト。見つからなければ (None, inf)。
    """
    order, values = _lat_sorted(g)
    out = []
    for la, lo in zip(lats, lons, strict=True):
        band = _SNAP_BAND_DEG
        kx = math.cos(math.radians(la))
        while True:
            a = int(np.searchsorted(values, la - band))
            b = int(np.searchsorted(values, la + band))
            if b > a:
                idx = order[a:b]
                d2 = ((g.node_x[idx] - lo) * kx) ** 2 + (values[a:b] - la) ** 2
                best = float(d2.min())
                # 帯の外にもっと近いノードが残っていないと言い切れるのは、
                # 最良が帯幅の内側に収まっているときだけ（|Δ緯度| ≤ 距離）
                if math.sqrt(best) <= band:
                    tied = np.flatnonzero(d2 == best)
                    if tied.size == 1:
                        i = int(idx[int(tied[0])])
                    else:
                        cand = idx[tied]
                        i = int(cand[int(np.argmin(g.node_orig[cand]))])
                    out.append((int(g.node_id[i]), math.sqrt(best) * _DEG_M))
                    break
            band *= 4
            if band > 1.0:  # 東京都をはみ出しても見つからない
                out.append((None, math.inf))
                break
    return out
