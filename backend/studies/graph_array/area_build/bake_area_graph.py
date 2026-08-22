"""新スコープ（23区+多摩の市街化区域）のグラフへハザードを焼く。

    python -m studies.graph_array.area_build.bake_area_graph --scenario envelope

⚠️ **どのCSVを焼くかはここで決めない。** 入力は
`prep/hazard_sources/flood/scenarios.py` の `SCENARIOS[シナリオ]["csv"]` が単一の
出所で、採否の理由もそちらに記録してある（envelopeは2026-08-21に4→10ファイル）。
覆えていない範囲のエッジは浸水が「未評価」になる。これは隠さず `coverage` に出し、
#23の3段階表示が扱う。metaの `flood_note` も実際に焼いたCSVから組み立てる。

⚠️ 焼き込みのロジックは `prep/route_search/graph.py` の関数をそのまま呼ぶ。
コスト式・サンプル間隔・代表値の取り方は現行と同じ。
"""

from __future__ import annotations

import json
import os
import pickle
import time

import numpy as np

BUILD_DIR = "../data/processed/graph_build"
GRAPH_PKL = f"{BUILD_DIR}/area_walk_graph.pkl"


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def rss_gb() -> float:
    with open("/proc/self/status") as f:
        for line in f:
            if line.startswith("VmRSS"):
                return int(line.split()[1]) / 1024 / 1024
    return -1.0


def _flood_note(csvs: list[str], flood_cov: dict) -> str:
    """metaに入れる浸水の但し書き。**実際に焼いたCSVと実測coverageから作る。**

    「現行4流域のみ」のように本数と流域名を書き固めると、シナリオの入力が
    変わったときに成果物のmetaだけが古い説明を配り続ける（2026-08-21に
    envelopeが4→10ファイルになった後、実際にそうなっていた）。
    """
    names = "、".join(os.path.basename(c) for c in csvs)
    covered = flood_cov["edge_ratio_covered"] * 100
    return (
        f"浸水はこのシナリオの入力CSV {len(csvs)}件（{names}）が覆う範囲だけを"
        f"評価している。エッジ本数の{covered:.1f}%が一部でも評価済みで、"
        "残りは浸水想定図の整備範囲外として coverage=0 を持つ。"
        "**浸水しないという意味ではない。**"
    )


def main() -> None:
    import argparse

    ap = argparse.ArgumentParser(description="新スコープのグラフへハザードを焼く")
    ap.add_argument("--scenario", default="envelope")
    ap.add_argument("--sample-m", type=float, default=10.0)
    args = ap.parse_args()

    from prep.hazard_sources.flood.grid import load_grid
    from prep.hazard_sources.flood.scenarios import (
        FLOOD_SOURCE_ID,
        FLOOD_SOURCE_LABEL,
        SCENARIOS,
    )
    from prep.hazard_sources.quake.cost import (
        QUAKE_GPKG,
        QUAKE_SOURCE_ID,
        QUAKE_SOURCE_LABEL,
    )
    from prep.paths import rel
    from prep.route_search.graph import bake_hazard, bake_quake, edge_length_stats

    out_pkl = f"{BUILD_DIR}/area_{args.scenario}.pkl"
    out_meta = f"{BUILD_DIR}/area_{args.scenario}_meta.json"
    if os.path.exists(out_pkl):
        log(f"既にある -> {out_pkl}")
        return

    log(f"グラフを読む: {GRAPH_PKL}")
    with open(GRAPH_PKL, "rb") as f:
        G = pickle.load(f)
    log(f"  nodes={G.number_of_nodes():,} edges={G.number_of_edges():,}")
    log(f"  RSS={rss_gb():.1f}GB")

    csvs = list(SCENARIOS[args.scenario]["csv"])
    log(f"浸水格子を読む: {[os.path.basename(c) for c in csvs]}")
    t0 = time.time()
    grid, gmeta = load_grid(csvs, None)
    log(f"  grid {grid.shape} max={grid.max():.2f}m ({time.time() - t0:.0f}s)")
    log(f"  RSS={rss_gb():.1f}GB")

    log("浸水を焼く（10m間隔サンプル）")
    t0 = time.time()
    keys, lengths, dmax, cost, n_impassable, samples = bake_hazard(
        G, grid, gmeta, args.sample_m
    )
    log(f"  done ({time.time() - t0:.0f}s) RSS={rss_gb():.1f}GB")

    log("地震を焼く（町丁目ポリゴンとの空間結合）")
    t0 = time.time()
    quake = bake_quake(G, keys, *samples)
    log(f"  done ({time.time() - t0:.0f}s) RSS={rss_gb():.1f}GB")

    # ---- coverage の実測 ----
    flood_cov = np.array([G.edges[k]["coverage"] for k in keys], dtype=np.float64)
    quake_cov = np.array([G.edges[k]["quake_coverage"] for k in keys], dtype=np.float64)
    total_len = float(lengths.sum())
    cov_stats = {
        "flood": {
            "edges_fully_covered": int((flood_cov >= 1.0).sum()),
            "edges_partially_covered": int(((flood_cov > 0) & (flood_cov < 1.0)).sum()),
            "edges_out_of_coverage": int((flood_cov == 0).sum()),
            "edge_ratio_covered": round(float((flood_cov > 0).mean()), 4),
            "length_weighted_coverage": round(
                float((flood_cov * lengths).sum() / total_len), 4
            ),
        },
        "quake": {
            "edges_fully_covered": int((quake_cov >= 1.0).sum()),
            "edges_partially_covered": int(((quake_cov > 0) & (quake_cov < 1.0)).sum()),
            "edges_out_of_coverage": int((quake_cov == 0).sum()),
            "edge_ratio_covered": round(float((quake_cov > 0).mean()), 4),
            "length_weighted_coverage": round(
                float((quake_cov * lengths).sum() / total_len), 4
            ),
        },
    }
    log(f"  浸水 coverage: {cov_stats['flood']}")
    log(f"  地震 coverage: {cov_stats['quake']}")

    xs = [G.nodes[n]["x"] for n in G.nodes]
    ys = [G.nodes[n]["y"] for n in G.nodes]
    meta = {
        "csv": [rel(c) for c in csvs],
        "scenario": args.scenario,
        "source_profile": f"flood-{FLOOD_SOURCE_ID}_quake-{QUAKE_SOURCE_ID}",
        "sources": {
            "flood": {
                "id": FLOOD_SOURCE_ID,
                "label": FLOOD_SOURCE_LABEL,
                "files": [rel(c) for c in csvs],
            },
            "quake": {
                "id": QUAKE_SOURCE_ID,
                "label": QUAKE_SOURCE_LABEL,
                "file": rel(QUAKE_GPKG),
            },
        },
        "scope": {"id": "tokyo-23ku-tama-shigaika", "margin_km": 0.0},
        "bbox_left_bottom_right_top": [min(xs), min(ys), max(xs), max(ys)],
        "network_type": "walk",
        "sample_interval_m": args.sample_m,
        "nodes": G.number_of_nodes(),
        "edges": G.number_of_edges(),
        "sample_points": int(samples[2].sum()),
        "total_length_km": round(total_len / 1000, 1),
        "impassable_edges": n_impassable,
        "edge_depth_pct_length_weighted": edge_length_stats(lengths, dmax),
        "coverage_stats": cov_stats,
        "quake": quake,
        # ⚠️ 流域名や本数を書き固めないこと。シナリオの入力CSVは変わる
        #    （2026-08-21に4→10ファイルへ増えた）ので、実際に焼いたCSVと
        #    実測coverageから組み立てる。この文言は成果物のmetaへそのまま入る。
        "flood_note": _flood_note(csvs, cov_stats["flood"]),
    }
    with open(out_meta, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    log(f"saved {out_meta}")

    log(f"pickle を書く -> {out_pkl}")
    with open(out_pkl, "wb") as f:
        pickle.dump(G, f, protocol=pickle.HIGHEST_PROTOCOL)
    log(f"  {os.path.getsize(out_pkl):,}B  RSS={rss_gb():.1f}GB")
    log("完了")


if __name__ == "__main__":
    main()
