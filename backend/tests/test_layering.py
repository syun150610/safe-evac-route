"""レイヤ違反の検出。2つ見る。

1. 本番（app / prep）が studies を import していないこと
2. **API が前処理の重い依存（osmnx / geopandas / scipy / pandas / Pillow）を
   引き込んでいないこと**

2 は実際に一度破れていた。`app/services/hazards/catalog.py` が
`prep.route_search.bundles` から説明文を読み、その bundles が
`prep.route_search.graph`（osmnx）を import していた。
（→ 探索に要るぶんを `prep/route_search/snap.py` に切り出して解消）

1 も実際に一度破れていた。`bundles.py`が
検証用の `od_study.py` から OD 定義を import していた
（→ `prep/route_search/od.py` に切り出して解消）。
`backend/studies/` は検証専用で、本番の依存グラフには入らない。

どちらも名前と善意だけに頼らず、機械で落とす。

    cd backend && python3 -m pytest tests/          # pytest があれば
    cd backend && python3 tests/test_layering.py    # 無くても単体で走る
"""

import ast
import pathlib
import sys

BACKEND = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))  # 単体で走らせたときに app / prep を見つけるため

# 本番側 → ここが studies を触っていたら違反
PRODUCTION = ["app", "prep"]
FORBIDDEN = "studies"


def _imported_modules(path):
    """ファイルが import している最上位モジュール名を返す（関数内 import も拾う）"""
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                yield a.name.split(".")[0], node.lineno
        elif isinstance(node, ast.ImportFrom):
            if node.level:  # 相対import は同じパッケージ内なので対象外
                continue
            if node.module:
                yield node.module.split(".")[0], node.lineno


def find_violations():
    bad = []
    for top in PRODUCTION:
        root = BACKEND / top
        if not root.exists():
            continue
        for f in sorted(root.rglob("*.py")):
            for mod, line in _imported_modules(f):
                if mod == FORBIDDEN:
                    bad.append(
                        f"{f.relative_to(BACKEND)}:{line} が "
                        f"{FORBIDDEN} を import している"
                    )
    return bad


def test_production_does_not_import_studies():
    bad = find_violations()
    assert not bad, (
        "本番コードが studies を import している（依存は studies → prep の一方向）:\n  "
        + "\n  ".join(bad)
    )


# ---------------- 2. API が重い依存を引き込んでいないこと ----------------

# 前処理（backend/prep/requirements.txt）にしか無いもの。
# API の Dockerfile は backend/requirements.txt しか入れないので、
# ここに載るものを API が import すると**本番で ImportError になる**。
HEAVY = ["osmnx", "geopandas", "scipy", "pandas", "PIL"]


# API が実際に叩かれる経路。import しただけでは遅延importが走らないので、
# 主要なエンドポイントを1回ずつ呼んでから確認する
def _exercise_api():
    from fastapi.testclient import TestClient

    from app.main import app

    c = TestClient(app)
    c.get("/healthz")
    c.get("/api/hazards")  # ← catalog.py が prep の説明文を読む
    c.get("/api/evac-routes/presets")
    c.get("/api/evac-routes/area")
    # POST /search は実際にグラフを引く（pickle が無ければ 503 で返るのでそれでよい）
    c.post(
        "/api/evac-routes/search",
        json={
            "origin": {"lat": 35.7497, "lon": 139.8050},
            "dest": {"lat": 35.7141, "lon": 139.7774},
            "hazards": {"flood": "envelope", "quake": "total"},
        },
    )


def find_heavy_imports():
    _exercise_api()
    return [m for m in HEAVY if m in sys.modules]


def test_api_does_not_pull_heavy_deps():
    got = find_heavy_imports()
    assert not got, (
        "API が前処理側の依存を引き込んでいる: " + ", ".join(got) + "\n"
        "  pyproject の [project] dependencies に入っていないので"
        "本番で ImportError になる。\n"
        "  重いモジュールは関数の中で import するか、"
        "軽い側（snap.py など）へ切り出すこと"
    )


if __name__ == "__main__":
    ng = 0
    v = find_violations()
    if v:
        print("NG:")
        for x in v:
            print("  " + x)
        ng += 1
    else:
        print(f"OK: {'/'.join(PRODUCTION)} は {FORBIDDEN} を import していない")

    h = find_heavy_imports()
    if h:
        print(f"NG: API が重い依存を引き込んでいる: {', '.join(h)}")
        ng += 1
    else:
        print(f"OK: API は {'/'.join(HEAVY)} を引き込んでいない")
    sys.exit(1 if ng else 0)
