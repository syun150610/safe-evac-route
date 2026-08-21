"""NPZ を CSR（圧縮行格納）配列として持つ読み込み器。

NetworkX の `MultiDiGraph` は 1エッジあたり Python オブジェクトを複数抱えるため、
実測で 1,267 B/edge かかる。ここでは同じ情報を **numpy 配列のまま** 持つ。

## 形

    node_id[N]              昇順に並べたノードID（元のOSM ID）
    node_x[N], node_y[N]    経度・緯度（float64。NPZ の e6 整数を復元したもの）
    node_offset[N+1]        CSR の行頭。u の出エッジは [offset[u], offset[u+1])
    edge_to[E]              行き先の**ノード添字**（ノードIDではない）
    edge_src[E]             出発の**ノード添字**（統計・逆引き用）
    edge_key[E]             平行エッジのkey（元のMultiDiGraphのkey）
    edge_orig[E]            NPZ内の元の並び順。ジオメトリ・道路名の逆引きに使う
    edge_*                  length / depth_max / depth_mean / cost_flood / cost_quake /
                            coverage / quake_coverage / impassable / quake_rank_total

## 方針（このspikeで守るもの）

⚠️ **生のハザード値をそのまま持つ。** `cost_flood` / `cost_quake` は前処理が
種別ごとに焼いた係数で、掛け合わせ（`length × Π cost`）は探索のたびに計算する。
種別の組み合わせごとの重み配列を**作らない**。

⚠️ **通行不可の番兵値を導入しない。** `cost_flood` の inf はそのまま inf として持つ。
探索時の有限フォールバック（`weights.edge_cost`）は既存の規則をそのまま使う。

⚠️ **並び順を壊さない。** CSR化は u で安定ソートするだけなので、同じ u の中の
並びは NPZ（＝元のMultiDiGraphの隣接順）のまま。同着経路の選ばれ方を変えないため。

## ジオメトリと道路名

探索は触らない（応答の組み立てだけが使う）。**別配列に分け、最初に必要になった
ときだけ読む。** どちらも元の並び（`edge_orig`）で持ち、CSR順への並べ替えはしない。
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

import numpy as np

COORD_SCALE = 1_000_000
SCHEMA_VERSION = 1

# 探索と統計が読むエッジ属性。NPZのdtypeのまま持つ（float32 → 使うときに float へ）
EDGE_FLOAT_FIELDS = (
    "length",
    "depth_max",
    "depth_mean",
    "cost_flood",
    "cost_quake",
    "coverage",
    "quake_coverage",
)


@dataclass
class Geometry:
    """曲がった道の頂点列。NPZの元の並び（edge_orig）で引く。"""

    offsets: np.ndarray  # int32[E_orig + 1]
    xy_e6: np.ndarray  # int32[V, 2]

    def nbytes(self) -> int:
        return int(self.offsets.nbytes + self.xy_e6.nbytes)


@dataclass
class Names:
    """道路名。辞書 + エッジごとの添字（-1 は名前なし）。"""

    values: np.ndarray  # <U..[名前の種類]
    index: np.ndarray  # int32[E_orig]

    def nbytes(self) -> int:
        return int(self.values.nbytes + self.index.nbytes)


@dataclass
class CsrGraph:
    path: str
    node_id: np.ndarray
    node_x: np.ndarray
    node_y: np.ndarray
    node_offset: np.ndarray
    edge_to: np.ndarray
    edge_src: np.ndarray
    edge_key: np.ndarray
    edge_orig: np.ndarray
    edge_impassable: np.ndarray
    edge_quake_rank_total: np.ndarray
    edge_float: dict[str, np.ndarray] = field(default_factory=dict)
    _geometry: Geometry | None = field(default=None, repr=False)
    _names: Names | None = field(default=None, repr=False)

    # ---- 基本情報 ----

    @property
    def n_nodes(self) -> int:
        return int(self.node_id.shape[0])

    @property
    def n_edges(self) -> int:
        return int(self.edge_to.shape[0])

    def node_index(self, node_id: int) -> int:
        """OSMノードID → 添字。無ければ KeyError。"""
        i = int(np.searchsorted(self.node_id, node_id))
        if i >= self.n_nodes or int(self.node_id[i]) != int(node_id):
            raise KeyError(f"ノードがグラフに無い: {node_id}")
        return i

    def out_slice(self, u_index: int) -> slice:
        return slice(int(self.node_offset[u_index]), int(self.node_offset[u_index + 1]))

    # ---- 遅延ロードする側 ----

    @property
    def geometry(self) -> Geometry:
        if self._geometry is None:
            with np.load(self.path, allow_pickle=False) as d:
                self._geometry = Geometry(d["geometry_offsets"], d["geometry_xy_e6"])
        return self._geometry

    @property
    def names(self) -> Names:
        if self._names is None:
            with np.load(self.path, allow_pickle=False) as d:
                self._names = Names(d["name_values"], d["edge_name_index"])
        return self._names

    def drop_side_arrays(self) -> None:
        """遅延ロード分を捨てる（常駐量を測るときに使う）。"""
        self._geometry = None
        self._names = None

    # ---- 実サイズ ----

    def core_nbytes(self) -> dict[str, int]:
        """探索・統計に要る配列だけの実バイト数。"""
        out = {
            "node_id": self.node_id.nbytes,
            "node_x": self.node_x.nbytes,
            "node_y": self.node_y.nbytes,
            "node_offset": self.node_offset.nbytes,
            "edge_to": self.edge_to.nbytes,
            "edge_src": self.edge_src.nbytes,
            "edge_key": self.edge_key.nbytes,
            "edge_orig": self.edge_orig.nbytes,
            "edge_impassable": self.edge_impassable.nbytes,
            "edge_quake_rank_total": self.edge_quake_rank_total.nbytes,
        }
        for name, arr in self.edge_float.items():
            out[f"edge_{name}"] = arr.nbytes
        return {k: int(v) for k, v in out.items()}

    def side_nbytes(self) -> dict[str, int]:
        """遅延ロード分（ジオメトリ・道路名）の実バイト数。読んでいなければ0。"""
        return {
            "geometry": self._geometry.nbytes() if self._geometry else 0,
            "names": self._names.nbytes() if self._names else 0,
        }


def load_csr(path: str) -> CsrGraph:
    """NPZ を CSR へ組み立てる。ジオメトリと道路名は読まない。"""
    with np.load(path, allow_pickle=False) as d:
        version = int(d["schema_version"][0])
        if version != SCHEMA_VERSION:
            raise ValueError(f"未対応のグラフNPZ schema_version={version}")

        raw_node_id = d["node_id"]
        node_xy = d["node_xy_e6"]
        # ノードIDは昇順に並べ替える（探索時の逆引きを searchsorted で済ませるため）
        order = np.argsort(raw_node_id, kind="stable")
        node_id = raw_node_id[order].astype(np.int64, copy=False)
        node_xy = node_xy[order]
        node_x = node_xy[:, 0].astype(np.float64) / COORD_SCALE
        node_y = node_xy[:, 1].astype(np.float64) / COORD_SCALE

        u = np.searchsorted(node_id, d["edge_u"]).astype(np.int32)
        v = np.searchsorted(node_id, d["edge_v"]).astype(np.int32)
        # ⚠️ 安定ソート。同じ u の中の並びは NPZ の並び（＝元の隣接順）のまま残す
        csr_order = np.argsort(u, kind="stable")

        n = node_id.shape[0]
        counts = np.bincount(u, minlength=n)
        node_offset = np.zeros(n + 1, dtype=np.int64)
        np.cumsum(counts, out=node_offset[1:])

        g = CsrGraph(
            path=os.path.abspath(path),
            node_id=node_id,
            node_x=node_x,
            node_y=node_y,
            node_offset=node_offset,
            edge_to=v[csr_order],
            edge_src=u[csr_order],
            edge_key=d["edge_key"][csr_order].astype(np.int32, copy=False),
            edge_orig=csr_order.astype(np.int32),
            edge_impassable=d["edge_impassable"][csr_order],
            edge_quake_rank_total=d["edge_quake_rank_total"][csr_order],
        )
        for name in EDGE_FLOAT_FIELDS:
            g.edge_float[name] = d[f"edge_{name}"][csr_order]
    return g
