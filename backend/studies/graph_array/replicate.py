"""規模の実測用に、現行グラフをK個複製してつなげたNPZを作る。

⚠️ **これは合成データ。** 本物の東京都のグラフではない。測れるのは
「エッジ数・ノード数がN倍になったときのロード・メモリ・探索の伸び方」だけで、
実際の道路網の形（次数分布・分岐の仕方）は現行コリドーのK倍複製に過ぎない。

⚠️ **連結にする。** 単純に並べただけだと連結成分がK個になり、
Dijkstra が1個ぶんしか歩かないので探索時間の測定にならない。
コピー i の代表ノードと i+1 の代表ノードを双方向のエッジでつなぐ。

⚠️ ファイルサイズは複製ゆえ圧縮が効きすぎるので、容量の議論には使わない。
"""

from __future__ import annotations

import os

import numpy as np

# コピーを経度方向へずらす量（重ならないように現行bbox幅より大きく取る）
LON_SHIFT_E6 = 100_000  # 0.1度
NODE_ID_STRIDE = 10**11
# つなぎのエッジ。ハザードは無害な値にする（合成データであることを明示するため）
LINK_LENGTH_M = 50.0


def replicate(src: str, k: int, out: str) -> dict:
    with np.load(src, allow_pickle=False) as d:
        a = {key: d[key] for key in d.files}

    n = a["node_id"].shape[0]
    v_count = a["geometry_xy_e6"].shape[0]

    node_id = np.concatenate([a["node_id"] + NODE_ID_STRIDE * i for i in range(k)])
    node_xy = np.tile(a["node_xy_e6"], (k, 1))
    node_xy[:, 0] += np.repeat(np.arange(k, dtype=np.int32) * LON_SHIFT_E6, n)

    edge_u = np.concatenate([a["edge_u"] + NODE_ID_STRIDE * i for i in range(k)])
    edge_v = np.concatenate([a["edge_v"] + NODE_ID_STRIDE * i for i in range(k)])

    out_arrays: dict[str, np.ndarray] = {
        "schema_version": a["schema_version"],
        "node_id": node_id,
        "node_xy_e6": node_xy,
        "name_values": a["name_values"],
    }
    for key in a:
        if key.startswith("edge_") and key not in ("edge_u", "edge_v"):
            out_arrays[key] = np.tile(a[key], k)
    out_arrays["edge_u"] = edge_u
    out_arrays["edge_v"] = edge_v

    geom = np.tile(a["geometry_xy_e6"], (k, 1))
    geom[:, 0] += np.repeat(np.arange(k, dtype=np.int32) * LON_SHIFT_E6, v_count)
    offs = a["geometry_offsets"]
    geometry_offsets = np.concatenate(
        [offs[:-1] + int(offs[-1]) * i for i in range(k)] + [[int(offs[-1]) * k]]
    ).astype(np.int64)

    # --- コピー同士をつなぐ（双方向） ---
    links_u, links_v = [], []
    for i in range(k - 1):
        links_u += [int(a["node_id"][0]) + NODE_ID_STRIDE * i]
        links_v += [int(a["node_id"][0]) + NODE_ID_STRIDE * (i + 1)]
    n_link = len(links_u) * 2
    if n_link:
        lu = np.array(links_u + links_v, dtype=np.int64)
        lv = np.array(links_v + links_u, dtype=np.int64)
        out_arrays["edge_u"] = np.concatenate([out_arrays["edge_u"], lu])
        out_arrays["edge_v"] = np.concatenate([out_arrays["edge_v"], lv])
        defaults = {
            "edge_key": 0,
            "edge_length": LINK_LENGTH_M,
            "edge_depth_max": 0.0,
            "edge_depth_mean": 0.0,
            "edge_cost_flood": 1.0,
            "edge_cost_quake": 1.0,
            "edge_coverage": 1.0,
            "edge_quake_coverage": 1.0,
            "edge_impassable": False,
            "edge_quake_rank_total": 1,
            "edge_name_index": -1,
        }
        for key, value in defaults.items():
            arr = out_arrays[key]
            out_arrays[key] = np.concatenate(
                [arr, np.full(n_link, value, dtype=arr.dtype)]
            )
        geometry_offsets = np.concatenate(
            [geometry_offsets, np.full(n_link, geometry_offsets[-1], dtype=np.int64)]
        )

    out_arrays["geometry_xy_e6"] = geom
    out_arrays["geometry_offsets"] = geometry_offsets

    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    np.savez_compressed(out, **out_arrays)
    return {
        "k": k,
        "nodes": int(node_id.shape[0]),
        "edges": int(out_arrays["edge_u"].shape[0]),
        "links": n_link,
        "bytes": os.path.getsize(out),
        "first_node": int(a["node_id"][0]),
        "node_id_stride": NODE_ID_STRIDE,
    }


def main() -> None:
    import argparse
    import json

    from app.services.evac_routes.search import _graph_file

    ap = argparse.ArgumentParser(description="現行グラフのK倍複製NPZを作る")
    ap.add_argument("--k", type=int, required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--scenario", default="envelope")
    args = ap.parse_args()
    info = replicate(_graph_file(args.scenario), args.k, args.out)
    print(json.dumps(info, ensure_ascii=False))


if __name__ == "__main__":
    main()
