"""避難所・避難場所CSVをGeoJSON（backend/shelters/shelters.json）へ変換する。

Usage:
    cd backend
    python -m prep.shelters.convert
"""

import csv
import json
from pathlib import Path

from prep.paths import RAW_DIR

BACKEND_DIR = Path(__file__).resolve().parents[2]
OUT_FILE = BACKEND_DIR / "shelters" / "shelters.json"

# evacuation_area.csv の列名 → ハザード種別ID
_HAZARD_COLS: dict[str, str] = {
    "洪水": "flood",
    "崖崩れ、土石流及び地滑り": "landslide",
    "高潮": "storm_surge",
    "地震": "quake",
    "津波": "tsunami",
    "大規模な火事": "fire",
    "内水氾濫": "inner_flood",
    "火山現象": "volcano",
}


def _parse_latlng(row: dict, lat_key: str, lon_key: str) -> tuple[float, float] | None:
    try:
        return float(row[lat_key].strip()), float(row[lon_key].strip())
    except (ValueError, KeyError):
        return None


def load_center() -> list[dict]:
    """指定避難所（130001_evacuation_center.csv, Shift-JIS）

    先頭に空行があるため DictReader ではなく手動でヘッダを解決する。
    """
    path = RAW_DIR / "130001_evacuation_center.csv"
    features: list[dict] = []
    with open(path, encoding="shift-jis", errors="replace", newline="") as f:
        reader = csv.reader(f)
        header: list[str] | None = None
        idx = 0
        for row in reader:
            if not any(row):
                continue
            if header is None:
                header = [c.strip() for c in row]
                continue
            row_dict = dict(zip(header, row))
            latlng = _parse_latlng(row_dict, "緯度", "経度")
            if latlng is None:
                continue
            lat, lon = latlng
            features.append(
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [lon, lat]},
                    "properties": {
                        "id": f"designated-{idx}",
                        "name": row_dict.get("避難所_施設名称", "").strip(),
                        "type": "designated",
                        "type_label": "指定避難所",
                        "address": row_dict.get("所在地住所", "").strip(),
                        "municipality": row_dict.get("指定市区町村名", "").strip(),
                        "hazard_types": [],
                    },
                }
            )
            idx += 1
    return features


def load_area() -> list[dict]:
    """指定緊急避難場所（130001_evacuation_area.csv, UTF-8 BOM）"""
    path = RAW_DIR / "130001_evacuation_area.csv"
    features: list[dict] = []
    with open(path, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        # ヘッダ列名に \n が含まれる場合があるので正規化してマッピング
        fieldnames = [k.replace("\n", "") for k in (reader.fieldnames or [])]
        hazard_keys_normalized = {k.replace("\n", ""): v for k, v in _HAZARD_COLS.items()}
        for i, row in enumerate(reader):
            # 列名の \n を除去したdictに変換
            row = {k.replace("\n", ""): v for k, v in row.items()}
            if not any(row.values()):
                continue
            latlng = _parse_latlng(row, "緯度", "経度")
            if latlng is None:
                continue
            lat, lon = latlng
            hazard_types = [
                eng
                for col, eng in hazard_keys_normalized.items()
                if row.get(col, "").strip() == "1"
            ]
            features.append(
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [lon, lat]},
                    "properties": {
                        "id": f"urgent-{i}",
                        "name": row.get("施設名", "").strip(),
                        "type": "urgent",
                        "type_label": "指定緊急避難場所",
                        "address": row.get("所在地住所", "").strip(),
                        "municipality": row.get("区市町村", "").strip(),
                        "hazard_types": hazard_types,
                    },
                }
            )
    return features


def main() -> None:
    features = load_center() + load_area()
    OUT_FILE.parent.mkdir(exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(
            {"type": "FeatureCollection", "features": features},
            f,
            ensure_ascii=False,
            separators=(",", ":"),
        )
    print(f"書き出し完了: {OUT_FILE}  ({len(features)} 件)")


if __name__ == "__main__":
    main()
