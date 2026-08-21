"""探索1回あたりの時間と、探索中のRSSを実測する。

    python -m studies.graph_array.bench_search --impl array
    python -m studies.graph_array.bench_search --impl nx

⚠️ グラフのロードは計測から外す（段階2で別に測っている）。
⚠️ RSSはプロセス全体の値。配列以外（Python・numpy・応答のdict）も含む。
"""

from __future__ import annotations

import gc
import time

from studies.graph_array import od_set

SCENARIO = "envelope"
HAZARDS = {"flood": SCENARIO, "quake": "total"}


def _stat(name: str) -> int:
    with open("/proc/self/status") as f:
        for line in f:
            if line.startswith(name):
                return int(line.split()[1]) * 1024
    raise RuntimeError(f"{name} が読めない")


def rss() -> int:
    return _stat("VmRSS")


def peak_rss() -> int:
    return _stat("VmHWM")


def main() -> None:
    import argparse

    ap = argparse.ArgumentParser(description="探索の実行時間とRSS")
    ap.add_argument("--impl", choices=("array", "nx"), required=True)
    ap.add_argument("--repeat", type=int, default=3)
    args = ap.parse_args()

    od_list = od_set.load()
    gc.collect()
    base = rss()

    if args.impl == "array":
        from studies.graph_array import service_array as SA

        SA.graph(SCENARIO)  # ロードは計測外
        SA.graph(SCENARIO)[1].edge_attrs(0)  # 遅延ロード分もここで読む

        def one(od):
            SA.search(od["origin"], od["dest"], hazards=HAZARDS)
    else:
        from app.services.evac_routes import search as S

        S._graph(SCENARIO)

        def one(od):
            S.search(od["origin"], od["dest"], hazards=HAZARDS)

    after_load = rss()
    print(f"[{args.impl}] ロード後RSS {after_load / 1e6:.1f}MB")
    print(f"  起動時 {base / 1e6:.1f}MB")

    times = []
    max_rss = after_load
    for _ in range(args.repeat):
        for od in od_list:
            t0 = time.perf_counter()
            one(od)
            times.append(time.perf_counter() - t0)
            max_rss = max(max_rss, rss())

    times.sort()
    n = len(times)
    print(f"  探索 {n}回: 中央値 {times[n // 2] * 1000:.0f}ms")
    print(
        f"    最小 {times[0] * 1000:.0f}ms / 最大 {times[-1] * 1000:.0f}ms"
        f" / 合計 {sum(times):.1f}s"
    )
    d = (max_rss - after_load) / 1e6
    print(f"  探索中の最大RSS {max_rss / 1e6:.1f}MB（差 {d:.1f}MB）")
    print(f"  プロセスのピークRSS(VmHWM) {peak_rss() / 1e6:.1f}MB")


if __name__ == "__main__":
    main()
