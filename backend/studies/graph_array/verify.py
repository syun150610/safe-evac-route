"""固定した期待値と、いま動く実装の出力を突き合わせる。

    python -m studies.graph_array.verify --impl nx
    python -m studies.graph_array.verify --impl nx --selftest
    python -m studies.graph_array.verify --impl array

⚠️ 判定は「全ケース0箇所の差」だけ。1箇所でも残ったら不一致として終了コード1で返す。
"""

from __future__ import annotations

import gzip
import json
import os
import sys
import time

from studies.graph_array import cases as C
from studies.graph_array import compare, od_set

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "expected")


def load_expected(set_name: str) -> dict:
    path = os.path.join(OUT_DIR, f"nx_{set_name}.json.gz")
    with gzip.open(path, "rt", encoding="utf-8") as f:
        return json.load(f)


def _paths(sc: str, o: int, d: int, hazards_tuples, with_minimax: bool) -> dict:
    """経路のノード列・エッジ列。応答には入らないので本番の内部関数で取り直す。

    ⚠️ 本番 `_one_route` と同じ手順（同じ重み・同じ復元）で辿る。
    """
    from app.services.evac_routes import search as S
    from prep.route_search import csr_search as CS
    from prep.route_search.search import resolve_path_edges
    from prep.route_search.weights import edge_cost

    G = S._graph(sc)
    out = {}
    for hs in hazards_tuples:
        path = CS.shortest_path(G.csr, o, d, hs)
        edges, ambiguous = resolve_path_edges(
            G, path, "length" if not hs else edge_cost(hs)
        )
        out[S.COMBO_ID[hs]] = {
            "nodes": [int(n) for n in path],
            "edges": [[int(u), int(v), int(k)] for u, v, k in edges],
            "ambiguous_parallel_edges": ambiguous,
        }
    if with_minimax:
        _thr, mm_path, mask = CS.min_achievable_max_depth(G.csr, o, d)
        if mm_path is not None:
            mm_edges, _ = resolve_path_edges(G.filtered(mask), mm_path, "length")
            out["minimax"] = {
                "nodes": [int(n) for n in mm_path],
                "edges": [[int(u), int(v), int(k)] for u, v, k in mm_edges],
                "ambiguous_parallel_edges": 0,
            }
    return out


def run_prod(set_name: str, od_list: list[dict]) -> dict:
    """いまの本番実装（CSR配列版）で全ケースを回す。"""
    from app.services.evac_routes import search as S

    result = {}
    t0 = time.perf_counter()
    for cid, od, sc, hz, include, scenario_arg in C.iter_cases(od_list, set_name):
        res = S.search(
            od["origin"], od["dest"], hazards=hz, include=include, scenario=scenario_arg
        )
        o = int(res["od"]["origin"]["node"])
        d = int(res["od"]["dest"]["node"])
        hs = S._normalize(hz)
        wanted = [()] + ([hs] if hs != () else [])
        result[cid] = {
            "response": res,
            "paths": _paths(sc, o, d, wanted, "minimax" in include),
        }
    print(f"  {set_name}: {len(result)}ケース / {time.perf_counter() - t0:.1f}s")
    return result


RUNNERS = {"prod": run_prod}


def _perturb(cases: dict) -> dict:
    """負のコントロール。**照合器が本当に差を拾うか**を確かめるための細工。

    最初のケースの distance_m を 1e-6 ずらすだけ。1e-9 の許容差なら必ず落ちる。
    """
    key = sorted(cases)[0]
    cases[key]["response"]["routes"][0]["stats"]["distance_m"] += 1e-6
    print(f"  [selftest] {key} の distance_m を +1e-6 した")
    return cases


def main() -> None:
    import argparse

    ap = argparse.ArgumentParser(description="期待値との完全一致を確認する")
    ap.add_argument("--impl", choices=sorted(RUNNERS), required=True)
    ap.add_argument("--set", choices=sorted(C.SETS), action="append")
    ap.add_argument(
        "--selftest", action="store_true", help="わざと差を入れて照合器を試す"
    )
    args = ap.parse_args()

    od_list = od_set.load()
    sets = args.set or sorted(C.SETS)
    total_bad = 0
    for set_name in sets:
        exp = load_expected(set_name)
        t0 = time.perf_counter()
        actual = RUNNERS[args.impl](set_name, od_list)
        if args.selftest:
            actual = _perturb(actual)
        bad, lines = compare.report(exp["cases"], actual)
        total_bad += bad
        mark = "一致" if bad == 0 else f"不一致 {bad}/{len(exp['cases'])}ケース"
        print(f"[{set_name}] {mark}  ({time.perf_counter() - t0:.1f}s)")
        for line in lines:
            print(line)
    print()
    if total_bad:
        print(f"NG: {total_bad}ケースが不一致")
        sys.exit(1)
    print(f"OK: {len(sets)}セット全ケースが完全一致（許容差 {compare.TOL}）")


if __name__ == "__main__":
    main()
