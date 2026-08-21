"""CSRローダの実測。**配列本体の実サイズ**とロード時間を出す。

    python -m studies.graph_array.measure_csr
    python -m studies.graph_array.measure_csr --check   # NetworkX復元との同一性も見る

⚠️ 出す数字は実測だけ。外挿はここでは行わず、呼び出し側（報告）で明示する。
"""

from __future__ import annotations

import gc
import os
import time

import numpy as np

from app.services.evac_routes.search import _graph_file
from prep.route_search.csr_graph import load_csr

SCENARIO = "envelope"


def rss() -> int:
    with open("/proc/self/status") as f:
        for line in f:
            if line.startswith("VmRSS"):
                return int(line.split()[1]) * 1024
    raise RuntimeError("VmRSS が読めない")


def check_against_networkx(path: str, g) -> None:
    """CSRとNetworkX復元が**同じエッジ集合・同じ値**を持つことを確認する。"""
    from prep.route_search.npz_graph import load_graph_npz

    G = load_graph_npz(path)
    if G.number_of_nodes() != g.n_nodes or G.number_of_edges() != g.n_edges:
        raise SystemExit("ノード数・エッジ数が違う")

    fields = list(g.edge_float)
    bad = 0
    seen = 0
    for u, v, k, attrs in G.edges(keys=True, data=True):
        ui = g.node_index(u)
        sl = g.out_slice(ui)
        vi = g.node_index(v)
        hit = [
            i
            for i in range(sl.start, sl.stop)
            if int(g.edge_to[i]) == vi and int(g.edge_key[i]) == k
        ]
        if len(hit) != 1:
            bad += 1
            continue
        i = hit[0]
        seen += 1
        for name in fields:
            if float(g.edge_float[name][i]) != float(attrs[name]):
                bad += 1
                print(
                    f"  差: {(u, v, k)} {name} {g.edge_float[name][i]} != {attrs[name]}"
                )
        if bool(g.edge_impassable[i]) != bool(attrs["impassable"]):
            bad += 1
        rank = int(g.edge_quake_rank_total[i])
        expected = (
            -1 if attrs["quake_rank_total"] is None else attrs["quake_rank_total"]
        )
        if rank != expected:
            bad += 1
    # ノード座標
    for idx in range(g.n_nodes):
        nid = int(g.node_id[idx])
        if G.nodes[nid]["x"] != g.node_x[idx] or G.nodes[nid]["y"] != g.node_y[idx]:
            bad += 1
    print(f"  照合: {seen:,}エッジ / 不一致 {bad}箇所")
    if bad:
        raise SystemExit("CSRとNetworkX復元が一致しない")


def main() -> None:
    import argparse

    ap = argparse.ArgumentParser(description="CSRローダの実測")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--scenario", default=SCENARIO)
    args = ap.parse_args()

    path = _graph_file(args.scenario)
    print(f"NPZ: {os.path.basename(path)} ({os.path.getsize(path):,}B)")

    gc.collect()
    base = rss()
    t0 = time.perf_counter()
    g = load_csr(path)
    t_load = time.perf_counter() - t0
    after_core = rss()

    core = g.core_nbytes()
    core_total = sum(core.values())
    e, n = g.n_edges, g.n_nodes
    print(f"ノード {n:,} / エッジ {e:,}")
    print(f"\n[CSR構築] {t_load * 1000:.0f}ms  ({t_load / e * 1e6:.2f} us/edge)")
    for _ in range(2):
        t = time.perf_counter()
        load_csr(path)
        print(f"  再測定: {(time.perf_counter() - t) * 1000:.0f}ms")

    print(
        f"\n[配列本体のサイズ] core 合計 {core_total:,}B = {core_total / e:.2f} B/edge"
    )
    for k, v in sorted(core.items(), key=lambda kv: -kv[1]):
        per = v / (n if k.startswith("node") else e)
        unit = "B/node" if k.startswith("node") else "B/edge"
        print(f"  {k:24s} {v:>10,}B  {per:7.2f} {unit}")

    t0 = time.perf_counter()
    geom = g.geometry
    names = g.names
    t_side = time.perf_counter() - t0
    side = g.side_nbytes()
    side_total = sum(side.values())
    after_side = rss()
    per_side = side_total / e
    print(f"\n[遅延ロード分] {t_side * 1000:.0f}ms")
    print(f"  合計 {side_total:,}B = {per_side:.2f} B/edge")
    print(f"  geometry {side['geometry']:,}B（頂点 {geom.xy_e6.shape[0]:,}）")
    print(f"  names    {side['names']:,}B（辞書 {names.values.shape[0]}件）")

    print("\n[プロセスRSSの変化（参考。配列以外も含む）]")
    d_core = (after_core - base) / 1e6
    d_side = (after_side - base) / 1e6
    print(f"  ロード前 {base / 1e6:.1f}MB")
    print(f"  core後 {after_core / 1e6:.1f}MB（差 {d_core:.1f}MB）")
    print(f"  遅延分も {after_side / 1e6:.1f}MB（差 {d_side:.1f}MB）")

    if args.check:
        print("\n[NetworkX復元との同一性]")
        check_against_networkx(path, g)

    del geom, names
    _ = np.empty(0)


if __name__ == "__main__":
    main()
