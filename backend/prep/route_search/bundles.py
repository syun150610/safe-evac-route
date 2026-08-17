#!/usr/bin/env python3
"""
D-1 / D-2: デモUI用の経路バンドルを出力する（docs/dev/04_デモUI.md）

主OD は **北千住駅 → 上野駅**、対比OD は **牛田→浅草**（SPEC_D D-1）。
ただし **ODはハードコードしない。** od_study.py の12組すべてを出力し、
UI側でプルダウンから選べるようにする。

出力する経路（SPEC_D D-2 の表）:

  ① baseline  length           単純最短（既存の地図アプリ相当）      グレー破線
  ② flood     weight_hazard    浸水のみ（λ=0）… 比較対象            青
  ④ combined  weight_combined  浸水×地震（λ=1）… **推奨経路・既定ON** 緑
  ⑤ quake     weight_quake     地震のみ … 比較用・推奨経路ではない    赤・既定OFF
  —  minimax  （二分探索）      最大浸水深を最小化した経路の下限       紫破線・既定OFF

④を推奨にする根拠は docs/findings/検証記録.md 10-2:
「地震を足す距離コストは、②比で中央値 −0.3%」＝ほぼ同じ距離で地震リスクが下がる。
②を既定にする理由はもう無い。

③(Google) は発表で表示しない方針（docs/dev/引き継ぎ.md 4章 課題7）。ここでも出さない。

出力:

  data/processed/bundles/index.json               UIが読む目次。OD一覧・シナリオ一覧
  data/processed/bundles/{scenario}/{slug}.json   1組ぶんのバンドル

  バンドルの Feature:
    kind="route"    経路全体の LineString。properties に指標一式
    kind="segment"  エッジ単位。区間クリックの詳細用

既存の `search.py` の出力（data/processed/route*.geojson）には**一切触らない**。
あちらは検証用で、こちらは表示用。同じグラフから別の形で出す。

使い方:
    python3 demo_routes.py                      # 全シナリオ × 全OD（約3分）
    python3 demo_routes.py --scenario envelope  # 包絡のみ
    python3 demo_routes.py --od 北千住 上野      # 1組だけ
"""
from __future__ import annotations

import argparse
import json
import math
import os
import pickle
import sys
import time

import networkx as nx

# ⚠️ **graph.py から取らない**（osmnx が付いてくる）。API 側の catalog.py が
#    このモジュールの SCENARIO_META を読むので、ここが重いと API まで重くなる
from prep.hazard_sources.quake.cost import QUAKE_COST
from prep.route_search.snap import nearest_node, snap_m
from prep.paths import bundles_path, graph_path, rel
from prep.route_search.od import P, OD_PAIRS
from prep.route_search.search import (resolve_path_edges, route_stats, stitch, edge_coords,
                   min_achievable_max_depth, _name_of, WALK_SPEED_NORMAL,
                   WALK_SPEED_DISASTER, DEPTH_THRESHOLD)

OUTDIR = bundles_path()

# シナリオID -> グラフ。build_graph.py --scenario の出力規則に合わせてある
GRAPHS = {
    "envelope":   graph_path("kitasenju_ueno_envelope.pkl"),
    "sumidagawa": graph_path("kitasenju_ueno.pkl"),          # 既定シナリオは接尾辞なし
    "kandagawa":  graph_path("kitasenju_ueno_kandagawa.pkl"),
}

# 表示名と説明は SPEC_D D-3 の表に合わせる。
# ⚠️ 包絡の説明は「どの河川が氾濫しても、この地点の浸水深はこの値を超えない」。
#    「全河川が同時に氾濫した場合」と書くと**誤り**（SPEC_D D-3）。
SCENARIO_META = {
    "envelope": {
        "display": "全河川（想定最大）",
        "kind": "envelope",
        "note": "**どの河川が氾濫しても、この地点の浸水深はこの値を超えません。**"
                "予測ではなく上限の保証です（包絡）。"
                "「全河川が同時に氾濫した場合」という意味ではありません。",
    },
    "sumidagawa": {
        "display": "隅田川及び新河岸川",
        "kind": "single_basin",
        "note": "この流域が氾濫した場合の浸水想定です。"
                "他の河川が氾濫した場合はこの図では分かりません。",
    },
    "kandagawa": {
        "display": "神田川",
        "kind": "single_basin",
        "note": "この流域が氾濫した場合の浸水想定です。"
                "この区間は想定図の範囲外が大半を占めます（＝浸水しないのではなく、判断材料がない）。",
    },
}

# 表示順・番号は docs/findings/検証記録.md 10章の表記に合わせる（①②④⑤）。
# ③ は Google で、発表では表示しない。番号を詰めると資料と食い違うので欠番のままにする。
#   role="recommended" 推奨経路 / "compare" 比較対象 / "counterexample" 反例 / "bound" 下限
ROUTES = [
    ("baseline", "①", "length",          "単純最短", "compare",
     "距離だけで引いた経路。一般的な地図アプリに相当する"),
    ("flood",    "②", "weight_hazard",   "浸水のみ", "compare",
     "浸水深だけを見た経路。④との比較対象"),
    ("combined", "④", "weight_combined", "浸水×地震", "recommended",
     "浸水コストに建物倒壊・火災の地域危険度を掛けた経路。これが推奨経路"),
    ("quake",    "⑤", "weight_quake",    "地震のみ", "counterexample",
     "地震だけを見て浸水を無視した経路。比較用で、推奨経路ではない"),
]

MINIMAX = ("minimax", "—", None, "最大浸水深を最小化", "bound",
           "距離を無視して最大浸水深だけを下げた経路。これ以上は浅くできないという下限")

# SPEC_D D-1 の位置づけ。プルダウンで区別できるようにする
OD_ROLE = {("北千住", "上野"): "main", ("牛田", "浅草"): "contrast"}

COORD_DP = 6   # 座標の丸め。6桁で約0.1m。出力サイズを半分以下にする


def _round(cs):
    return [[round(x, COORD_DP), round(y, COORD_DP)] for x, y in cs]


def feature(coords, props):
    return {"type": "Feature",
            "geometry": {"type": "LineString", "coordinates": _round(coords)},
            "properties": props}


def segment_features(G, edges, route_id):
    """エッジ単位のFeature。浸水と地震を**別プロパティ**で持たせる。

    単位が違うので1つの数値に混ぜない（docs/dev/03_ハザード拡張.md C-3「表示について」）。
    """
    feats = []
    for i, (u, v, k) in enumerate(edges):
        d = G[u][v][k]
        r = d.get("quake_rank_total")
        feats.append(feature(edge_coords(G, u, v, k), {
            "kind": "segment",
            "route": route_id,
            "seq": i,
            "name": _name_of(d),
            "length_m": round(float(d["length"]), 1),
            "depth_max": round(float(d["depth_max"]), 2),
            "depth_mean": round(float(d["depth_mean"]), 2),
            "coverage": round(float(d.get("coverage", 1.0)), 3),
            "quake_rank": (None if r is None else int(r)),
            "impassable": bool(d.get("impassable", False)),
        }))
    return feats


def _display(name):
    """表示名。od_study.P は全て駅なので「駅」を付ける"""
    return f"{name}駅" if name in P else name


def slug(i, a, b):
    """ファイル名。日本語をURLに載せないよう連番にし、名前は index.json に持たせる"""
    return f"od{i:02d}"


def build(G, scenario, graph_file, o_name, d_name, note, with_segments=True):
    o_ll, d_ll = P[o_name], P[d_name]
    o = nearest_node(G, *o_ll)
    d = nearest_node(G, *d_ll)
    if o == d:
        return None

    feats, routes = [], []
    for rid, no, w, label, role, desc in ROUTES:
        path = nx.shortest_path(G, o, d, weight=w)
        edges, ambiguous = resolve_path_edges(G, path, w)
        st = route_stats(G, edges)
        feats.append(feature(stitch(G, edges), {
            "kind": "route", "route": rid, "no": no, "label": label,
            "role": role, "desc": desc, "weight": w,
            "ambiguous_parallel_edges": ambiguous, **st}))
        if with_segments:
            feats += segment_features(G, edges, rid)
        routes.append({"id": rid, "no": no, "label": label, "role": role,
                       "desc": desc, "weight": w, "stats": st,
                       "ambiguous_parallel_edges": ambiguous})

    # minimax。中心的な主張（「0.3mを超えずに到達できる経路は存在しない」）の根拠。
    # 距離を無視して最大浸水深だけを下げても、この値より下がらない
    floor, mm_edges = min_achievable_max_depth(G, o, d)
    if mm_edges is not None:
        rid, no, _, label, role, desc = MINIMAX
        st = route_stats(G, mm_edges)
        feats.append(feature(stitch(G, mm_edges), {
            "kind": "route", "route": rid, "no": no, "label": label,
            "role": role, "desc": desc, "weight": "minimax", **st}))
        if with_segments:
            feats += segment_features(G, mm_edges, rid)
        routes.append({"id": rid, "no": no, "label": label, "role": role,
                       "desc": desc, "weight": "minimax", "stats": st,
                       "ambiguous_parallel_edges": 0})

    meta = SCENARIO_META[scenario]
    return {
        "scenario": scenario,
        "scenario_display": meta["display"],
        "scenario_kind": meta["kind"],
        "scenario_note": meta["note"],
        # リポジトリ直下からの相対で持つ（絶対パスを生成物に焼き込まない）
        "graph": rel(graph_file),
        # ⚠️ **このフィールドはもう誰も読んでいない。**
        #    素のHTML版（viewer_demo*.html）からの相対パスで、そちらは
        #    このリポジトリに持ち込んでいない。フロントは /api/hazards が配る
        #    タイルURLを使う。**バンドルを焼き直すときに消すこと**
        #    （いま消すと既存の生成物とバイト一致しなくなるので、APIを移すPRで）
        "tiles": f"../var/tiles/flood/{scenario}/{{z}}/{{x}}/{{y}}.png",
        "od": {
            "origin": {"name": o_name, "display": _display(o_name), "latlon": list(o_ll),
                       "node": int(o), "snap_m": round(snap_m(G, o, *o_ll), 1)},
            "dest": {"name": d_name, "display": _display(d_name), "latlon": list(d_ll),
                     "node": int(d), "snap_m": round(snap_m(G, d, *d_ll), 1)},
            "note": note,
            "role": OD_ROLE.get((o_name, d_name)),
        },
        "minimax_floor_m": round(floor, 2) if floor is not None else None,
        "depth_threshold_m": DEPTH_THRESHOLD,
        "walk_speed_m_per_min": {"normal": WALK_SPEED_NORMAL, "disaster": WALK_SPEED_DISASTER},
        "quake_cost": {str(k): v for k, v in QUAKE_COST.items()},
        "routes": routes,
        "geojson": {"type": "FeatureCollection", "features": feats},
    }


def main():
    ap = argparse.ArgumentParser(description="D-1/D-2: デモUI用の経路バンドル")
    ap.add_argument("--scenario", default="all", choices=sorted(GRAPHS) + ["all"])
    ap.add_argument("--od", nargs=2, metavar=("ORIGIN", "DEST"),
                    help="1組だけ出す（既定は12組すべて）")
    ap.add_argument("--no-segments", action="store_true",
                    help="区間単位のFeatureを省く（出力を小さくする）")
    ap.add_argument("--outdir", default=OUTDIR)
    args = ap.parse_args()

    pairs = list(OD_PAIRS)
    if args.od:
        a, b = args.od
        if a not in P or b not in P:
            raise SystemExit(f"地点が不明: {a} / {b}  （既知: {'・'.join(P)}）")
        pairs = [(a, b, next((n for x, y, n in OD_PAIRS if (x, y) == (a, b)), ""))]

    scenarios = sorted(GRAPHS) if args.scenario == "all" else [args.scenario]
    os.makedirs(args.outdir, exist_ok=True)

    od_index, total_bytes = [], 0
    for sc in scenarios:
        if not os.path.exists(GRAPHS[sc]):
            print(f"! {GRAPHS[sc]} が無い。build_graph.py --scenario {sc} を先に実行",
                  file=sys.stderr)
            continue
        t0 = time.time()
        print(f"\n=== {sc} : {SCENARIO_META[sc]['display']} ===")
        with open(GRAPHS[sc], "rb") as f:
            G = pickle.load(f)
        print(f"graph: {GRAPHS[sc]}  nodes={G.number_of_nodes():,} edges={G.number_of_edges():,}")
        d = os.path.join(args.outdir, sc)
        os.makedirs(d, exist_ok=True)
        rows = []
        for i, (a, b, note) in enumerate(pairs, 1):
            s = slug(i, a, b)
            bundle = build(G, sc, GRAPHS[sc], a, b, note,
                           with_segments=not args.no_segments)
            if bundle is None:
                print(f"  skip {a}→{b}（起終点が同一ノード）")
                continue
            p = os.path.join(d, f"{s}.json")
            with open(p, "w", encoding="utf-8") as f:
                json.dump(bundle, f, ensure_ascii=False, separators=(",", ":"))
            total_bytes += os.path.getsize(p)
            R = {r["id"]: r["stats"] for r in bundle["routes"]}
            print(f"  {s} {a}→{b:6}"
                  f"  ①{R['baseline']['ratio_over_03'] * 100:5.1f}%"
                  f"  ②{R['flood']['ratio_over_03'] * 100:5.1f}%"
                  f"  ④{R['combined']['ratio_over_03'] * 100:5.1f}%"
                  f"  ⑤{R['quake']['ratio_over_03'] * 100:5.1f}%"
                  f"  範囲外{R['combined']['out_of_coverage_ratio'] * 100:5.1f}%"
                  f"  下限{bundle['minimax_floor_m']:.2f}m")
            rows.append({
                "slug": s, "origin": a, "dest": b,
                "display": f"{_display(a)} → {_display(b)}",
                "note": note, "role": OD_ROLE.get((a, b)),
            })
        od_index = rows or od_index
        print(f"  ({time.time() - t0:.0f}秒)")

    index = {
        "default_scenario": "envelope",
        "default_od": next((r["slug"] for r in od_index if r["role"] == "main"),
                           od_index[0]["slug"] if od_index else None),
        "scenarios": [{"id": s, **SCENARIO_META[s],
                       "tiles": f"../var/tiles/flood/{s}/{{z}}/{{x}}/{{y}}.png"}
                      for s in scenarios],
        "od": od_index,
    }
    ip = os.path.join(args.outdir, "index.json")
    with open(ip, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)
    print(f"\nsaved: {ip}  （OD {len(od_index)}組 × シナリオ {len(scenarios)}種"
          f" / 合計 {total_bytes / 1024 / 1024:.1f} MB）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
