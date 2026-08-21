"""複製グラフでの規模別実測（段階5）。

    python -m studies.graph_array.bench_scale --npz <path> --k <倍率>

測るもの
  1. CSRロード時間とRSS（**起動直後**と、側の配列も載った**定常状態**を分ける）
  2. 探索1回の内訳（edge_costs / Dijkstra / 応答組み立て）
     - local … コピー0の中だけで完結するOD（現行と同じ北千住↔上野）
     - cross … コピー0からコピーK-1へ。グラフ全体を歩く最悪ケース
  3. edge_costs の一時配列を含むピークRSS
  4. 同時2〜3リクエスト（スレッド）での所要時間とRSS

⚠️ 合成データ（`replicate.py`）。道路網の形は現行コリドーのK倍複製。
"""

from __future__ import annotations

import gc
import threading
import time

from prep.route_search import bundles as B
from prep.route_search import csr_search as A
from prep.route_search.csr_graph import load_csr
from prep.route_search.csr_view import CsrGraphView
from prep.route_search.search import resolve_path_edges, route_stats, stitch
from prep.route_search.weights import edge_cost
from studies.graph_array.replicate import NODE_ID_STRIDE

HAZARDS = ("flood", "quake")
ORIGIN = (35.7497, 139.8050)  # 北千住
DEST = (35.7141, 139.7774)  # 上野


def _stat(name: str) -> int:
    with open("/proc/self/status") as f:
        for line in f:
            if line.startswith(name):
                return int(line.split()[1]) * 1024
    raise RuntimeError(f"{name} が読めない")


def rss() -> int:
    return _stat("VmRSS")


def peak() -> int:
    return _stat("VmHWM")


def median(xs: list[float]) -> float:
    xs = sorted(xs)
    return xs[len(xs) // 2]


def one_search(g, view, o_id, d_id, repeat=3) -> dict:
    """1リクエスト相当。内訳ごとに時間を取る。"""
    t_cost, t_dij, t_asm = [], [], []
    max_rss = rss()
    for _ in range(repeat):
        t0 = time.perf_counter()
        cost = A.edge_costs(g, HAZARDS)
        t_cost.append(time.perf_counter() - t0)
        max_rss = max(max_rss, rss())

        t0 = time.perf_counter()
        idx = A.dijkstra(g, g.node_index(o_id), g.node_index(d_id), cost)
        t_dij.append(time.perf_counter() - t0)
        max_rss = max(max_rss, rss())

        path = [int(g.node_id[i]) for i in idx]
        t0 = time.perf_counter()
        edges, _amb = resolve_path_edges(view, path, edge_cost(HAZARDS))
        route_stats(view, edges)
        stitch(view, edges)
        B.segment_features(view, edges, "combined")
        t_asm.append(time.perf_counter() - t0)
        max_rss = max(max_rss, rss())
        del cost
    return {
        "cost_s": median(t_cost),
        "dijkstra_s": median(t_dij),
        "assemble_s": median(t_asm),
        "total_s": median(t_cost) + median(t_dij) + median(t_asm),
        "nodes_on_path": len(path),
        "edges_on_path": len(edges),
        "max_rss": max_rss,
    }


def concurrent(g, view, o_id, d_id, n: int) -> dict:
    """同時nリクエスト。⚠️ CPython のGILがあるので、CPU律速な処理は重ならない。"""
    done = []
    max_rss = [rss()]
    stop = threading.Event()

    def watch():
        while not stop.is_set():
            max_rss[0] = max(max_rss[0], rss())
            time.sleep(0.01)

    def work():
        t0 = time.perf_counter()
        cost = A.edge_costs(g, HAZARDS)
        idx = A.dijkstra(g, g.node_index(o_id), g.node_index(d_id), cost)
        path = [int(g.node_id[i]) for i in idx]
        edges, _ = resolve_path_edges(view, path, edge_cost(HAZARDS))
        route_stats(view, edges)
        stitch(view, edges)
        B.segment_features(view, edges, "combined")
        done.append(time.perf_counter() - t0)

    watcher = threading.Thread(target=watch, daemon=True)
    watcher.start()
    threads = [threading.Thread(target=work) for _ in range(n)]
    t0 = time.perf_counter()
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    wall = time.perf_counter() - t0
    stop.set()
    watcher.join()
    return {"n": n, "wall_s": wall, "each_s": sorted(done), "max_rss": max_rss[0]}


def sequential(g, view, o_id, d_id, n: int) -> float:
    """同じ処理を1スレッドでn回。同時実行との比較用。"""
    t0 = time.perf_counter()
    for _ in range(n):
        cost = A.edge_costs(g, HAZARDS)
        idx = A.dijkstra(g, g.node_index(o_id), g.node_index(d_id), cost)
        path = [int(g.node_id[i]) for i in idx]
        edges, _ = resolve_path_edges(view, path, edge_cost(HAZARDS))
        route_stats(view, edges)
        stitch(view, edges)
        B.segment_features(view, edges, "combined")
    return time.perf_counter() - t0


def _report(label: str, r: dict) -> None:
    print(f"[探索 {label}] 合計 {r['total_s'] * 1000:.0f}ms")
    print(
        f"  cost {r['cost_s'] * 1000:.0f}ms / dijkstra {r['dijkstra_s'] * 1000:.0f}ms"
        f" / 組み立て {r['assemble_s'] * 1000:.0f}ms"
    )
    print(f"  経路 {r['nodes_on_path']}ノード / 最大RSS {r['max_rss'] / 1e6:.0f}MB")


def main() -> None:
    import argparse

    ap = argparse.ArgumentParser(description="複製グラフでの規模別実測")
    ap.add_argument("--npz", required=True)
    ap.add_argument("--k", type=int, required=True)
    ap.add_argument("--repeat", type=int, default=3)
    ap.add_argument("--skip-cross", action="store_true")
    args = ap.parse_args()

    gc.collect()
    base = rss()
    t0 = time.perf_counter()
    g = load_csr(args.npz)
    t_core = time.perf_counter() - t0
    rss_core = rss()

    view = CsrGraphView(g)
    t0 = time.perf_counter()
    view.edge_attrs(0)  # 側の配列（ジオメトリ・道路名）をここで読む
    t_side = time.perf_counter() - t0
    rss_side = rss()

    core = sum(g.core_nbytes().values())
    side = sum(g.side_nbytes().values())
    e, n = g.n_edges, g.n_nodes
    print(f"=== k={args.k}  nodes={n:,} edges={e:,} ===")
    print(f"[ロード] core {t_core:.2f}s / 側 {t_side:.2f}s")
    print(f"  配列実サイズ core {core / 1e6:.1f}MB / 側 {side / 1e6:.1f}MB")
    print(f"  RSS 起動前 {base / 1e6:.0f}MB")
    d_core = (rss_core - base) / 1e6
    d_side = (rss_side - base) / 1e6
    print(f"  RSS 起動直後(core) {rss_core / 1e6:.0f}MB（差 {d_core:.0f}MB）")
    print(f"  RSS 定常(core+側) {rss_side / 1e6:.0f}MB（差 {d_side:.0f}MB）")

    o_id = A.nearest_node(g, *ORIGIN)
    d_id = A.nearest_node(g, *DEST)
    local = one_search(g, view, o_id, d_id, args.repeat)
    _report("local", local)

    if not args.skip_cross and args.k > 1:
        far_id = d_id + NODE_ID_STRIDE * (args.k - 1)
        cross = one_search(g, view, o_id, far_id, max(1, args.repeat // 2))
        _report("cross", cross)

    for n_req in (1, 2, 3):
        c = concurrent(g, view, o_id, d_id, n_req)
        seq = sequential(g, view, o_id, d_id, n_req)
        each = " / ".join(f"{x * 1000:.0f}ms" for x in c["each_s"])
        print(f"[同時{n_req}] 全体 {c['wall_s'] * 1000:.0f}ms  個別 {each}")
        print(
            f"  逐次{n_req}回なら {seq * 1000:.0f}ms"
            f" / 同時実行中の最大RSS {c['max_rss'] / 1e6:.0f}MB"
        )

    print(f"[プロセスのピークRSS(VmHWM)] {peak() / 1e6:.0f}MB")


if __name__ == "__main__":
    main()
