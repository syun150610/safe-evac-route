"""浸水深の格子 — CSVを読んで格子にし、座標から深さ・被覆を引く。

make_tiles.py から切り出した（2026-08-16 の構成整理）。**中身は変えていない。**

⚠️ `load_grid()` はタイル生成とグラフ構築の**両方**が使う。
ここが変わるとタイルの色とエッジに焼かれた値が食い違う
（docs/dev/引き継ぎ.md 3-2 の格子原点の問題）。触るときは両方を焼き直すこと。
"""
import os, math, json, sys
import numpy as np
import pandas as pd
from scipy.ndimage import maximum_filter, minimum_filter, binary_fill_holes

from prep.hazard_sources.flood.scenarios import SCENARIOS, SUSPECT_DATUM

# ---------------- 想定範囲外(NoData)の扱い ----------------
# 「浸水なし(0m)」と「そのシナリオの想定図が覆っていない」は**別物**。
# 前者は透明、後者はグレーのハッチングで描き分ける。
# これを区別しないと、覆っていないだけの場所が「安全」に見える。
COVERAGE_CLOSE_M = 50        # 建物欠損(罠3)程度の穴は「覆っている」とみなして埋める半径(m)
HATCH_RGBA = (120, 124, 130, 70)   # 対象外のハッチ色
HATCH_PERIOD = 10            # 斜線の周期(px)
HATCH_WIDTH = 3              # 斜線の太さ(px)

# ハッチを描く範囲 = このアプリが扱う全シナリオの合併bbox。
# ここを外れた場所には何も描かない（地図が素のまま出る）。
# **シナリオを追加したら更新すること。** 現在値は sumidagawa と kandagawa の合併。
COVERAGE_EXTENT = (35.6505, 35.7979, 139.5394, 139.8248)  # lat0, lat1, lon0, lon1


def sniff_encoding(path):
    """UTF-8(BOM付き) か Shift-JIS(CP932) かを先頭行で判定する。

    配布物は19ファイル中18が CP932 で、UTF-8 は shinsui_sumidagawa.csv だけだった
    （docs/findings/データ棚卸し.md 第1節）。決め打ちにすると読めないので毎回判定する。
    """
    with open(path, "rb") as f:
        head = f.readline()
    if head.startswith(b"\xef\xbb\xbf"):
        return "utf-8-sig"
    try:
        head.decode("utf-8")
        return "utf-8"
    except UnicodeDecodeError:
        return "cp932"


def read_points(path):
    """1ファイルを読んで (緯度, 経度, 浸水深) の配列にする。

    列は**必ず名前で参照する**。4_syakujii-sirako.csv だけ列順が
    (地盤高, 浸水深, 緯度, 経度) と他と違うため、位置で読むと壊れる。
    """
    name = os.path.basename(path)
    if name in SUSPECT_DATUM:
        print(f"  ! 警告: {name} は旧日本測地系の疑いがある"
              f"（世界測地系との差 約+360m/-291m。docs/findings/データ棚卸し.md 第3節）")
        print(f"  !        このスクリプトは変換しない。そのまま使うと位置がずれる")

    enc = sniff_encoding(path)
    df = pd.read_csv(path, encoding=enc, low_memory=False)
    df.columns = [str(c).strip() for c in df.columns]

    missing = [c for c in ("浸水深", "緯度", "経度") if c not in df.columns]
    if missing:
        raise ValueError(f"{name}: 必要な列が無い {missing} / 実際の列={list(df.columns)}")

    # 末尾ゴミ行(\x1a等)対策: 数値化できない行を落とす
    for c in ("浸水深", "緯度", "経度"):
        df[c] = pd.to_numeric(df[c], errors="coerce")
    n0 = len(df)
    df = df.dropna(subset=["浸水深", "緯度", "経度"])
    dropped = n0 - len(df)

    # 図郭単位でランク値(0〜7の整数)の面を除外する。
    # ランクが何メートルかはデータから分からないので、実数値の面と混ぜられない。
    # ファイルごと捨てるのではなく図郭単位で落とす（docs/dev/03_ハザード拡張.md C-1「混在ファイルの扱い」）。
    excluded = []
    if "図郭No" in df.columns:
        keep = np.ones(len(df), dtype=bool)
        for sheet, idx in df.groupby("図郭No").indices.items():
            v = df["浸水深"].to_numpy()[idx]
            u = np.unique(v)
            # 全点0m の面は「浸水しない」であってランク値ではない。除外しないこと
            if len(u) >= 2 and len(u) <= 12 and np.all(np.isclose(v, np.round(v))):
                keep[idx] = False
                excluded.append((sheet, len(idx), [float(x) for x in u]))
        if excluded:
            n_ex = sum(e[1] for e in excluded)
            print(f"  ! {name}: ランク値の図郭 {len(excluded)}枚 / {n_ex:,}点 を除外"
                  f"（例: 図郭{excluded[0][0]} の値 {excluded[0][2]}）")
            df = df[keep]

    print(f"  {name}: {len(df):,}点 ({enc})" + (f" / 不正な{dropped}行を除外" if dropped else ""))
    stats = {"file": name, "encoding": enc, "points": int(len(df)),
             "dropped_nonnumeric": int(dropped),
             "excluded_rank_sheets": [{"sheet": int(s) if str(s).isdigit() else str(s),
                                       "points": int(n), "values": vals}
                                      for s, n, vals in excluded]}
    return (df["緯度"].to_numpy(np.float64),
            df["経度"].to_numpy(np.float64),
            df["浸水深"].to_numpy(np.float32),
            stats)


def load_grid(csv, bbox=None):
    """点群CSVを緯度経度の等間隔グリッド(2D配列)へ最近傍で載せる

    csv は単一パスでも、パスのリストでもよい。
    リストを渡した場合は **同一シナリオの地理的分割** とみなして結合する。
    別シナリオ（隅田川と神田川など）を混ぜてはいけない。
    """
    paths = [csv] if isinstance(csv, (str, os.PathLike)) else list(csv)
    parts = [read_points(p) for p in paths]
    lat = np.concatenate([p[0] for p in parts])
    lon = np.concatenate([p[1] for p in parts])
    dep = np.concatenate([p[2] for p in parts])
    sources = [p[3] for p in parts]

    if bbox:
        la0, la1, lo0, lo1 = bbox
        m = (lat >= la0) & (lat <= la1) & (lon >= lo0) & (lon <= lo1)
        lat, lon, dep = lat[m], lon[m], dep[m]
    if len(lat) == 0:
        raise ValueError("有効な点が0件（bboxが範囲外か、列が読めていない）")

    # 図郭ごとに原点がズレるので、公称ステップで一様格子を切り直す。
    #
    # さらに、**格子原点を全シナリオ共通の絶対格子にスナップする**。
    # データ自身の min/max を原点にすると、シナリオごとにセル境界がずれ、
    # 同じ地点でも参照するセルが変わってしまう。
    # その結果、包絡（各点で最大値）なのに minimax 下限が単一シナリオより
    # 下がるという、理論上あり得ない現象が起きていた（±0.02m）。
    #
    # 原点を dlat / dlon の整数倍に丸めると、セル中心は必ず
    # round(lat/dlat)*dlat になり、どのシナリオでも同じ地点は同じセルに落ちる。
    dlat, dlon = 8.33e-5, 1.25e-4
    lat_min, lat_max = lat.min(), lat.max()
    lon_min, lon_max = lon.min(), lon.max()
    lat_max = math.ceil(lat_max / dlat) * dlat     # 北端を絶対格子へ（外側に広げる）
    lon_min = math.floor(lon_min / dlon) * dlon    # 西端を絶対格子へ（外側に広げる）
    nrow = int(math.ceil((lat_max - lat_min) / dlat)) + 1
    ncol = int(math.ceil((lon_max - lon_min) / dlon)) + 1

    grid = np.zeros((nrow, ncol), dtype=np.float32)
    r = np.round((lat_max - lat) / dlat).astype(np.int32)   # 上が北
    c = np.round((lon - lon_min) / dlon).astype(np.int32)
    np.clip(r, 0, nrow - 1, out=r)
    np.clip(c, 0, ncol - 1, out=c)
    np.maximum.at(grid, (r, c), dep)   # 重複セルは最大値を採用（安全側）

    # ---- 想定範囲(coverage)の算出 ----
    # 元データに点があるセルが「覆われている」。ただし建物部分はもともとデータが無い（罠3）ので、
    # そのままだと建物が全部「対象外」になってしまう。
    # 建物程度(≒50m)の穴はクロージングで埋め、残った大きな空白＝想定図の外、とする。
    # つまり coverage は「そのシナリオの浸水想定図が及んでいる範囲」を表す。
    seen = np.zeros((nrow, ncol), dtype=bool)
    seen[r, c] = True
    kr = max(1, int(round(COVERAGE_CLOSE_M / (dlat * 111320))) * 2 + 1)
    kc = max(1, int(round(COVERAGE_CLOSE_M / (dlon * 90400))) * 2 + 1)
    cov = maximum_filter(seen, size=(kr, kc))      # 膨張
    cov = minimum_filter(cov, size=(kr, kc))       # 収縮 → クロージング
    cov = binary_fill_holes(cov)
    print(f"  coverage: {cov.mean() * 100:.1f}% of grid "
          f"(元データのあるセル {seen.mean() * 100:.1f}%, 穴埋め半径 {COVERAGE_CLOSE_M}m)")

    meta = dict(lat_max=lat_max, lat_min=lat_min, lon_min=lon_min, lon_max=lon_max,
                dlat=dlat, dlon=dlon, nrow=nrow, ncol=ncol, coverage=cov,
                sources=sources)
    return grid, meta


def lookup_covered(coords, meta):
    """サンプル点(lon,lat) が、そのシナリオの想定範囲に入っているか。

    グリッドの外は当然 False。中でも coverage が False なら「想定図が及んでいない」。
    """
    cov = meta.get("coverage")
    lon, lat = coords[:, 0], coords[:, 1]
    r = np.round((meta["lat_max"] - lat) / meta["dlat"]).astype(np.int64)
    c = np.round((lon - meta["lon_min"]) / meta["dlon"]).astype(np.int64)
    inside = (r >= 0) & (r < meta["nrow"]) & (c >= 0) & (c < meta["ncol"])
    if cov is None:
        return inside
    np.clip(r, 0, meta["nrow"] - 1, out=r)
    np.clip(c, 0, meta["ncol"] - 1, out=c)
    return inside & cov[r, c]


