"""配列版の探索でAPIと同じ応答を組み立てる（段階3）。

本番 `app.services.evac_routes.search.search()` と**同じ手順・同じ関数**を使い、
置き換えたのは次の3つだけ。

  1. グラフの持ち方: `MultiDiGraph` → `CsrGraph`
  2. 最短経路: `nx.shortest_path` → `search_array.dijkstra`
  3. 最寄りノード・スナップ距離: `snap.*` → `search_array.*`

統計・ジオメトリ・道路名・rationale・シナリオメタは**本番の関数をそのまま呼ぶ**
（`csr_view.CsrGraphView` が経路上のエッジだけ辞書として見せる）。

⚠️ minimax は段階4。ここで include に入れたら明示的に落とす。
"""

from __future__ import annotations

from app.core.config import get_settings
from app.services.evac_routes import rationale as rationale_svc
from app.services.evac_routes import search as S
from prep.hazard_sources.quake.cost import QUAKE_COST
from prep.route_search import bundles as B
from prep.route_search.search import (
    DEPTH_THRESHOLD,
    WALK_SPEED_DISASTER,
    WALK_SPEED_NORMAL,
    resolve_path_edges,
    route_stats,
    stitch,
)
from prep.route_search.snap import graph_bbox
from prep.route_search.weights import baked_weight, edge_cost
from studies.graph_array import search_array as A
from studies.graph_array.csr import CsrGraph, load_csr
from studies.graph_array.csr_view import CsrGraphView

_graphs: dict[tuple[str, str], tuple[CsrGraph, CsrGraphView]] = {}


def graph(scenario: str) -> tuple[CsrGraph, CsrGraphView]:
    """本番と同じくプロセス内へ持つ。CSRと参照用の窓口を組で返す。"""
    key = (get_settings().hazard_data_profile, scenario)
    got = _graphs.get(key)
    if got is None:
        csr = load_csr(S._graph_file(scenario))
        got = (csr, CsrGraphView(csr))
        _graphs[key] = got
    return got


def _one_route(csr, view, o, d, hazards, with_segments):
    route_id = S.COMBO_ID[hazards]
    path = A.shortest_path(csr, o, d, hazards)
    one = "length" if not hazards else edge_cost(hazards)
    edges, ambiguous = resolve_path_edges(view, path, one)
    st = route_stats(view, edges)
    no, label, role, desc = S._route_meta(route_id)
    weight_name = baked_weight(hazards) or "length"
    feats = [
        B.feature(
            stitch(view, edges),
            {
                "kind": "route",
                "route": route_id,
                "no": no,
                "label": label,
                "role": role,
                "desc": desc,
                "weight": weight_name,
                "ambiguous_parallel_edges": ambiguous,
                **st,
            },
        )
    ]
    if with_segments:
        feats += B.segment_features(view, edges, route_id)
    info = {
        "id": route_id,
        "no": no,
        "label": label,
        "role": role,
        "desc": desc,
        "weight": weight_name,
        "stats": st,
        "ambiguous_parallel_edges": ambiguous,
        "hazards": list(hazards),
    }
    return feats, info, path, edges


def search(
    origin, dest, hazards=None, include=None, scenario=None, with_segments=True
) -> dict:
    o_lat, o_lon, o_label = S._point(origin, "出発地")
    d_lat, d_lon, d_label = S._point(dest, "目的地")

    hs = S._normalize(hazards)
    sc = (hazards or {}).get("flood") or scenario or S.DEFAULT_SCENARIO
    S._check_area(graph_bbox(S._graph_file(sc)), (o_lat, o_lon), (d_lat, d_lon))

    csr, view = graph(sc)
    o = A.nearest_node(csr, o_lat, o_lon)
    d = A.nearest_node(csr, d_lat, d_lon)
    snap_o = A.snap_m(csr, o, o_lat, o_lon)
    snap_d = A.snap_m(csr, d, d_lat, d_lon)
    for name, s in (("出発地", snap_o), ("目的地", snap_d)):
        if s > S.MAX_SNAP_M:
            raise S.BadRequest(
                f"{name}の近くに歩ける道が見つかりません"
                f"（最寄りの道まで {s:.0f}m）。道路の上を指してください。"
            )
    if o == d:
        raise S.BadRequest(
            "出発地と目的地が同じ地点になります。離れた2点を指定してください。"
        )

    inc = list(include or S.DEFAULT_INCLUDE)
    unknown = [x for x in inc if x not in ("baseline", "selected", "minimax")]
    if unknown:
        raise S.BadRequest(f"include に未知の値: {unknown}")
    wanted = []
    if "baseline" in inc:
        wanted.append(())
    if "selected" in inc and hs not in wanted:
        wanted.append(hs)

    feats, routes, paths = [], [], {}
    for h in wanted:
        f, info, path, edges = _one_route(csr, view, o, d, h, with_segments)
        feats += f
        routes.append(info)
        paths[S.COMBO_ID[h]] = {
            "nodes": [int(n) for n in path],
            "edges": [[int(u), int(v), int(k)] for u, v, k in edges],
            "ambiguous_parallel_edges": info["ambiguous_parallel_edges"],
        }

    floor = None
    if "minimax" in inc:
        floor, mm_path, mask = A.min_achievable_max_depth(csr, o, d)
        if mm_path is not None:
            # ⚠️ 復元は**閾値で絞った見え方**で行い、統計とジオメトリは絞らない側で取る
            #    （本番 min_achievable_max_depth / search() と同じ）
            mm_edges, _ = resolve_path_edges(view.filtered(mask), mm_path, "length")
            rid, no, _w, label, role, desc = B.MINIMAX
            st = route_stats(view, mm_edges)
            feats.append(
                B.feature(
                    stitch(view, mm_edges),
                    {
                        "kind": "route",
                        "route": rid,
                        "no": no,
                        "label": label,
                        "role": role,
                        "desc": desc,
                        "weight": "minimax",
                        **st,
                    },
                )
            )
            if with_segments:
                feats += B.segment_features(view, mm_edges, rid)
            routes.append(
                {
                    "id": rid,
                    "no": no,
                    "label": label,
                    "role": role,
                    "desc": desc,
                    "weight": "minimax",
                    "stats": st,
                    "ambiguous_parallel_edges": 0,
                    "hazards": [],
                }
            )
            paths[rid] = {
                "nodes": [int(n) for n in mm_path],
                "edges": [[int(u), int(v), int(k)] for u, v, k in mm_edges],
                "ambiguous_parallel_edges": 0,
            }

    meta = B.SCENARIO_META[sc]
    settings = get_settings()
    rationale = rationale_svc.build(
        routes, S.COMBO_ID[hs], hazards or {}, meta["display"]
    )
    response = {
        "data_profile": settings.hazard_data_profile,
        "scenario": sc,
        "scenario_display": meta["display"],
        "scenario_kind": meta["kind"],
        "scenario_note": meta["note"],
        "graph": S._graph_ref(S._graph_file(sc)),
        "tiles": f"{settings.tile_base_url}/flood/"
        f"{settings.hazard_data_profile}/{sc}/{{z}}/{{x}}/{{y}}.png",
        "od": {
            "origin": {
                "name": o_label,
                "display": o_label,
                "latlon": [o_lat, o_lon],
                "node": int(o),
                "snap_m": round(snap_o, 1),
            },
            "dest": {
                "name": d_label,
                "display": d_label,
                "latlon": [d_lat, d_lon],
                "node": int(d),
                "snap_m": round(snap_d, 1),
            },
            "note": "地図で指定した2地点",
            "role": None,
        },
        "minimax_floor_m": round(floor, 2) if floor is not None else None,
        "depth_threshold_m": DEPTH_THRESHOLD,
        "walk_speed_m_per_min": {
            "normal": WALK_SPEED_NORMAL,
            "disaster": WALK_SPEED_DISASTER,
        },
        "quake_cost": {str(k): v for k, v in QUAKE_COST.items()},
        "hazards": dict(hazards or {}),
        "selected_route": S.COMBO_ID[hs],
        "rationale": rationale,
        "routes": routes,
        "geojson": {"type": "FeatureCollection", "features": feats},
    }
    return response, paths
