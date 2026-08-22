"""任意の2点の経路探索（POST /api/evac-routes/search）。

プリセット（`bundle_store`）が事前計算したJSONを返すだけなのに対し、こちらは
**その場でグラフを引く**。返す形は**プリセットと同じ**にしてある
（`routes[]` / `geojson` / `minimax_floor_m` …）。フロントの表示コードを1本化するため。

## 対象エリア

経路探索は**事前に焼いたグラフの中でしか動かない。** 対象範囲はNPZに付いている
`*_meta.json` の bbox で決まり、外の地点は `OutOfArea` で弾く。

## グラフの持ち方

⚠️ **NPZは配列（CSR）のまま持ち、NetworkXへ展開しない。**
MultiDiGraph は実測 1,267 B/edge で、東京都規模（190万エッジ級）では
Containerの6GiBに載らない。CSRなら 62 B/edge。
探索は `prep.route_search.csr_search`、統計・ジオメトリの取り出しは
`prep.route_search.csr_view.CsrGraphView` が経路上のエッジだけ辞書に起こす。

## 重い依存を持ち込まない

`prep.route_search.graph` は osmnx を import しているので**触らない**。
探索に要るものは `prep.route_search.snap` / `csr_*` に分離してある。
API に増える依存は numpy / shapely だけ。

## 掛け合わせ

`weights.edge_cost(hazards)` と同じ式（`length × Π cost_h`）を
`csr_search.edge_costs` が配列で計算する。**リクエストのたびに掛ける**ので、
組み合わせごとの重み配列は持たない。
"""

from __future__ import annotations

import os
import threading

from app.core.config import get_settings, runtime_scope
from app.services.evac_routes import rationale as rationale_svc
from prep.hazard_sources import registry
from prep.hazard_sources.quake.cost import QUAKE_COST
from prep.paths import rel
from prep.route_search import bundles as B
from prep.route_search import csr_search as CS
from prep.route_search.csr_graph import load_csr
from prep.route_search.csr_view import CsrGraphView
from prep.route_search.search import (
    DEPTH_THRESHOLD,
    WALK_SPEED_DISASTER,
    WALK_SPEED_NORMAL,
    resolve_path_edges,
    route_stats,
    stitch,
)
from prep.route_search.snap import graph_bbox, load_meta
from prep.route_search.weights import baked_weight, edge_cost


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

_graphs: dict[tuple[str, str], CsrGraphView] = {}
_lock = threading.Lock()


def _graph_file(scenario: str) -> str:
    """選択中の範囲・profileで、このシナリオが読むNPZ。

    ⚠️ ファイル名は `scopes.Scope` が決める。**前処理側の pickle 命名
    （`bundles.GRAPHS`）から導かない。** 導いていた頃は、新しい範囲の成果物が
    旧スコープ時代の名前を名乗り続ける原因になっていた。
    """
    if scenario not in B.SCENARIO_META:
        raise BadRequest(
            f"未知の浸水シナリオ: {scenario!r} / 既知={sorted(B.SCENARIO_META)}"
        )
    scope = runtime_scope()
    p = os.path.join(get_settings().active_graph_dir, scope.npz_name(scenario))
    if not os.path.exists(p):
        raise NotGenerated(f"{rel(p)} が無い。先にこれを実行する:\n    {scope.builder}")
    return p


def _graph(scenario: str) -> CsrGraphView:
    """圧縮NPZを**CSR配列のまま**読み、プロセス内に持つ。

    ⚠️ NetworkX の MultiDiGraph へは展開しない。実測で 1,267 B/edge かかり、
    東京都規模（190万エッジ級）ではContainerのメモリに載らないため。
    配列のままなら 62 B/edge で、ロードも 0.35us/edge（NetworkX復元は 15.4us/edge）。

    ジオメトリと道路名は探索が触らないので、`CsrGraphView` が応答を組み立てる
    ときに初めて読む。

    シナリオは3つしかないので単純な辞書で足りる。エリアを設定値化して増やすときは
    ここに上限を入れること（05 §13 段11）。
    """
    p = _graph_file(scenario)
    profile = get_settings().hazard_data_profile
    with _lock:
        key = (profile, scenario)
        G = _graphs.get(key)
        if G is None:
            G = CsrGraphView(load_csr(p))
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
        f"いま用意してあるのは{runtime_scope().label}だけです。"
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
            f"いま経路を引けるのは{runtime_scope().label}だけです。",
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
        if hid == "flood" and variant not in B.SCENARIO_META:
            raise BadRequest(
                f"未知の浸水シナリオ: {variant!r} / 既知={sorted(B.SCENARIO_META)}"
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
    path = CS.shortest_path(G.csr, o, d, hazards)
    # 平行エッジの復元は**探索に使ったのと同じ重み**で。
    # 種別なしは length、掛け合わせなら1本ぶんの関数を渡す
    edges, ambiguous = resolve_path_edges(
        G, path, "length" if not hazards else edge_cost(hazards)
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
    o = CS.nearest_node(G.csr, o_lat, o_lon)
    d = CS.nearest_node(G.csr, d_lat, d_lon)
    snap_o = CS.snap_m(G.csr, o, o_lat, o_lon)
    snap_d = CS.snap_m(G.csr, d, d_lat, d_lon)
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
        floor, mm_path, mm_mask = CS.min_achievable_max_depth(G.csr, o, d)
        mm_edges = None
        if mm_path is not None:
            # ⚠️ 復元は閾値で絞った見え方で、統計とジオメトリは絞らない側で取る
            mm_edges, _mm_amb = resolve_path_edges(
                G.filtered(mm_mask), mm_path, "length"
            )
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
