"""新スコープの焼き上がりpickleを、配布用の圧縮NPZ（CSRが読む形）へ書き出す。

    python -m prep.route_search.area_graph.export_npz --scenario envelope

⚠️ 変換は既存の `prep.route_search.npz_graph.save_graph_npz` をそのまま使う。
"""

from __future__ import annotations

import os
import pickle
import shutil
import time

from prep.paths import build_dir
from prep.route_search import scopes

# 書き出す対象のスコープ。中間物の置き場はここから取る（生パスを書かない）。
SCOPE = scopes.get("tokyo-23ku-tama-shigaika")
BUILD_DIR = build_dir(SCOPE.id)


def main() -> None:
    import argparse

    ap = argparse.ArgumentParser(description="新スコープのNPZ書き出し")
    ap.add_argument("--scenario", default="envelope")
    args = ap.parse_args()

    from prep.route_search.npz_graph import save_graph_npz

    src = f"{BUILD_DIR}/area_{args.scenario}.pkl"
    out = f"{BUILD_DIR}/area_{args.scenario}.npz"
    print(f"読む: {src} ({os.path.getsize(src):,}B)", flush=True)
    t0 = time.time()
    with open(src, "rb") as f:
        G = pickle.load(f)
    print(
        f"  nodes={G.number_of_nodes():,} edges={G.number_of_edges():,}"
        f" ({time.time() - t0:.0f}s)",
        flush=True,
    )

    t0 = time.time()
    save_graph_npz(G, out)
    print(
        f"saved: {out} ({os.path.getsize(out):,}B) ({time.time() - t0:.0f}s)",
        flush=True,
    )
    meta_src = f"{BUILD_DIR}/area_{args.scenario}_meta.json"
    meta_dst = f"{BUILD_DIR}/area_{args.scenario}_meta.json"
    if meta_src != meta_dst:
        shutil.copyfile(meta_src, meta_dst)


if __name__ == "__main__":
    main()
