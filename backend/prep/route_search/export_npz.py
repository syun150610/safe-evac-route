#!/usr/bin/env python3
"""前処理用pickleを本番配布用の圧縮NPZへ変換する。"""

from __future__ import annotations

import argparse
import os
import pickle
import shutil

import networkx as nx

from prep.paths import rel, runtime_graph_path
from prep.route_search import bundles
from prep.route_search.npz_graph import load_graph_npz, save_graph_npz
from prep.route_search.od import OD_PAIRS, P
from prep.route_search.search import (
    min_achievable_max_depth,
    resolve_path_edges,
    route_stats,
    stitch,
)
from prep.route_search.snap import meta_path, nearest_node
from prep.route_search.weights import edge_cost, edge_weight

COMBOS = ((), ("flood",), ("quake",), ("flood", "quake"))


def _route_snapshot(graph, origin, dest, hazards):
    weight = edge_weight(graph, hazards)
    path = nx.shortest_path(graph, origin, dest, weight=weight)
    one_edge_weight = weight if isinstance(weight, str) else edge_cost(hazards)
    edges, ambiguous = resolve_path_edges(graph, path, one_edge_weight)
    return (
        path,
        edges,
        ambiguous,
        route_stats(graph, edges),
        bundles._round(stitch(graph, edges)),
        bundles.segment_features(graph, edges, "verify"),
    )


def verify_graph(source, restored) -> None:
    """全デモODで経路・数値・表示座標がpickle版と一致することを検証する。"""
    for origin_name, dest_name, *_rest in OD_PAIRS:
        old_origin = nearest_node(source, *P[origin_name])
        old_dest = nearest_node(source, *P[dest_name])
        new_origin = nearest_node(restored, *P[origin_name])
        new_dest = nearest_node(restored, *P[dest_name])
        if (old_origin, old_dest) != (new_origin, new_dest):
            raise ValueError(
                f"最寄りノード不一致: {origin_name}->{dest_name} "
                f"{(old_origin, old_dest)} != {(new_origin, new_dest)}"
            )
        for hazards in COMBOS:
            old = _route_snapshot(source, old_origin, old_dest, hazards)
            new = _route_snapshot(restored, new_origin, new_dest, hazards)
            if old != new:
                raise ValueError(
                    f"NPZ変換後の経路が不一致: "
                    f"{origin_name}->{dest_name} hazards={hazards}"
                )

        old_floor, old_edges = min_achievable_max_depth(source, old_origin, old_dest)
        new_floor, new_edges = min_achievable_max_depth(restored, new_origin, new_dest)
        if old_floor != new_floor or old_edges != new_edges:
            raise ValueError(f"minimax不一致: {origin_name}->{dest_name}")


def export_one(source: str, output: str) -> None:
    with open(source, "rb") as file:
        graph = pickle.load(file)
    save_graph_npz(graph, output)
    shutil.copyfile(meta_path(source), meta_path(output))
    verify_graph(graph, load_graph_npz(output))
    print(
        f"{rel(source)} ({os.path.getsize(source) / 1_000_000:.2f}MB)"
        f" -> {rel(output)} ({os.path.getsize(output) / 1_000_000:.2f}MB) / 検証OK"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="pickleグラフを圧縮NPZへ変換")
    parser.add_argument(
        "--scenario",
        choices=sorted(bundles.GRAPHS),
        help="省略時は全シナリオを変換",
    )
    parser.add_argument(
        "--source-dir",
        help="前処理pickleの別ディレクトリ（basenameは既定と同じ）",
    )
    parser.add_argument(
        "--outdir",
        help="NPZの別出力ディレクトリ（省略時はbackend/graph）",
    )
    args = parser.parse_args()
    graphs = (
        {
            scenario: os.path.join(args.source_dir, os.path.basename(source))
            for scenario, source in bundles.GRAPHS.items()
        }
        if args.source_dir
        else bundles.GRAPHS
    )
    scenarios = [args.scenario] if args.scenario else sorted(bundles.GRAPHS)
    for scenario in scenarios:
        source = graphs[scenario]
        filename = os.path.splitext(os.path.basename(source))[0] + ".npz"
        output = (
            os.path.join(args.outdir, filename)
            if args.outdir
            else runtime_graph_path(filename)
        )
        export_one(source, output)


if __name__ == "__main__":
    main()
