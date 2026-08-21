"""NetworkX版（現行実装）で期待値を作り、ファイルに固定する。

⚠️ **実装を差し替える前に1回だけ実行する。** 配列版で作り直したら照合の意味が無い。
出力には、どのNPZから作ったかのSHA256を必ず入れる。
"""

from __future__ import annotations

import gzip
import hashlib
import json
import os
import time

import networkx as nx

from app.core.config import get_settings
from app.services.evac_routes import search as S
from prep.route_search.search import resolve_path_edges
from prep.route_search.weights import edge_cost, edge_weight
from studies.graph_array import cases as C
from studies.graph_array import od_set

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "expected")


def graph_fingerprint() -> dict:
    """使ったNPZの実体を記録する（期待値が別データで作られていないことの確認用）"""
    out = {}
    for sc in C.SCENARIOS:
        p = S._graph_file(sc)
        with open(p, "rb") as f:
            raw = f.read()
        out[sc] = {
            "path": S._graph_ref(p),
            "bytes": len(raw),
            "sha256": hashlib.sha256(raw).hexdigest(),
        }
    return out


def route_paths(G, o, d, hazards_tuple_list) -> dict:
    """経路の**ノード列とエッジ列**。APIの戻り値には入らないので別に取る。

    ⚠️ `search._one_route` と同じ手順（同じ重み・同じ復元）で辿る。
    """
    out = {}
    for hs in hazards_tuple_list:
        rid = S.COMBO_ID[hs]
        w = edge_weight(G, hs)
        path = nx.shortest_path(G, o, d, weight=w)
        edges, ambiguous = resolve_path_edges(
            G, path, w if isinstance(w, str) else edge_cost(hs)
        )
        out[rid] = {
            "nodes": [int(n) for n in path],
            "edges": [[int(u), int(v), int(k)] for u, v, k in edges],
            "ambiguous_parallel_edges": ambiguous,
        }
    return out


def run_set(set_name: str, od_list: list[dict]) -> dict:
    result = {}
    t0 = time.perf_counter()
    for cid, od, sc, hz, include, scenario_arg in C.iter_cases(od_list, set_name):
        res = S.search(
            od["origin"], od["dest"], hazards=hz, include=include, scenario=scenario_arg
        )
        G = S._graph(sc)
        o = int(res["od"]["origin"]["node"])
        d = int(res["od"]["dest"]["node"])
        wanted = [()]
        hs = S._normalize(hz)
        if hs != ():
            wanted.append(hs)
        result[cid] = {"response": res, "paths": route_paths(G, o, d, wanted)}
    print(f"  {set_name}: {len(result)}ケース / {time.perf_counter() - t0:.1f}s")
    return result


def main() -> None:
    import argparse

    ap = argparse.ArgumentParser(description="NetworkX版で期待値を固定する")
    ap.add_argument("--set", choices=sorted(C.SETS), action="append")
    ap.add_argument("--force", action="store_true", help="既存の期待値を上書きする")
    args = ap.parse_args()

    od_list = od_set.load()
    sets = args.set or sorted(C.SETS)
    fp = graph_fingerprint()
    print(f"profile={get_settings().hazard_data_profile}  OD={len(od_list)}組")
    for sc, info in fp.items():
        print(f"  {sc}: {info['bytes']:,}B sha256={info['sha256'][:16]}…")

    for set_name in sets:
        out = os.path.join(OUT_DIR, f"nx_{set_name}.json.gz")
        if os.path.exists(out) and not args.force:
            raise SystemExit(f"{out} が既にある。上書きするなら --force を明示すること")
        payload = {
            "generated_by": "networkx",
            "hazard_data_profile": get_settings().hazard_data_profile,
            "graph_sha256": fp,
            "od_count": len(od_list),
            "set": set_name,
            "cases": run_set(set_name, od_list),
        }
        with gzip.open(out, "wt", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
        print(f"  saved: {os.path.relpath(out, HERE)} ({os.path.getsize(out):,}B)")


if __name__ == "__main__":
    main()
