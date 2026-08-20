#!/usr/bin/env python3
"""共通浸水格子をXYZ形式のPNGタイルへ描画する。

格子の生成・被覆判定は prep/hazard_sources/flood/grid.py が持つ。

使い方（backend/ で実行する）:
    python3 -m prep.tile_render.render --all
    python3 -m prep.tile_render.render kandagawa
    python3 -m prep.tile_render.render          # 引数なしでシナリオ一覧
"""

import argparse
import json
import math
import os
import sys

import numpy as np
from PIL import Image

# 引きのズームでは、1px内の最大浸水深と最小被覆を取るために使う。
from scipy.ndimage import maximum_filter, minimum_filter

from prep.hazard_sources.flood.grid import COVERAGE_EXTENT, load_grid
from prep.hazard_sources.flood.scenarios import SCENARIOS
from prep.paths import tiles_path

# ---------------- 設定 ----------------
OUT_ROOT = tiles_path("flood")
# ⚠️ **データに無い解像度を焼かない。** 浸水深の格子は約 9.3m×11.3m
# （flood/grid.py の dlat/dlon）。緯度35.7 でのタイル1pxは z15=3.9m、z16=1.9m、z17=1.0m。
# つまり z16 以降は**1セルを単色ブロックに引き伸ばすだけで情報が増えない**。
# z17 まで焼くと 37,823枚/50MB、z15 までなら 2,491枚/5.9MB（枚数93%減）。
# 拡大は地図側の overzoom に任せる（元がブロックなので見た目は変わらない）。
#
# ⚠️ ここを変えたら**3箇所を揃えること**。ズレると404か、焼いたタイルが使われない:
#   app/services/hazards/catalog.py  FLOOD_MAXZ
#   frontend/src/map/EvacRouteMap.tsx  FLOOD_ZOOM
# ⚠️ 補間を切るのも忘れない（MapLibre: raster-resampling=nearest /
#    Google: getTile の image-rendering=pixelated）。切らないとブロックがぼやける。
ZOOMS = range(12, 16)
PALETTE = "standard"  # "standard"(国交省浸水深標準色) or "pedestrian"(徒歩基準)
BBOX = None  # (lat_min, lat_max, lon_min, lon_max) or None=全域
TILE = 256
MIN_DEPTH = 0.01  # これ未満は透明（浸水なし扱い）

# 「浸水しない」と「このシナリオが覆っていない」を描き分けるためのハッチ。
# 前者は透明、後者はグレーの斜線。区別しないと、覆っていないだけの場所が「安全」に見える。
HATCH_RGBA = (120, 124, 130, 70)  # 対象外のハッチ色
HATCH_PERIOD = 10  # 斜線の周期(px)
HATCH_WIDTH = 3  # 斜線の太さ(px)

# 国交省 浸水深標準色（洪水・内水）
PAL_STANDARD = [
    (0.50, (247, 245, 169)),
    (3.00, (255, 216, 192)),
    (5.00, (255, 183, 183)),
    (10.00, (255, 145, 145)),
    (20.00, (242, 133, 201)),
    (99.0, (220, 122, 220)),
]
# 徒歩移動者基準（歩行困難ライン付近を細かく刻む）
PAL_PEDESTRIAN = [
    (0.10, (255, 255, 204)),  # ほぼ影響なし
    (0.20, (255, 237, 160)),  # 注意
    (0.30, (254, 196, 79)),  # 歩きにくい
    (0.50, (253, 141, 60)),  # 歩行困難
    (1.00, (227, 26, 28)),  # 移動不能
    (99.0, (128, 0, 38)),  # 危険
]
ALPHA = 165
# --------------------------------------


def build_lut(palette):
    """0..8m を 0.01m 刻みで RGBA に引くルックアップテーブル"""
    steps = np.arange(0, 8.01, 0.01)
    lut = np.zeros((len(steps), 4), dtype=np.uint8)
    for i, d in enumerate(steps):
        if d < MIN_DEPTH:
            continue
        for thr, rgb in palette:
            if d <= thr:
                lut[i] = (*rgb, ALPHA)
                break
        else:
            lut[i] = (*palette[-1][1], ALPHA)
    return lut


def deg2num(lat, lon, z):
    n = 2.0**z
    x = (lon + 180.0) / 360.0 * n
    la = math.radians(lat)
    y = (1.0 - math.asinh(math.tan(la)) / math.pi) / 2.0 * n
    return x, y


def render(grid, meta, out, zooms, lut, extent=None):
    """タイルを描く。

    extent を渡すと、その範囲まで「対象外(NoData)」のハッチングを描く。
    グリッドのbboxの外も対象外なので、extent はグリッドより広く取れる
    （＝そのシナリオが覆っていないことを地図上で示せる）。
    """
    nrow, ncol = grid.shape
    cov = meta.get("coverage")
    made = 0
    for z in zooms:
        n = 2.0**z
        # このズームの1px相当メートル -> グリッドセル何個分か
        px_m = 156543.03 * math.cos(math.radians(meta["lat_max"])) / n
        win = max(1, int(round(px_m / 9.2)))
        g = maximum_filter(grid, size=win) if win > 1 else grid
        # 対象外の判定は縮小しても消えないよう、こちらは最小値フィルタ（＝収縮）で見る
        cv = minimum_filter(cov, size=win) if (cov is not None and win > 1) else cov

        ext = extent or (
            meta["lat_min"],
            meta["lat_max"],
            meta["lon_min"],
            meta["lon_max"],
        )
        x0, y1 = deg2num(ext[0], ext[2], z)
        x1, y0 = deg2num(ext[1], ext[3], z)
        tx0, tx1 = int(x0), int(x1)
        ty0, ty1 = int(y0), int(y1)

        for tx in range(tx0, tx1 + 1):
            for ty in range(ty0, ty1 + 1):
                # タイル内256x256画素の中心緯度経度
                px = (tx + (np.arange(TILE) + 0.5) / TILE) / n * 360.0 - 180.0
                yy = (ty + (np.arange(TILE) + 0.5) / TILE) / n
                lat_r = np.arctan(np.sinh(np.pi * (1 - 2 * yy)))
                py = np.degrees(lat_r)

                r = np.round((meta["lat_max"] - py) / meta["dlat"]).astype(np.int32)
                c = np.round((px - meta["lon_min"]) / meta["dlon"]).astype(np.int32)
                ok_r = (r >= 0) & (r < nrow)
                ok_c = (c >= 0) & (c < ncol)
                inside = np.outer(ok_r, ok_c)
                np.clip(r, 0, nrow - 1, out=r)
                np.clip(c, 0, ncol - 1, out=c)

                vals = np.where(inside, g[np.ix_(r, c)], 0.0)

                # 対象外 = グリッド外 or coverage が False
                covered = inside & cv[np.ix_(r, c)] if cv is not None else inside
                nocov = ~covered

                if vals.max() < MIN_DEPTH and not nocov.any():
                    continue  # 浸水も対象外も無い → タイル不要

                idx = np.clip((vals * 100).astype(np.int32), 0, len(lut) - 1)
                rgba = lut[idx].copy()
                # 対象外はハッチングで塗る（透明＝浸水なし とは別の見た目にする）
                if nocov.any():
                    gi = ty * TILE + np.arange(TILE)[:, None]
                    gj = tx * TILE + np.arange(TILE)[None, :]
                    stripe = ((gi + gj) % HATCH_PERIOD) < HATCH_WIDTH
                    rgba[nocov & stripe] = HATCH_RGBA
                    rgba[nocov & ~stripe] = (0, 0, 0, 0)

                img = Image.fromarray(rgba, "RGBA")
                d = os.path.join(out, str(z), str(tx))
                os.makedirs(d, exist_ok=True)
                img.save(os.path.join(d, f"{ty}.png"), optimize=True)
                made += 1
        print(f"  z={z}: win={win} tiles so far={made}")
    return made


def build_scenario(sid, out_root=OUT_ROOT):
    sc = SCENARIOS[sid]
    out = os.path.join(out_root, sid)
    print(f"\n=== シナリオ '{sid}' : {sc['label']} ===")
    print("loading...")
    grid, meta = load_grid(sc["csv"], BBOX)
    print(
        f"  grid {grid.shape}  max={grid.max():.2f}m  "
        f"wet={(grid >= MIN_DEPTH).mean() * 100:.1f}%"
    )
    lut = build_lut(PAL_STANDARD if PALETTE == "standard" else PAL_PEDESTRIAN)
    # ハッチ範囲は「既定の対象範囲」と「このシナリオのデータ範囲」の和集合。
    # データが広いシナリオ（包絡）でも、対象外の描き漏らしが出ないようにする。
    extent = (
        min(COVERAGE_EXTENT[0], meta["lat_min"]),
        max(COVERAGE_EXTENT[1], meta["lat_max"]),
        min(COVERAGE_EXTENT[2], meta["lon_min"]),
        max(COVERAGE_EXTENT[3], meta["lon_max"]),
    )
    print(
        f"  hatch extent: lat {extent[0]:.4f}-{extent[1]:.4f} / lon {extent[2]:.4f}-{extent[3]:.4f}"
    )
    print("rendering...")
    n = render(grid, meta, out, ZOOMS, lut, extent=extent)
    meta_out = dict(
        id=sid,
        label=sc["label"],
        kind=("envelope" if sid == "envelope" else "single_basin"),
        note=(
            "複数河川の最大値による包絡。予測ではなく上限の保証"
            if sid == "envelope"
            else "単一流域の浸水想定"
        ),
        source=f"東京都 浸水予想区域図（{sc['label']}）",
        source_dataset_url=sc.get("source_dataset_url"),
        precision_note=sc.get("precision_note"),
        csv=[os.path.basename(p) for p in sc["csv"]],
        # 「この数値がどのデータの合成か」を後から追えるようにする（SPEC_C C-1）
        sources=meta.get("sources"),
        palette=PALETTE,
        zooms=[min(ZOOMS), max(ZOOMS)],
        bounds=[meta["lon_min"], meta["lat_min"], meta["lon_max"], meta["lat_max"]],
        coverage_extent=[round(v, 5) for v in extent],
        coverage_pct_of_grid=round(float(meta["coverage"].mean() * 100), 1),
        tiles=n,
    )
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta_out, f, ensure_ascii=False, indent=2)
    print(f"done: {n} tiles -> {out}")
    return n


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="浸水深CSV -> XYZタイル（シナリオ単位）")
    ap.add_argument(
        "scenario", nargs="?", choices=sorted(SCENARIOS), help="生成するシナリオID"
    )
    ap.add_argument("--all", action="store_true", help="全シナリオを生成")
    ap.add_argument(
        "--out-root",
        default=OUT_ROOT,
        help="出力ルート（既定: data/processed/tiles/flood）",
    )
    args = ap.parse_args()

    if args.all:
        targets = sorted(SCENARIOS)
    elif args.scenario:
        targets = [args.scenario]
    else:
        print("シナリオを指定してください。\n")
        print(f"{'ID':14}{'名称':28}CSV")
        for k, v in sorted(SCENARIOS.items()):
            print(
                f"{k:14}{v['label']:28}{', '.join(os.path.basename(p) for p in v['csv'])}"
            )
        print(f"\n  例: python3 {os.path.basename(__file__)} kandagawa")
        sys.exit(1)

    for sid in targets:
        build_scenario(sid, out_root=args.out_root)
