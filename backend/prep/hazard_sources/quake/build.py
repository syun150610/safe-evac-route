#!/usr/bin/env python3
"""東京都の第9回地域危険度SHPを、前処理共通入力のGPKGへ変換する。"""

from __future__ import annotations

import argparse
import hashlib
import os
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path

from prep.paths import RAW_DIR, rel

DEFAULT_SOURCE = RAW_DIR / "tokyoto_toshiseibikyoku" / "all2.zip"
DEFAULT_OUTPUT = RAW_DIR / "hazard" / "hazard.gpkg"
ARCHIVE_EXTENSIONS = {".shp", ".shx", ".dbf", ".prj"}
REQUIRED_COLUMNS = {
    "区市町村名",
    "町丁目名",
    "建物_ラ",
    "火災_ラ",
    "総合_ラ",
    "geometry",
}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _extract_shapefile(archive: Path, destination: Path) -> Path:
    """文字化けする日本語ファイル名を使わず、拡張子で安全な名前へ展開する。"""
    extracted: set[str] = set()
    with zipfile.ZipFile(archive) as source:
        corrupt = source.testzip()
        if corrupt is not None:
            raise ValueError(f"ZIP内のファイルが壊れている: {corrupt}")

        for member in source.infolist():
            extension = Path(member.filename).suffix.lower()
            if extension not in ARCHIVE_EXTENSIONS:
                continue
            if extension in extracted:
                raise ValueError(f"ZIP内に同じ拡張子が複数ある: {extension}")
            with (
                source.open(member) as src,
                (destination / f"hazard{extension}").open("wb") as dst,
            ):
                shutil.copyfileobj(src, dst)
            extracted.add(extension)

    missing = ARCHIVE_EXTENSIONS - extracted
    if missing:
        raise ValueError(f"ZIP内に必要なファイルが無い: {sorted(missing)}")
    return destination / "hazard.shp"


def _verify(gdf) -> None:
    missing = REQUIRED_COLUMNS - set(gdf.columns)
    if missing:
        raise ValueError(f"期待する列が無い: {sorted(missing)}")

    checks = [
        ("総レコード数", len(gdf), 5192),
        ("市区町村数", gdf["区市町村名"].nunique(), 51),
        ("足立区件数", len(gdf[gdf["区市町村名"] == "足立区"]), 269),
        (
            "足立区の総合ランク5件数",
            len(gdf[(gdf["区市町村名"] == "足立区") & (gdf["総合_ラ"] == 5)]),
            16,
        ),
        ("荒川区件数", len(gdf[gdf["区市町村名"] == "荒川区"]), 52),
        ("世田谷区件数", len(gdf[gdf["区市町村名"] == "世田谷区"]), 277),
    ]

    failures = [
        f"{name}: actual={actual}, expected={expected}"
        for name, actual, expected in checks
        if actual != expected
    ]
    if failures:
        raise ValueError("検証値が一致しない:\n  " + "\n  ".join(failures))

    arakawa1 = gdf[(gdf["区市町村名"] == "荒川区") & (gdf["町丁目名"] == "荒川１丁目")]
    if len(arakawa1) != 1 or int(arakawa1["総合_ラ"].iloc[0]) != 4:
        raise ValueError("荒川区 荒川１丁目の総合ランクが4ではない")


def build(source: Path, output: Path, *, force: bool = False) -> Path:
    import geopandas as gpd

    source = source.resolve()
    output = output.resolve()
    if not source.is_file():
        raise FileNotFoundError(f"一次入力が無い: {source}")
    if output.exists() and not force:
        raise FileExistsError(f"出力済み: {output}（上書きする場合は --force）")

    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="quake-build-") as temp_dir:
        extracted = Path(temp_dir)
        shp = _extract_shapefile(source, extracted)
        gdf = gpd.read_file(shp, encoding="cp932")
        _verify(gdf)
        if gdf.crs is None:
            raise ValueError("SHPのCRSが無い")

        normalized = gdf.to_crs(4326)
        temporary_output = extracted / "hazard.gpkg"
        normalized.to_file(temporary_output, driver="GPKG")

        written = gpd.read_file(temporary_output)
        _verify(written)
        if written.crs is None or written.crs.to_epsg() != 4326:
            raise ValueError(f"出力GPKGのCRSがEPSG:4326ではない: {written.crs}")
        os.replace(temporary_output, output)

    print(f"source: {rel(source)}")
    print(f"source sha256: {_sha256(source)}")
    print(f"saved: {rel(output)} ({output.stat().st_size / 1_000_000:.1f} MB)")
    print("verified: 5,192町丁目 / 51市区町村 / EPSG:4326")
    return output


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    try:
        build(args.source, args.out, force=args.force)
    except (FileNotFoundError, FileExistsError, ValueError, zipfile.BadZipFile) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
