"""圧縮NPZとして配布する経路探索グラフの読み書き。

pickle に入っている OSMnx / NetworkX / Shapely の器を配らず、APIが使う属性だけを
配列化する。読み込み時に MultiDiGraph を復元するので、探索・統計・GeoJSON生成は
既存コードをそのまま使える。
"""

from __future__ import annotations

import os

import networkx as nx
import numpy as np
from shapely.geometry import LineString

SCHEMA_VERSION = 1
COORD_SCALE = 1_000_000
FLOAT_FIELDS = (
    "length",
    "depth_max",
    "depth_mean",
    "cost_flood",
    "cost_quake",
    "coverage",
    "quake_coverage",
)
FLOAT64_FIELDS = {"depth_mean"}


def _edge_name(attrs) -> str | None:
    value = attrs.get("name")
    if isinstance(value, list):
        return ", ".join(str(item) for item in value)
    return value if isinstance(value, str) else None


def _coords_e6(coords) -> np.ndarray:
    """APIの6桁丸めと同じ結果を、圧縮しやすい整数で保持する。"""
    values = np.asarray(coords, dtype=np.float64)
    flat = np.fromiter(
        (round(round(float(value), 6) * COORD_SCALE) for value in values.flat),
        dtype=np.int32,
        count=values.size,
    )
    return flat.reshape(values.shape)


def graph_arrays(graph: nx.MultiDiGraph) -> dict[str, np.ndarray]:
    """MultiDiGraph を object dtype を含まない配列へ変換する。"""
    node_ids = np.fromiter(graph.nodes, dtype=np.int64, count=graph.number_of_nodes())
    node_xy_e6 = _coords_e6(
        [(graph.nodes[node]["x"], graph.nodes[node]["y"]) for node in node_ids]
    )

    edges = list(graph.edges(keys=True, data=True))
    edge_u = np.fromiter((u for u, _v, _k, _a in edges), dtype=np.int64)
    edge_v = np.fromiter((v for _u, v, _k, _a in edges), dtype=np.int64)
    edge_key = np.fromiter((key for _u, _v, key, _a in edges), dtype=np.int32)

    arrays: dict[str, np.ndarray] = {
        "schema_version": np.asarray([SCHEMA_VERSION], dtype=np.uint16),
        "node_id": node_ids,
        "node_xy_e6": node_xy_e6,
        "edge_u": edge_u,
        "edge_v": edge_v,
        "edge_key": edge_key,
    }
    for field in FLOAT_FIELDS:
        arrays[f"edge_{field}"] = np.fromiter(
            (attrs[field] for *_edge, attrs in edges),
            dtype=np.float64 if field in FLOAT64_FIELDS else np.float32,
        )

    arrays["edge_impassable"] = np.fromiter(
        (attrs.get("impassable", False) for *_edge, attrs in edges), dtype=np.bool_
    )
    arrays["edge_quake_rank_total"] = np.fromiter(
        (
            -1 if attrs.get("quake_rank_total") is None else attrs["quake_rank_total"]
            for *_edge, attrs in edges
        ),
        dtype=np.int8,
    )

    names: list[str] = []
    name_ids: dict[str, int] = {}
    name_index = np.full(len(edges), -1, dtype=np.int32)
    geometry_offsets = np.zeros(len(edges) + 1, dtype=np.int32)
    geometry_parts: list[np.ndarray] = []
    for index, (_u, _v, _key, attrs) in enumerate(edges):
        name = _edge_name(attrs)
        if name is not None:
            name_index[index] = name_ids.setdefault(name, len(name_ids))
            if name_index[index] == len(names):
                names.append(name)

        geometry = attrs.get("geometry")
        if geometry is not None:
            part = _coords_e6(geometry.coords)
            geometry_parts.append(part)
            geometry_offsets[index + 1] = geometry_offsets[index] + len(part)
        else:
            geometry_offsets[index + 1] = geometry_offsets[index]

    max_name_len = max((len(name) for name in names), default=1)
    arrays["name_values"] = np.asarray(names, dtype=f"<U{max_name_len}")
    arrays["edge_name_index"] = name_index
    arrays["geometry_offsets"] = geometry_offsets
    arrays["geometry_xy_e6"] = (
        np.concatenate(geometry_parts).astype(np.int32, copy=False)
        if geometry_parts
        else np.empty((0, 2), dtype=np.int32)
    )
    return arrays


def save_graph_npz(graph: nx.MultiDiGraph, path: str) -> None:
    """API配布用の圧縮NPZを書き出す。"""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    np.savez_compressed(path, **graph_arrays(graph))


def load_graph_npz(path: str) -> nx.MultiDiGraph:
    """NPZから既存探索コードが扱える MultiDiGraph を復元する。"""
    with np.load(path, allow_pickle=False) as data:
        version = int(data["schema_version"][0])
        if version != SCHEMA_VERSION:
            raise ValueError(
                f"未対応のグラフNPZ schema_version={version}（期待={SCHEMA_VERSION}）"
            )

        graph = nx.MultiDiGraph(crs="epsg:4326", simplified=True)
        for node, (x, y) in zip(data["node_id"], data["node_xy_e6"], strict=True):
            graph.add_node(
                int(node), x=float(x) / COORD_SCALE, y=float(y) / COORD_SCALE
            )

        names = data["name_values"]
        name_index = data["edge_name_index"]
        offsets = data["geometry_offsets"]
        geometry_xy = data["geometry_xy_e6"]
        impassable = data["edge_impassable"]
        quake_rank_total = data["edge_quake_rank_total"]
        float_arrays = {field: data[f"edge_{field}"] for field in FLOAT_FIELDS}

        for index, (u, v, key) in enumerate(
            zip(data["edge_u"], data["edge_v"], data["edge_key"], strict=True)
        ):
            attrs = {
                field: float(values[index]) for field, values in float_arrays.items()
            }
            attrs["impassable"] = bool(impassable[index])
            rank = int(quake_rank_total[index])
            attrs["quake_rank_total"] = None if rank < 0 else rank
            ni = int(name_index[index])
            if ni >= 0:
                attrs["name"] = str(names[ni])
            start, end = int(offsets[index]), int(offsets[index + 1])
            if end > start:
                attrs["geometry"] = LineString(
                    geometry_xy[start:end].astype(np.float64) / COORD_SCALE
                )
            graph.add_edge(int(u), int(v), int(key), **attrs)

    return graph
