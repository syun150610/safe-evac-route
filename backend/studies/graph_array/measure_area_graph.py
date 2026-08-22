"""新スコープNPZの実測と、未評価区間の出方の確認。

    python -m studies.graph_array.measure_area_graph

出すもの
  * CSRロード時間・配列サイズ・RSS（起動直後 / 定常）
  * 浸水と地震の coverage（エッジ本数ベースと長さ加重）
  * 代表ODでの探索時間と、rationale の `unevaluated_note`

⚠️ 本番の設定（scope ディレクトリ）は変更していないので、ここでは
`app.services.evac_routes.search` を通さず、同じ関数を直接呼ぶ。
"""

from __future__ import annotations

import gc
import time

import numpy as np

from app.services.evac_routes import rationale as rationale_svc
from app.services.evac_routes.search import COMBO_ID, _route_meta
from prep.paths import build_path
from prep.route_search import bundles as B
from prep.route_search import csr_search as CS
from prep.route_search import scopes
from prep.route_search.csr_graph import load_csr
from prep.route_search.csr_view import CsrGraphView
from prep.route_search.search import resolve_path_edges, route_stats, stitch
from prep.route_search.weights import baked_weight, edge_cost

SCOPE = scopes.get("tokyo-23ku-tama-shigaika")
NPZ = build_path(SCOPE.id, "area_envelope.npz")
HAZARDS = {"flood": "envelope", "quake": "total"}

OD = [
    ("北千住→上野（浸水想定図の中）", (35.7497, 139.8050), (35.7141, 139.7774)),
    ("立川→国分寺（多摩・想定図の外）", (35.6980, 139.4130), (35.7003, 139.4805)),
    ("三軒茶屋→渋谷（23区西部）", (35.6437, 139.6689), (35.6580, 139.7016)),
    ("八王子駅周辺（多摩西部）", (35.6558, 139.3389), (35.6700, 139.3200)),
]


def rss() -> float:
    with open("/proc/self/status") as f:
        for line in f:
            if line.startswith("VmRSS"):
                return int(line.split()[1]) / 1024 / 1024
    return -1.0


def one_route(view, o, d, hazards):
    path = CS.shortest_path(view.csr, o, d, hazards)
    edges, amb = resolve_path_edges(
        view, path, "length" if not hazards else edge_cost(hazards)
    )
    st = route_stats(view, edges)
    no, label, role, desc = _route_meta(COMBO_ID[hazards])
    return {
        "id": COMBO_ID[hazards],
        "no": no,
        "label": label,
        "role": role,
        "desc": desc,
        "weight": baked_weight(hazards) or "length",
        "stats": st,
        "ambiguous_parallel_edges": amb,
        "hazards": list(hazards),
    }, edges


def main() -> None:
    gc.collect()
    base = rss()
    t0 = time.perf_counter()
    g = load_csr(NPZ)
    t_core = time.perf_counter() - t0
    rss_core = rss()
    view = CsrGraphView(g)
    t0 = time.perf_counter()
    view.edge_attrs(0)
    t_side = time.perf_counter() - t0
    rss_side = rss()

    core = sum(g.core_nbytes().values())
    side = sum(g.side_nbytes().values())
    print(f"NPZ {NPZ}")
    print(f"  nodes={g.n_nodes:,} edges={g.n_edges:,}")
    print(f"  CSR構築 {t_core:.2f}s / 側 {t_side:.2f}s")
    print(
        f"  配列 core {core / 1e6:.1f}MB ({core / g.n_edges:.2f} B/edge)"
        f" / 側 {side / 1e6:.1f}MB"
    )
    print(
        f"  RSS 起動前 {base:.2f}GB → 起動直後 {rss_core:.2f}GB → 定常 {rss_side:.2f}GB"
    )

    length = g.edge_float["length"].astype(np.float64)
    total = length.sum()
    for name, key in (("浸水", "coverage"), ("地震", "quake_coverage")):
        cov = g.edge_float[key].astype(np.float64)
        print(
            f"  {name} coverage: 一部でも評価済みのエッジ "
            f"{int((cov > 0).sum()):,}/{g.n_edges:,} = {100 * (cov > 0).mean():.1f}%"
            f" / 完全評価 {100 * (cov >= 1.0).mean():.1f}%"
            f" / 長さ加重 {100 * (cov * length).sum() / total:.1f}%"
        )

    print()
    for label, (olat, olon), (dlat, dlon) in OD:
        o = CS.nearest_node(g, olat, olon)
        d = CS.nearest_node(g, dlat, dlon)
        if o == d:
            print(f"[{label}] 起終点が同じノードになった。飛ばす")
            continue
        t0 = time.perf_counter()
        base_route, _ = one_route(view, o, d, ())
        sel_route, sel_edges = one_route(view, o, d, ("flood", "quake"))
        took = time.perf_counter() - t0
        stitch(view, sel_edges)
        B.segment_features(view, sel_edges, "combined")
        r = rationale_svc.build(
            [base_route, sel_route],
            "combined",
            HAZARDS,
            B.SCENARIO_META["envelope"]["display"],
        )
        print(
            f"[{label}] 2本ぶん {took * 1000:.0f}ms"
            f" / 距離 {sel_route['stats']['distance_m']:.0f}m"
            f" / スナップ {CS.snap_m(g, o, olat, olon):.0f}m"
        )
        for h in r["hazards"]:
            print(
                f"   {h['label']}: verdict={h['verdict']}"
                f" 未評価 {100 * h['unevaluated_ratio']:.1f}%"
                f" stage={h['unevaluated_stage']}"
            )
            print(f"     text: {h['text']}")
            print(f"     note: {h['unevaluated_note']}")
        print()


if __name__ == "__main__":
    main()
