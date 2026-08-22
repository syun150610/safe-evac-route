"""APIが本番同梱の静的JSONと**同一のバイト列**を返すことの確認。

静的配信からAPI経由に切り替えても表示が変わらないことを担保する
ためのテスト。本番配布物なので、無ければ失敗する。

    cd backend && python3 tests/test_api.py
"""

import json
import os
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.main import app  # noqa: E402

client = TestClient(app)


def main():
    settings = get_settings()
    bundles_dir = settings.active_bundles_dir
    index_path = os.path.join(bundles_dir, "index.json")
    assert os.path.exists(index_path), f"本番配布用プリセットが無い: {index_path}"
    ng = 0

    assert client.get("/api/health").json() == {"status": "ok"}

    # ① プリセット一覧が index.json と同一
    r = client.get("/api/evac-routes/presets")
    with open(os.path.join(bundles_dir, "index.json"), "rb") as f:
        raw = f.read()
    same = r.status_code == 200 and r.content == raw
    print(f"  presets            バイト一致={same}")
    ng += not same
    idx = json.loads(raw)

    # ② バンドルが各ファイルと同一（全OD × 全シナリオ）
    n = 0
    for sc in [s["id"] for s in idx["scenarios"]]:
        for od in [o["slug"] for o in idx["od"]]:
            p = os.path.join(bundles_dir, sc, f"{od}.json")
            assert os.path.exists(p), f"本番配布用プリセットが無い: {p}"
            got = client.get(f"/api/evac-routes/presets/{od}?scenario={sc}")
            with open(p, "rb") as f:
                want = f.read()
            if got.status_code != 200 or got.content != want:
                print(f"  !! 不一致 {sc}/{od}")
                ng += 1
            n += 1
    assert n == 36, f"プリセット数が不正: {n}（期待値36）"
    print(f"  bundles            {n} 件すべてバイト一致={not ng}")

    # ③ 不正な識別子を弾く（ディレクトリ横断の防止）
    for bad in ["../../etc", "a/b", ".hidden"]:
        code = client.get(f"/api/evac-routes/presets/od01?scenario={bad}").status_code
        if code not in (400, 404):
            print(f"  !! {bad!r} が {code} で通った")
            ng += 1
    print("  不正な識別子       400/404 で拒否")

    # ④ ハザードカタログ。**包絡の説明文と凡例をAPIから配れていること**
    h = client.get("/api/hazards").json()
    ids = [x["id"] for x in h["hazards"]]
    flood = next(x for x in h["hazards"] if x["id"] == "flood")
    quake = next(x for x in h["hazards"] if x["id"] == "quake")
    env = next(s for s in flood["scenarios"] if s["id"] == "envelope")
    checks = [
        ("選択中profileを返す", h["data_profile"] == settings.hazard_data_profile),
        (
            "プリセットも同じprofile",
            r.headers["x-hazard-data-profile"] == settings.hazard_data_profile,
        ),
        ("種別が2つ", ids == ["flood", "quake"]),
        ("同時に1つの方針", h["display_policy"] == "one_at_a_time"),
        ("包絡の説明に『上限の保証』", "上限の保証" in env["note"]),
        (
            "包絡を『同時に氾濫』と言っていない",
            "という意味ではありません" in env["note"]
            or "同時に氾濫した場合" not in env["note"].split("ではありません")[0],
        ),
        (
            "範囲外の凡例に『判断材料がない』",
            any(
                "判断材料がない" in (x.get("note", "") + x["label"])
                for x in flood["legend"]
            ),
        ),
        (
            "タイルURLに var が出ていない",
            all("var" not in s["tile_url"] for s in flood["scenarios"]),
        ),
        # ⚠️ 地震の凡例は**本番で黙って null になっていた**。書き出し済みGeoJSONを
        #    読む作りで、Containerにそのファイルが無かったため。種別の階層に
        #    載っていることを機械で押さえる（浸水と同じ形）。
        ("地震の凡例が種別の階層にある", bool(quake.get("legend"))),
        (
            "地震の凡例にランク1〜5が揃っている",
            sum(1 for x in quake.get("legend", []) if x.get("color")) == 5,
        ),
        (
            "地震の凡例にも『判断材料がない』",
            any(
                "判断材料がない" in (x.get("note", "") + x["label"])
                for x in quake.get("legend", [])
            ),
        ),
        # ⚠️ 係数は焼き込み済みで、生成物に残った値は焼き直しで古くなる。
        #    画面に出さない値をAPIから配らない（2026-08-22にユーザーと確認）。
        (
            "凡例に係数を載せていない",
            all(
                "cost_factor" not in x
                for h_ in h["hazards"]
                for x in (h_.get("legend") or [])
            ),
        ),
        (
            "タイルURLも同じprofile",
            all(
                f"/flood/{settings.hazard_data_profile}/" in s["tile_url"]
                for s in flood["scenarios"]
            ),
        ),
    ]
    for name, ok in checks:
        print(f"  {name:<28} {'OK' if ok else 'NG'}")
        ng += not ok

    print("OK" if not ng else f"NG: {ng} 件")
    return 1 if ng else 0


def test_api_matches_static_files():
    assert main() == 0


if __name__ == "__main__":
    sys.exit(main())
