"""焼き上がったグラフを「使う」ために要るものだけ。**osmnx を import しない。**

`graph.py` はグラフを**作る**側なので osmnx / geopandas / scipy を要求する。
探索する側（`search.py` / API）が必要とするのは、実際には

  * 地点 → 最寄りノード（`nearest_node` / `snap_m`）
  * 既定の起終点とグラフの置き場
  * 焼いたときの bbox（＝**対象エリア**。ここから外は探索できない）

の3つだけで、どれも numpy と標準ライブラリで足りる。
これを `graph.py` に置いたままにすると、API が osmnx を丸ごと抱え込む
ため、このモジュールを実行時依存だけで読める境界にする。

`graph.py` はここから import して再エクスポートするので、
**既存の `from prep.route_search.graph import nearest_node` はそのまま動く。**
"""

from __future__ import annotations

import json
import math
import os

import numpy as np

from prep.paths import graph_path
from prep.route_search import scopes

# ⚠️ 範囲の値をここに書かない。**単一の出所は `prep.route_search.scopes`。**
#    ここに残っているのは、旧スコープ（矩形bbox）を作る graph.py が
#    `from prep.route_search.graph import MARGIN_KM` のように参照しているため
#    （graph.py がここから再エクスポートしている）の互換名である。
_LEGACY_SCOPE = scopes.get("kitasenju-ueno")
_LEGACY_AREA = _LEGACY_SCOPE.area

ORIGIN_DEFAULT, DEST_DEFAULT = _LEGACY_AREA.points  # 北千住駅 / 上野駅
MARGIN_KM = _LEGACY_AREA.margin_km  # 起終点bboxの片側マージン（SPEC 5 タスクA-1）

OUT_DEFAULT = graph_path(_LEGACY_SCOPE.pickle_name("sumidagawa"))


def bbox_from_points(pts, margin_km: float):
    """(lat, lon) の列 + マージン -> (left, bottom, right, top) = (lon0, lat0, lon1, lat1)

    OSMnx 2.x の graph_from_bbox は経度緯度順のタプルを取る。
    """
    lats = [p[0] for p in pts]
    lons = [p[1] for p in pts]
    dlat = margin_km * 1000.0 / 111_320.0
    lat_mid = math.radians(sum(lats) / len(lats))
    dlon = margin_km * 1000.0 / (111_320.0 * math.cos(lat_mid))
    return (min(lons) - dlon, min(lats) - dlat, max(lons) + dlon, max(lats) + dlat)


def nearest_node(G, lat: float, lon: float):
    """(lat, lon) に最も近いノードIDを返す。

    ox.distance.nearest_nodes は未投影グラフだと scikit-learn を要求するが、
    ノード数2.7万程度なら総当たりで十分速い（数ms）。依存を増やさないため自前で持つ。
    数km四方なので正距円筒近似で誤差は無視できる。
    """
    ids = np.fromiter(G.nodes, dtype=np.int64, count=G.number_of_nodes())
    xs = np.fromiter((G.nodes[n]["x"] for n in ids), dtype=np.float64, count=len(ids))
    ys = np.fromiter((G.nodes[n]["y"] for n in ids), dtype=np.float64, count=len(ids))
    kx = math.cos(math.radians(lat))
    d2 = ((xs - lon) * kx) ** 2 + (ys - lat) ** 2
    return int(ids[int(np.argmin(d2))])


def snap_m(G, node, lat: float, lon: float) -> float:
    """要求座標と、実際にスナップしたノードの距離(m)。

    グラフの bbox の中でも、川の上や線路の中は道が無い。bbox 判定だけでは
    「エリア内なのに数百m離れた道に飛ぶ」ことがあるので、呼び出し側が
    この値を見て弾けるようにしておく。
    """
    dx = (G.nodes[node]["x"] - lon) * 111_320.0 * math.cos(math.radians(lat))
    dy = (G.nodes[node]["y"] - lat) * 111_320.0
    return math.hypot(dx, dy)


def meta_path(graph_file: str) -> str:
    """グラフに対応する `*_meta.json`（build 時の bbox などが入っている）"""
    return os.path.splitext(graph_file)[0] + "_meta.json"


def load_meta(graph_file: str) -> dict:
    with open(meta_path(graph_file), encoding="utf-8") as f:
        return json.load(f)


def graph_bbox(graph_file: str):
    """焼いたときの bbox = **対象エリア**。(left, bottom, right, top)

    経路探索は事前に焼いたグラフの中でしか動かない。ここから外の地点は
    「対象エリアの外」として弾く。
    """
    return tuple(load_meta(graph_file)["bbox_left_bottom_right_top"])


def in_bbox(bbox, lat: float, lon: float) -> bool:
    left, bottom, right, top = bbox
    return left <= lon <= right and bottom <= lat <= top
