"""照合に使う **固定20組のOD**。

⚠️ **一度作ったら動かさない。** 配列版とNetworkX版の一致を見るための土俵なので、
座標が変わると期待値の意味が変わる。生成は `--regenerate` を明示したときだけ。

内訳:
  * 12組 … `prep.route_search.od.OD_PAIRS`（プリセットと同じ駅間）
  * 8組  … bboxの中から乱数で選び、道路へ300m以内にスナップしたものを固定した任意地点
"""

from __future__ import annotations

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OD_SET_PATH = os.path.join(HERE, "expected", "od_set.json")

# 任意地点を選ぶときの乱数種。固定値を残すのは、同じ集合を作り直せるようにするため
SEED = 20260821
N_RANDOM = 8


def load() -> list[dict]:
    with open(OD_SET_PATH, encoding="utf-8") as f:
        return json.load(f)["od"]


def generate() -> list[dict]:
    """OD集合を作る。**期待値を固定する前に1回だけ実行する。**"""
    import numpy as np

    from app.services.evac_routes import search as S
    from prep.route_search.od import OD_PAIRS, P
    from prep.route_search.snap import graph_bbox, nearest_node, snap_m

    out: list[dict] = []
    for i, (o, d, note) in enumerate(OD_PAIRS, start=1):
        out.append(
            {
                "id": f"preset{i:02d}",
                "kind": "preset",
                "origin": {"lat": P[o][0], "lon": P[o][1], "label": o},
                "dest": {"lat": P[d][0], "lon": P[d][1], "label": d},
                "note": note,
            }
        )

    # 任意地点。プリセットの駅前だけだと、スナップ・平行エッジの分岐を踏まない
    G = S._graph(S.DEFAULT_SCENARIO)
    left, bottom, right, top = graph_bbox(S._graph_file(S.DEFAULT_SCENARIO))
    rng = np.random.default_rng(SEED)
    picked: list[tuple[float, float]] = []
    while len(picked) < N_RANDOM * 2:
        lat = float(rng.uniform(bottom, top))
        lon = float(rng.uniform(left, right))
        n = nearest_node(G, lat, lon)
        if snap_m(G, n, lat, lon) <= S.MAX_SNAP_M:
            picked.append((round(lat, 6), round(lon, 6)))
    for i in range(N_RANDOM):
        (olat, olon), (dlat, dlon) = picked[i * 2], picked[i * 2 + 1]
        out.append(
            {
                "id": f"random{i + 1:02d}",
                "kind": "random",
                "origin": {"lat": olat, "lon": olon, "label": f"任意地点{i + 1}a"},
                "dest": {"lat": dlat, "lon": dlon, "label": f"任意地点{i + 1}b"},
                "note": f"bbox内の乱数点（seed={SEED}）",
            }
        )
    return out


def main() -> None:
    import argparse

    ap = argparse.ArgumentParser(description="照合用OD集合の生成（既定は表示のみ）")
    ap.add_argument(
        "--regenerate", action="store_true", help="expected/od_set.json を書き直す"
    )
    args = ap.parse_args()

    if not args.regenerate:
        od = load()
        print(f"{OD_SET_PATH}: {len(od)}組")
        for r in od:
            print(f"  {r['id']:10s} {r['origin']['label']:10s} -> {r['dest']['label']}")
        return

    if os.path.exists(OD_SET_PATH):
        raise SystemExit(
            f"{OD_SET_PATH} が既にある。固定した集合は動かさない方針なので、"
            "作り直すなら手で消してから実行すること。"
        )
    od = generate()
    os.makedirs(os.path.dirname(OD_SET_PATH), exist_ok=True)
    with open(OD_SET_PATH, "w", encoding="utf-8") as f:
        json.dump({"seed": SEED, "od": od}, f, ensure_ascii=False, indent=1)
    print(f"saved: {OD_SET_PATH} ({len(od)}組)")


if __name__ == "__main__":
    main()
