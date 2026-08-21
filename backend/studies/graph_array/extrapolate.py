"""段階2の実測値から、規模別の常駐量とロード時間を**外挿**する。

⚠️ **ここに出るのは外挿であって実測ではない。** 実測は
`measure_csr`（現行82,586エッジ）と段階5（複製）でしか取っていない。
エッジ数の推定そのものもサンプル実測からの外挿（2026-08-21の計測）。
"""

from __future__ import annotations

# --- 実測（現行 82,586エッジ / 27,144ノード, envelope）---
EDGE_BYTES = 50  # int32×10 + float64×1 + int8×2
NODE_BYTES = 32  # int64×2(node_id/node_offset) + float64×2(x/y)
SIDE_BYTES_PER_EDGE = 21.96  # ジオメトリ + 道路名（遅延ロード）
CSR_US_PER_EDGE = 0.43  # CSR構築（NPZ解凍を含む）
NX_US_PER_EDGE = 15.4  # NetworkX復元（既測）
CONTAINER_FACTOR = 1.8  # 本番Container / このローカル機（既測の比）

# --- 規模（2026-08-21のサンプル実測からの外挿）---
SCALES = {
    "現行コリドー（実測）": (27_144, 82_586),
    "23区": (540_000, 1_550_000),
    "23区+多摩": (1_070_000, 3_130_000),
}


def rows():
    for label, (n, e) in SCALES.items():
        core = EDGE_BYTES * e + NODE_BYTES * n
        side = SIDE_BYTES_PER_EDGE * e
        yield {
            "label": label,
            "nodes": n,
            "edges": e,
            "core_b": core,
            "side_b": side,
            "csr_s": e * CSR_US_PER_EDGE / 1e6,
            "csr_s_container": e * CSR_US_PER_EDGE / 1e6 * CONTAINER_FACTOR,
            "nx_s": e * NX_US_PER_EDGE / 1e6,
            "nx_s_container": e * NX_US_PER_EDGE / 1e6 * CONTAINER_FACTOR,
            "nx_b": 1267 * e,
        }


def main() -> None:
    print("規模別（3シナリオ = 3本を常駐させた場合も併記）\n")
    head = f"{'':22s} {'core':>9s} {'+側':>9s} {'×3本':>9s} {'NetworkX':>10s}"
    print(head)
    for r in rows():
        both = r["core_b"] + r["side_b"]
        print(
            f"{r['label']:22s} {r['core_b'] / 1e6:8.1f}MB {both / 1e6:8.1f}MB "
            f"{both * 3 / 1e9:8.2f}GB {r['nx_b'] * 3 / 1e9:9.2f}GB"
        )
    print()
    head2 = f"{'':22s} {'CSR':>9s} {'本番':>8s}"
    print(head2 + f" {'NetworkX':>10s} {'本番':>8s}")
    for r in rows():
        print(
            f"{r['label']:22s} {r['csr_s']:9.2f}s {r['csr_s_container']:9.2f}s "
            f"{r['nx_s']:9.1f}s {r['nx_s_container']:9.1f}s"
        )


if __name__ == "__main__":
    main()
