"""CSR配列を、既存の集計コードが読める形で**経路上のぶんだけ**見せる薄い層。

`route_stats` / `stitch` / `segment_features` / `resolve_path_edges` は
`G[u][v][k]` と `G.nodes[n]["x"]` しか使わない。ここではその2つだけを、
配列から**その場で**組み立てて返す。

⚠️ **グラフ全体を辞書化しない。** 触るのは要求されたノードの出エッジだけで、
1経路ぶんは数百エッジ。全域化してもここの常駐量は増えない。

⚠️ 集計・文言・判定は移植しない。既存の関数をそのまま呼ぶために形だけ合わせる。
"""

from __future__ import annotations

import numpy as np
from shapely.geometry import LineString

from studies.graph_array.csr import COORD_SCALE, CsrGraph


class _Nodes:
    def __init__(self, g: CsrGraph):
        self._g = g

    def __getitem__(self, node_id: int) -> dict:
        i = self._g.node_index(node_id)
        return {"x": float(self._g.node_x[i]), "y": float(self._g.node_y[i])}

    def __iter__(self):
        return (int(v) for v in self._g.node_id)

    def __len__(self) -> int:
        return self._g.n_nodes


class CsrGraphView:
    """NetworkX の MultiDiGraph と同じ読み方ができる、配列バックの窓口。"""

    def __init__(self, g: CsrGraph):
        self.csr = g
        self.nodes = _Nodes(g)

    # ---- NetworkX 互換の最小限 ----

    def is_multigraph(self) -> bool:
        return True

    def number_of_nodes(self) -> int:
        return self.csr.n_nodes

    def number_of_edges(self) -> int:
        return self.csr.n_edges

    def __getitem__(self, u: int) -> dict:
        """u の隣接。{v: {key: 属性dict}}。**その場で組み立てる。**"""
        g = self.csr
        ui = g.node_index(u)
        out: dict[int, dict[int, dict]] = {}
        for i in range(*self.csr.out_slice(ui).indices(g.n_edges)):
            v = int(g.node_id[int(g.edge_to[i])])
            out.setdefault(v, {})[int(g.edge_key[i])] = self.edge_attrs(i)
        return out

    # ---- 1エッジぶんの属性 ----

    def edge_attrs(self, slot: int) -> dict:
        """CSRの位置 → 既存コードが読む属性dict。

        ⚠️ float32 を `float()` で double へ広げるのは `npz_graph.load_graph_npz`
        と同じ扱い。ここを numpy スカラのまま渡すと丸めが変わりうる。
        """
        g = self.csr
        d = {name: float(arr[slot]) for name, arr in g.edge_float.items()}
        d["impassable"] = bool(g.edge_impassable[slot])
        rank = int(g.edge_quake_rank_total[slot])
        d["quake_rank_total"] = None if rank < 0 else rank
        orig = int(g.edge_orig[slot])
        name_index = int(g.names.index[orig])
        if name_index >= 0:
            d["name"] = str(g.names.values[name_index])
        geom = g.geometry
        start, end = int(geom.offsets[orig]), int(geom.offsets[orig + 1])
        if end > start:
            d["geometry"] = LineString(
                geom.xy_e6[start:end].astype(np.float64) / COORD_SCALE
            )
        return d
