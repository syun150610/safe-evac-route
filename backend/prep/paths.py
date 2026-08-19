"""パス解決を1箇所にまとめる。

スクリプトは `backend/prep/` にあるが、参照するものは同じ場所には無い:

    <リポジトリ直下>/data/raw/                 元データ（配布元からのダウンロード）
    <リポジトリ直下>/data/processed/graph/     前処理用グラフ pickle
    backend/graph/                              本番配布用グラフ NPZ
    <リポジトリ直下>/data/processed/tiles/     生成したXYZタイル・ベクタ
    <リポジトリ直下>/data/processed/bundles/   プリセット（APIが返す）
    <リポジトリ直下>/data/cache/               OSMnx のキャッシュ

**`data/` は全部 gitignore。** 生の元データは配布元から取り直せるし、
`processed/` は `prep` で再生成できる（AGENTS.md の `data/{raw,processed}` に合わせた）。

**cwd に依存させない。** `__file__` から解決するので、

    python3 -m prep.tile_render.render --all       # backend/ から
    python3 -m prep.route_search.bundles

のどこから呼んでも同じ場所を読み書きする。生の相対パス（"data/..." など）を
スクリプトに書き足さないこと。cwd 次第で黙って別の場所を見に行く。
"""

import os
import sys
from pathlib import Path

PREP_DIR = Path(__file__).resolve().parent  # backend/prep
ROOT = PREP_DIR.parents[1]  # リポジトリ直下
DATA_ROOT = ROOT / "data"  # 元データと生成物（gitignore）

RAW_DIR = DATA_ROOT / "raw"
PROCESSED_DIR = DATA_ROOT / "processed"
CACHE_DIR = DATA_ROOT / "cache"

GRAPH_DIR = PROCESSED_DIR / "graph"
TILES_DIR = PROCESSED_DIR / "tiles"
BUNDLES_DIR = PROCESSED_DIR / "bundles"

# 本番APIへ同梱する圧縮グラフ。`data/processed/graph` の pickle は前処理用で
# gitignore 対象だが、こちらの npz は小さいため git に入れて Docker へ COPY する。
RUNTIME_GRAPH_DIR = PREP_DIR.parent / "graph"
# 本番APIへ同梱する事前計算済みプリセット。前処理の出力先とは分け、
# Git・Dockerに含まれる配布物であることを明示する。
RUNTIME_BUNDLES_DIR = PREP_DIR.parent / "bundles"

# ⚠️ 旧名。`data_path()` が指すのは「元データ」なので RAW_DIR と同じもの。
#    移送前（hazard-route リポジトリ）は `var/data` だった
DATA_DIR = RAW_DIR
# prep が書き出す先。個別の置き場は上の *_DIR を使うこと
OUT_DIR = PROCESSED_DIR


def data_path(*parts):
    """元データ（浸水深CSV・地震GPKG など）"""
    return str(RAW_DIR.joinpath(*parts))


def graph_path(*parts):
    return str(GRAPH_DIR.joinpath(*parts))


def runtime_graph_path(*parts):
    return str(RUNTIME_GRAPH_DIR.joinpath(*parts))


def tiles_path(*parts):
    return str(TILES_DIR.joinpath(*parts))


def bundles_path(*parts):
    return str(BUNDLES_DIR.joinpath(*parts))


def out_path(*parts):
    return str(PROCESSED_DIR.joinpath(*parts))


def rel(path):
    """生成物のJSONに書くためのリポジトリ相対パス。

    絶対パスを焼き込むと、環境ごとに差分が出て再現性の確認ができなくなる。
    """
    # resolve() はシンボリックリンクを辿ってしまい、data/ を別の場所に張っている
    # 環境でリポジトリ外と判定される。正規化だけして相対を取る
    ap = os.path.abspath(str(path))
    r = os.path.relpath(ap, ROOT)
    return str(path) if r.startswith("..") else r


def quake_gpkg():
    """地震ハザードGPKG（東京都 第9回 地域危険度測定調査 / 17MB）の在り処。

    このリポジトリには入っていない（gitignore）。次の順で探し、最初に在ったものを返す。
    どれも無ければ先頭の候補を返し、呼び出し側が「無いのでスキップ」を表示する。

      1. 環境変数 `HAZARD_QUAKE_GPKG`
      2. `<リポジトリ直下>/data/raw/hazard/hazard.gpkg`
    """
    cands = [
        os.environ.get("HAZARD_QUAKE_GPKG"),
        str(RAW_DIR / "hazard" / "hazard.gpkg"),
    ]
    cands = [c for c in cands if c]
    for c in cands:
        if os.path.exists(c):
            return c
    return cands[0]


def require(path, how):
    """生成物が無いときに「何を実行すれば作れるか」を添えて落とす。

    `data/` は gitignore なので、clone した直後は**何も無いのが正常**。
    「ファイルが無い」だけのエラーで詰まらないようにする。
    """
    if not os.path.exists(str(path)):
        raise FileNotFoundError(f"{rel(path)} が無い。先にこれを実行する:\n    {how}")
    return str(path)


def _warn_if_missing():
    """`data/` が丸ごと無いときだけ一度知らせる（import しただけでは落とさない）"""
    if not DATA_ROOT.exists():
        print(
            f"[paths] {rel(DATA_ROOT)} がありません。"
            "元データを data/raw/ に置き、prep で生成物を作ってください",
            file=sys.stderr,
        )


_warn_if_missing()
