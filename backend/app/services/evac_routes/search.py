"""任意の2点の経路探索（POST /api/evac-routes/search）。

プリセット（`bundle_store`）が事前計算したJSONを返すだけなのに対し、こちらは
**その場でグラフを引く**。返す形は**プリセットと同じ**にしてある
（`routes[]` / `geojson` / `minimax_floor_m` …）。フロントの表示コードを1本化するため。

## 対象エリア

経路探索は**事前に焼いたグラフの中でしか動かない。** いま焼いてあるのは
北千住↔上野の bbox + 1km だけで、外の地点は `OutOfArea` で弾く。
東京都内へ広げる場合は、より大きいグラフの保持方法または地域分割の設計が別途必要になる。

## 重い依存を持ち込まない

`prep.route_search.graph` は osmnx を import しているので**触らない**。
探索に要るものは `prep.route_search.snap` に分離してある。
API に増える依存は networkx / numpy / shapely（NPZからのグラフ復元に要る）だけ。

## 掛け合わせ

`weights.edge_weight(G, hazards)` が `length × Π cost_h` を探索時に計算する。
事前計算した `weight_combined` などと一致することは tests/test_weights.py が担保。
"""

from __future__ import annotations

import os
import threading

import networkx as nx

from app.core.config import get_settings
from app.services.evac_routes import rationale as rationale_svc
from prep.hazard_sources import registry
from prep.hazard_sources.quake.cost import QUAKE_COST
from prep.paths import rel
from prep.route_search import bundles as B
from prep.route_search.npz_graph import load_graph_npz
from prep.route_search.search import (
    DEPTH_THRESHOLD,
    WALK_SPEED_DISASTER,
    WALK_SPEED_NORMAL,
    min_achievable_max_depth,
    resolve_path_edges,
    route_stats,
    stitch,
)
from prep.route_search.snap import graph_bbox, load_meta, nearest_node, snap_m
from prep.route_search.weights import baked_weight, edge_cost, edge_weight


class NotGenerated(Exception):
    """本番配布用のグラフNPZが無い"""


class BadRequest(Exception):
    """入力がおかしい（未知の種別、起終点が同一 …）"""


class OutOfArea(Exception):
    """対象エリアの外。どちらの地点が外なのかを添えて返す"""

    def __init__(self, message, which, bbox):
        super().__init__(message)
        self.which = which  # ["origin"] / ["dest"] / 両方
        self.bbox = list(bbox)


# 選ばれた種別の組 → 経路ID。**プリセットと同じIDを使う**ことで、
# フロントの色・凡例・表示順（constants.ts の STYLE / DRAW_ORDER）をそのまま使える
COMBO_ID = {
    (): "baseline",
    ("flood",): "flood",
    ("quake",): "quake",
    ("flood", "quake"): "combined",
}

# 種別ごとに受け付ける variant。
#   flood … 浸水シナリオID（どのグラフを使うかも、これで決まる）
#   quake … 焼いてあるのは総合ランクだけ。建物/火災を選べるようにするには
#           cost_quake を列ごとに焼き直す必要がある（提出後）
QUAKE_VARIANTS = ("total",)

# 起点/終点から最寄りノードまでの許容距離(m)。
# bbox の中でも川の上・線路の中には道が無い。bbox 判定だけだと
# 「エリア内なのに数百m離れた道に飛ぶ」ので、ここでも弾く
MAX_SNAP_M = 300.0

DEFAULT_SCENARIO = "envelope"
DEFAULT_INCLUDE = ("baseline", "selected")

_graphs: dict[tuple[str, str], nx.MultiDiGraph] = {}
_lock = threading.Lock()


def _graph_file(scenario: str) -> str:
    if scenario not in B.GRAPHS:
        raise BadRequest(f"未知の浸水シナリオ: {scenario!r} / 既知={sorted(B.GRAPHS)}")
    source = B.GRAPHS[scenario]
    filename = os.path.splitext(os.path.basename(source))[0] + ".npz"
    p = os.path.join(get_settings().active_graph_dir, filename)
    if not os.path.exists(p):
        raise NotGenerated(
            f"{rel(p)} が無い。"
            "cd backend && python3 -m prep.route_search.export_npz を実行する"
        )
    return p


def _graph(scenario: str) -> nx.MultiDiGraph:
    """圧縮NPZを読み、MultiDiGraphとしてプロセス内に持つ。

    シナリオは3つしかないので単純な辞書で足りる。エリアを設定値化して増やすときは
    ここに上限を入れること（05 §13 段11）。
    """
    p = _graph_file(scenario)
    profile = get_settings().hazard_data_profile
    with _lock:
        key = (profile, scenario)
        G = _graphs.get(key)
        if G is None:
            G = load_graph_npz(p)
            _graphs[key] = G
        return G


def _graph_ref(path: str) -> str:
    """ローカルとコンテナで変わらない、レスポンス表示用のグラフ名。"""
    relative = os.path.relpath(path, get_settings().graph_dir)
    return f"graph/{relative.replace(os.sep, '/')}"


# ---------------- 対象エリア ----------------


def area(scenario: str = DEFAULT_SCENARIO) -> dict:
    """GET /api/evac-routes/area — 地図に対象範囲を描くための情報。

    pickle は読まない（bbox は `*_meta.json` に入っている）ので、
    起動直後でも即答できる。
    """
    p = _graph_file(scenario)
    meta = load_meta(p)
    left, bottom, right, top = meta["bbox_left_bottom_right_top"]
    return {
        "data_profile": get_settings().hazard_data_profile,
        "scenario": scenario,
        "bbox": [left, bottom, right, top],
        "center": [(bottom + top) / 2, (left + right) / 2],
        "graph": _graph_ref(p),
        "nodes": meta.get("nodes"),
        "edges": meta.get("edges"),
        "max_snap_m": MAX_SNAP_M,
        "note": "経路は事前に焼いた歩行者グラフの上でしか引けません。"
        "いま用意してあるのは北千住↔上野の範囲（+1km）だけです。"
        "この外の地点は指定できません。",
    }


def _check_area(bbox, origin, dest):
    outside = []
    left, bottom, right, top = bbox
    for name, (lat, lon) in (("origin", origin), ("dest", dest)):
        if not (left <= lon <= right and bottom <= lat <= top):
            outside.append(name)
    if outside:
        label = {"origin": "出発地", "dest": "目的地"}
        raise OutOfArea(
            "・".join(label[w] for w in outside) + "が対象エリアの外です。"
            "いま経路を引けるのは北千住↔上野の範囲だけです。",
            outside,
            bbox,
        )


# ---------------- 探索 ----------------


def _normalize(hazards: dict | None) -> tuple[str, ...]:
    """{"flood": "envelope", "quake": "total"} → ("flood", "quake")

    値（variant）の検証もここでやる。順序は `weights.BAKED` と揃えるため sorted。
    """
    hs = dict(hazards or {})
    known = set(registry.ids())
    for hid, variant in hs.items():
        if hid not in known:
            raise BadRequest(f"未知のハザード種別: {hid!r} / 既知={sorted(known)}")
        if hid == "flood" and variant not in B.GRAPHS:
            raise BadRequest(
                f"未知の浸水シナリオ: {variant!r} / 既知={sorted(B.GRAPHS)}"
            )
        if hid == "quake" and variant not in QUAKE_VARIANTS:
            raise BadRequest(
                f"地震は {QUAKE_VARIANTS} しか選べない（{variant!r} が来た）。"
                "建物倒壊・火災で経路を引くには cost_quake を焼き直す必要がある"
            )
    out = tuple(sorted(hs))
    if out not in COMBO_ID:
        raise BadRequest(f"この組み合わせは扱えない: {out} / 既知={sorted(COMBO_ID)}")
    return out


def _route_meta(route_id: str):
    """`bundles.ROUTES` の表示メタ（番号・ラベル・役割・説明）を1件引く"""
    for rid, no, _weight, label, role, desc in B.ROUTES:
        if rid == route_id:
            return no, label, role, desc
    rid, no, _w, label, role, desc = B.MINIMAX
    return no, label, role, desc


def _one_route(G, o, d, hazards, with_segments):
    """1本ぶんの (Feature群, routes[]の1件)"""
    route_id = COMBO_ID[hazards]
    w = edge_weight(G, hazards)
    path = nx.shortest_path(G, o, d, weight=w)
    # 平行エッジの復元は**探索に使ったのと同じ重み**で。
    # 文字列の重み（length）ならそのまま、掛け合わせなら1本ぶんの関数を渡す
    edges, ambiguous = resolve_path_edges(
        G, path, w if isinstance(w, str) else edge_cost(hazards)
    )
    st = route_stats(G, edges)
    no, label, role, desc = _route_meta(route_id)
    weight_name = baked_weight(hazards) or "length"
    feats = [
        B.feature(
            stitch(G, edges),
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
        feats += B.segment_features(G, edges, route_id)
    info = {
        "id": route_id,
        "no": no,
        "label": label,
        "role": role,
        "desc": desc,
        "weight": weight_name,
        "stats": st,
        "ambiguous_parallel_edges": ambiguous,
        # プリセットには無い追加情報。どの種別を掛けた経路かを明示する
        "hazards": list(hazards),
    }
    return feats, info


def search(
    origin, dest, hazards=None, include=None, scenario=None, with_segments=True
) -> dict:
    """任意の2点の経路。戻り値の形は `bundles.build()` と同じ。

    origin / dest は {"lat":…, "lon":…, "label":…} または (lat, lon)。
    """
    o_lat, o_lon, o_label = _point(origin, "出発地")
    d_lat, d_lon, d_label = _point(dest, "目的地")

    hs = _normalize(hazards)
    # 浸水を選んだならそのシナリオのグラフを使う。選んでいなくても
    # 指標（depth_max / ratio_over_03）はグラフの浸水属性から出るので、
    # 「どの想定図で測ったか」は必ず決める必要がある
    sc = (hazards or {}).get("flood") or scenario or DEFAULT_SCENARIO
    _check_area(graph_bbox(_graph_file(sc)), (o_lat, o_lon), (d_lat, d_lon))

    G = _graph(sc)
    o = nearest_node(G, o_lat, o_lon)
    d = nearest_node(G, d_lat, d_lon)
    snap_o = snap_m(G, o, o_lat, o_lon)
    snap_d = snap_m(G, d, d_lat, d_lon)
    for name, s in (("出発地", snap_o), ("目的地", snap_d)):
        if s > MAX_SNAP_M:
            raise BadRequest(
                f"{name}の近くに歩ける道が見つかりません"
                f"（最寄りの道まで {s:.0f}m）。道路の上を指してください。"
            )
    if o == d:
        raise BadRequest(
            "出発地と目的地が同じ地点になります。離れた2点を指定してください。"
        )

    inc = list(include or DEFAULT_INCLUDE)
    unknown = [x for x in inc if x not in ("baseline", "selected", "minimax")]
    if unknown:
        raise BadRequest(
            f"include に未知の値: {unknown} / 既知=baseline/selected/minimax"
        )

    # baseline と selected が同じ（＝種別を1つも選んでいない）ときは1本だけ出す
    wanted = []
    if "baseline" in inc:
        wanted.append(())
    if "selected" in inc and hs not in wanted:
        wanted.append(hs)

    feats, routes = [], []
    for h in wanted:
        f, info = _one_route(G, o, d, h, with_segments)
        feats += f
        routes.append(info)

    floor = None
    if "minimax" in inc:
        floor, mm_edges = min_achievable_max_depth(G, o, d)
        if mm_edges is not None:
            rid, no, _w, label, role, desc = B.MINIMAX
            st = route_stats(G, mm_edges)
            feats.append(
                B.feature(
                    stitch(G, mm_edges),
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
                feats += B.segment_features(G, mm_edges, rid)
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

    meta = B.SCENARIO_META[sc]
    settings = get_settings()
    # 「なぜこの経路なのか」。最短しか引いていないときは None
    # （比較対象が無いのに判定文を出すと誤読になる）。
    # ⚠️ プリセットAPIには付けない。あちらは静的JSONをバイト列のまま返す契約で、
    #    tests/test_api.py がバイト一致を検証している（決定 D-301）
    rationale = rationale_svc.build(
        routes, COMBO_ID[hs], hazards or {}, meta["display"]
    )
    return {
        "data_profile": settings.hazard_data_profile,
        "scenario": sc,
        "scenario_display": meta["display"],
        "scenario_kind": meta["kind"],
        "scenario_note": meta["note"],
        "graph": _graph_ref(_graph_file(sc)),
        # React版は /api/hazards のURLを使うが、任意地点探索のレスポンス側も
        # 同じprofile付きURLに揃え、旧世代とキャッシュが混ざらないようにする。
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
        # include に minimax を入れなかった場合は計算していない＝null。
        # 「下限が無い」ではなく「求めていない」なので、フロントは出し分けること
        "minimax_floor_m": round(floor, 2) if floor is not None else None,
        "depth_threshold_m": DEPTH_THRESHOLD,
        "walk_speed_m_per_min": {
            "normal": WALK_SPEED_NORMAL,
            "disaster": WALK_SPEED_DISASTER,
        },
        "quake_cost": {str(k): v for k, v in QUAKE_COST.items()},
        "hazards": dict(hazards or {}),
        "selected_route": COMBO_ID[hs],
        "rationale": rationale,
        "routes": routes,
        "geojson": {"type": "FeatureCollection", "features": feats},
    }


def _point(p, what):
    if isinstance(p, dict):
        lat, lon = p.get("lat"), p.get("lon")
        label = p.get("label") or None
    else:
        lat, lon = p[0], p[1]
        label = None
    if lat is None or lon is None:
        raise BadRequest(f"{what}の緯度経度がありません")
    lat, lon = float(lat), float(lon)
    return lat, lon, label or f"{lat:.5f}, {lon:.5f}"
