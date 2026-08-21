"""**いまの実装（CSR配列版）自身**の出力を、新スコープの回帰用に固定する。

⚠️ **これは自己参照の期待値である。** 比較対象のNetworkX版は新スコープの
グラフ（652,828ノード / 1,905,380エッジ）ではメモリに載らないため、
「正しさ」をここで証明することはできない。

移植の正しさを担保しているのは、現行スコープ（北千住↔上野）で
NetworkX版と突き合わせた240ケース（`expected/nx_*.json.gz`）の方であり、
**そちらは削除しないこと。** このファイルが作る期待値は、
今後の変更が意図せず結果を変えていないかを検知するためだけのものである。
"""

from __future__ import annotations

import gzip
import hashlib
import json
import os
import time

from app.core.config import get_settings
from app.services.evac_routes import search as S
from studies.graph_array import cases as C
from studies.graph_array import od_set
from studies.graph_array.verify import run_prod

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "expected", "csr_newscope_primary.json.gz")
N_OD = 4  # 4組 × 3シナリオ = 12ケース


def main() -> None:
    import argparse

    ap = argparse.ArgumentParser(description="新スコープの回帰用期待値（自己参照）")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    if os.path.exists(OUT) and not args.force:
        raise SystemExit(f"{OUT} が既にある。作り直すなら --force")

    od_list = od_set.load()[:N_OD]
    fp = {}
    for sc in C.SCENARIOS:
        path = S._graph_file(sc)
        with open(path, "rb") as f:
            raw = f.read()
        fp[sc] = {
            "path": S._graph_ref(path),
            "bytes": len(raw),
            "sha256": hashlib.sha256(raw).hexdigest(),
        }
    t0 = time.perf_counter()
    payload = {
        "generated_by": "csr（いまの本番実装。自己参照であることに注意）",
        "scope": "tokyo-23ku-tama-shigaika",
        "hazard_data_profile": get_settings().hazard_data_profile,
        "graph_sha256": fp,
        "set": "primary",
        "cases": run_prod("primary", od_list),
    }
    with gzip.open(OUT, "wt", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
    print(f"saved: {OUT} ({os.path.getsize(OUT):,}B) / {time.perf_counter() - t0:.1f}s")


if __name__ == "__main__":
    main()
