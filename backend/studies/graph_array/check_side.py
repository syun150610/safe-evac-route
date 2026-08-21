"""ジオメトリ・道路名・スナップの移植確認（段階4）。

照合（verify）は経路上のエッジしか通らない。ここでは

  1. 遅延ロードが**本当に遅延している**か（探索だけでは読まれないか）
  2. `edge_orig` 経由のジオメトリ・道路名が**全エッジで**正しいか
  3. 最寄りノードとスナップ距離が、無作為な地点でも現行と一致するか

を見る。3は同着（複数ノードが同じ距離）が起きた件数も数える。
"""

from __future__ import annotations

import numpy as np

from app.services.evac_routes.search import _graph_file
from prep.route_search import csr_search as A
from prep.route_search.csr_graph import load_csr
from prep.route_search.csr_view import CsrGraphView
from prep.route_search.npz_graph import load_graph_npz
from prep.route_search.snap import graph_bbox
from prep.route_search.snap import nearest_node as nx_nearest
from prep.route_search.snap import snap_m as nx_snap

SCENARIO = "envelope"
SEED = 20260821
N_POINTS = 5000


def check_lazy(path: str) -> None:
    g = load_csr(path)
    assert g._geometry is None and g._names is None
    print("  ロード直後: geometry/names とも未読み込み")

    o = A.nearest_node(g, 35.7497, 139.8050)
    d = A.nearest_node(g, 35.7141, 139.7774)
    A.shortest_path(g, o, d, ("flood", "quake"))
    state = (g._geometry is None, g._names is None)
    print(f"  探索1回のあと: 未読み込みのまま = {state}")
    if state != (True, True):
        raise SystemExit("探索がジオメトリ・道路名を読んでいる（遅延の意味が無い）")

    view = CsrGraphView(g)
    view.edge_attrs(0)
    loaded = (g._geometry is not None, g._names is not None)
    print(f"  応答組み立て（1エッジ）のあと: 読み込み済み = {loaded}")
    if loaded != (True, True):
        raise SystemExit("応答組み立てで読み込まれていない")
    side = g.side_nbytes()
    print(f"  読み込んだ量: {sum(side.values()):,}B {side}")


def check_all_edges(path: str) -> None:
    """全エッジのジオメトリ・道路名を NetworkX 復元と突き合わせる。"""
    g = load_csr(path)
    view = CsrGraphView(g)
    G = load_graph_npz(path)
    bad = 0
    n_geom = n_name = 0
    for slot in range(g.n_edges):
        u = int(g.node_id[int(g.edge_src[slot])])
        v = int(g.node_id[int(g.edge_to[slot])])
        k = int(g.edge_key[slot])
        a = view.edge_attrs(slot)
        b = G[u][v][k]
        if ("name" in a) != ("name" in b) or a.get("name") != b.get("name"):
            bad += 1
        if "name" in b:
            n_name += 1
        ga, gb = a.get("geometry"), b.get("geometry")
        if (ga is None) != (gb is None):
            bad += 1
        elif ga is not None:
            n_geom += 1
            if list(ga.coords) != list(gb.coords):
                bad += 1
    print(f"  全{g.n_edges:,}エッジ: ジオメトリ持ち {n_geom:,} / 道路名持ち {n_name:,}")
    print(f"  不一致 {bad}箇所")
    if bad:
        raise SystemExit("ジオメトリ・道路名が一致しない")


def check_snap(path: str) -> None:
    g = load_csr(path)
    G = load_graph_npz(path)
    left, bottom, right, top = graph_bbox(path)
    rng = np.random.default_rng(SEED)
    bad = 0
    ties = 0
    for _ in range(N_POINTS):
        lat = float(rng.uniform(bottom, top))
        lon = float(rng.uniform(left, right))
        a = A.nearest_node(g, lat, lon)
        b = nx_nearest(G, lat, lon)
        if a != b:
            bad += 1
            print(f"  最寄りノード差: ({lat:.6f},{lon:.6f}) array={a} nx={b}")
        if A.snap_m(g, a, lat, lon) != nx_snap(G, b, lat, lon):
            bad += 1
        kx = np.cos(np.radians(lat))
        d2 = ((g.node_x - lon) * kx) ** 2 + (g.node_y - lat) ** 2
        if int((d2 == d2.min()).sum()) > 1:
            ties += 1
    print(f"  {N_POINTS:,}地点: 不一致 {bad}箇所 / 同着が起きた地点 {ties}件")
    if bad:
        raise SystemExit("スナップが一致しない")


def check_tie_break(path: str) -> None:
    """同着の決め方の確認。

    ⚠️ 現行グラフには同一座標のノードが無く、無作為5,000地点でも同着は起きない。
    そのままでは `node_orig` の分岐が一度も通らないので、**わざと同じ座標を作って**
    NetworkX版（NPZの並びで先に来た方）と一致するかを見る。
    """
    g = load_csr(path)
    G = load_graph_npz(path)
    checked = 0
    for a_sorted, b_sorted in ((0, 1), (5, 3), (100, 20)):
        ax, ay = float(g.node_x[a_sorted]), float(g.node_y[a_sorted])
        b_id = int(g.node_id[b_sorted])
        keep = (float(g.node_x[b_sorted]), float(g.node_y[b_sorted]))
        g.node_x[b_sorted], g.node_y[b_sorted] = ax, ay
        G.nodes[b_id]["x"], G.nodes[b_id]["y"] = ax, ay
        got = A.nearest_node(g, ay, ax)
        want = nx_nearest(G, ay, ax)
        orig = (int(g.node_orig[a_sorted]), int(g.node_orig[b_sorted]))
        print(f"  同着2ノード（元の並び {orig}）: array={got} nx={want}")
        if got != want:
            raise SystemExit("同着の決め方が現行と違う")
        # 元に戻す
        g.node_x[b_sorted], g.node_y[b_sorted] = keep
        G.nodes[b_id]["x"], G.nodes[b_id]["y"] = keep
        checked += 1
    print(f"  {checked}組とも一致")


def main() -> None:
    path = _graph_file(SCENARIO)
    print(f"NPZ: {path}")
    print("\n[1] 遅延ロードの確認")
    check_lazy(path)
    print("\n[2] 全エッジのジオメトリ・道路名")
    check_all_edges(path)
    print("\n[3] 最寄りノードとスナップ距離")
    check_snap(path)
    print("\n[4] 同着（人工的に作った場合）")
    check_tie_break(path)
    print("\nOK: 4項目とも現行と一致")


if __name__ == "__main__":
    main()
