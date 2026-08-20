"""探索時の掛け合わせが、事前計算した重みと一致することの確認。

`cost_{hazard}` の動的な掛け合わせが、
既存の `weight_hazard` / `weight_quake` / `weight_combined` と**同じ値・同じ経路**に
なることを担保する。ここが崩れると、検証記録 10章の数値と実装が食い違う。

前処理pickleグラフ（data/processed/graph）が要るので、無ければスキップする。

    cd backend && python3 tests/test_weights.py
"""

import pickle
import sys

import networkx as nx

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parents[1]))

from prep.paths import graph_path  # noqa: E402
from prep.route_search.od import P  # noqa: E402
from prep.route_search.weights import (  # noqa: E402
    baked_weight,
    edge_weight,
    equals_baked,
)

GRAPH = graph_path("kitasenju_ueno_envelope.pkl")
COMBOS = [("flood",), ("quake",), ("flood", "quake")]


def _load():
    import os

    if not os.path.exists(GRAPH):
        return None
    with open(GRAPH, "rb") as f:
        G = pickle.load(f)
    # 段3より前に焼いたグラフには cost_* が無い
    _, _, d = next(iter(G.edges(data=True)))
    if "cost_flood" not in d:
        print(f"skip: {GRAPH} は cost_* を持っていない（段3以降で焼き直すこと）")
        return None
    return G


def main():
    G = _load()
    if G is None:
        print(f"skip: {GRAPH} が無い（先に prep.route_search.graph を実行）")
        return 0

    ng = 0
    print(f"{G.number_of_edges():,} エッジで照合")
    for hs in COMBOS:
        bad, first = equals_baked(G, hs)
        print(f"  {str(hs):<20} → {baked_weight(hs):<16} 不一致 {bad:,}")
        if bad:
            print("     " + str(first))
            ng += 1

    # ⚠️ **graph からは取らない。** あれは osmnx を import しているので、
    #    APIと同じ依存だけを入れた環境（＝CI）では ModuleNotFoundError になる。
    #    探索側が要るぶんは snap に切り出してある
    from prep.route_search.snap import nearest_node

    o, d = nearest_node(G, *P["北千住"]), nearest_node(G, *P["上野"])
    for hs in [()] + COMBOS:
        pc = nx.shortest_path(G, o, d, weight=edge_weight(G, hs))
        pb = nx.shortest_path(G, o, d, weight=baked_weight(hs))
        same = pc == pb
        print(f"  {str(hs):<20} 経路一致={same} ({len(pc)} ノード)")
        if not same:
            ng += 1
    print("OK" if not ng else f"NG: {ng} 件")
    return 1 if ng else 0


def test_runtime_product_equals_baked():
    assert main() == 0


if __name__ == "__main__":
    sys.exit(main())
