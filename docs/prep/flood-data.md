# 浸水データ（flood）

東京都建設局の浸水予想区域図から、表示タイルと経路探索グラフを作る手順。

⚠️ **この文書は浸水だけを扱う。** 地震（地域危険度）は工程が違うので
[地震データ](quake-data.md)にある。ただし**経路への焼き込みは両方まとめて行う**ので、
グラフ構築の節（[旧スコープ](#旧スコープscope-kitasenju-uenoの再生成) /
[新スコープ](#新スコープscope-tokyo-23ku-tama-shigaikaの構築)）は地震にも効く。

## 一次入力

東京都建設局の浸水予想区域図CSVを正式な一次入力とする。

- データセット: <https://catalog.data.metro.tokyo.lg.jp/dataset/t000014d0000000029>
- 配置先: `data/raw/tokyoto_kensetsukyoku/`
- rawと再生成可能なprocessedはGitへ入れない

現在の3シナリオは `backend/prep/hazard_sources/flood/scenarios.py` を単一の出所とする。

CSV 17件と地震SHPの取得、地震GPKGの生成は[一次データの取得](raw-data.md)を使う。

| シナリオ | 建設局CSV |
|---|---|
| `sumidagawa` | `shinsui_sumidagawa.csv` |
| `kandagawa` | `shinsui_kandagawa.csv` |
| `envelope` | 10ファイル。隅田川、神田川、中川・綾瀬川、江東内部河川、浅川、多摩川、野川、石神井川白子川、城南、秋川（2026-08-21に4→10へ。採否の理由は `scenarios.py` に記録） |

神田川CSVには、小数メートルと整数メートルの図郭が混在する。整数値を未知のランクとして
除外せず、東京都の公開値をメートルとしてそのまま採用する。丸め前の値は推定・補正しない。

グラフへ地震属性も焼き込むため、公式SHPから正規化した次のファイルも必要になる。

```text
data/raw/hazard/hazard.gpkg
```

このファイルがない場合、グラフ生成は警告を出して地震属性を省略する。その出力を本番へ
採用してはいけない。

## 表示タイルだけ必要な場合

通常のAPI・探索開発にはrawもタイルも不要である。ローカルで浸水レイヤーまで表示したい
場合だけ、次を実行する。pickle・NPZ・プリセットの生成は不要である。

まず建設局CSV 17件を取得する。

```bash
cd "$(git rev-parse --show-toplevel)"
./scripts/prep/download-raw.sh flood
```

浸水PNGを生成する。

```bash
cd "$(git rev-parse --show-toplevel)/backend"
uv sync --frozen --group prep

uv run --frozen --group prep python -m prep.tile_render.render \
  --all --out-root ../data/processed/tiles/flood/kensetsu
```

⚠️ **地震レイヤーはこの手順では出ない。** 地震はタイルを焼かずGeoJSONで配るので、
手順が別である（[地震データ](quake-data.md)）。両方見たい場合はそちらも実行する。

取得済みの空でないrawと既存GPKGは既定で再取得・上書きしない。取得物、公式URL、検証内容、
明示的に作り直す場合の`--force`は[一次データの取得](raw-data.md)を参照する。一度も生成して
いない端末でも、ここまででローカル表示確認には足りる。

⚠️ **重み・コスト表だけを変えた場合**は、この章の再生成に加えて
「どのNPZをAPIに読ませるか」の指定が要る。落とし穴は
[ローカル実行・検証runbook](../local-runbook.md#5-6-重みコスト表を変えたとき)を参照。

## 探索範囲は2つある

グラフ・NPZ・bundleは「成果物の種類 → 入力profile → **探索範囲**」で分ける。
現在は範囲が2つあり、**本番が使うのは新しい方だけ**である。

| 範囲ディレクトリ | 内容 | 本番 |
|---|---|---|
| `scope-tokyo-23ku-tama-shigaika` | 23区＋多摩の市街化区域 1,324.85 km²（地域危険度の町丁目5,192件 / 51市区町村を融合）。652,828ノード / 1,905,380エッジ | **これを使う**（`app/core/config.py` の `RUNTIME_SCOPE_ID`。定義は `prep/route_search/scopes.py`） |
| `scope-kitasenju-ueno` | 北千住駅～上野駅のbbox＋片側1km、26.7 km²。27,144ノード / 82,586エッジ | 使わない（`gesuido` profileの成果物だけが残っている） |

⚠️ **2つの範囲でファイル名が同じ**（`kitasenju_ueno_envelope.npz` など）。
名前は `prep/route_search/bundles.py` の `GRAPHS` のbasenameから決まるため、
新スコープの成果物も旧スコープ時代の名前のままである。
**範囲ディレクトリを間違えてコピーすると、本番のNPZ（39MB / 190万エッジ）を
旧スコープのNPZ（1.6MB / 8.2万エッジ）で静かに上書きする。**
コピー先のディレクトリ名を必ず確認すること。

⚠️ `gesuido` profile には新スコープの成果物が無い。
`HAZARD_DATA_PROFILE=gesuido` では `/api/evac-routes/presets` が503になる。

## 旧スコープ（scope-kitasenju-ueno）の再生成

⚠️ **この手順が作るのは旧スコープのグラフだけである。** 本番が使う
新スコープは作れない（新スコープの手順は次章）。旧スコープの成果物を
比較・検証のために作り直す場合にだけ使う。

`prep/route_search/graph.py` はOverpassから北千住駅～上野駅のbbox＋片側1kmを
取得する実装で、範囲は `prep/route_search/snap.py` の `ORIGIN_DEFAULT` /
`DEST_DEFAULT` / `MARGIN_KM` で決まる。正確なbboxと余白はグラフのmeta JSONにも記録する。

再生成結果を確認するまでは `backend/graph/`、`backend/bundles/`、R2の本番prefixを
変更しない。採用時は後述のprofile別ディレクトリへ追加し、旧成果物も残す。

```bash
cd "$(git rev-parse --show-toplevel)/backend"
PROFILE=flood-kensetsu_quake-risk9
SCOPE=scope-kitasenju-ueno
TILE_OUT=../data/processed/tiles/flood/kensetsu
GRAPH_OUT=../data/processed/graph/$PROFILE/$SCOPE
NPZ_OUT=../data/processed/runtime_graph/$PROFILE/$SCOPE
BUNDLE_OUT=../data/processed/bundles/$PROFILE/$SCOPE

uv run --frozen --group prep python -m prep.tile_render.render \
  --all --out-root "$TILE_OUT"

uv run --frozen --group prep python -m prep.route_search.graph \
  --scenario envelope --out "$GRAPH_OUT/kitasenju_ueno_envelope.pkl"
uv run --frozen --group prep python -m prep.route_search.graph \
  --scenario kandagawa --out "$GRAPH_OUT/kitasenju_ueno_kandagawa.pkl"
uv run --frozen --group prep python -m prep.route_search.graph \
  --scenario sumidagawa --out "$GRAPH_OUT/kitasenju_ueno.pkl"

uv run --frozen --group prep python -m prep.route_search.export_npz \
  --source-dir "$GRAPH_OUT" --outdir "$NPZ_OUT"

uv run --frozen --group prep python -m prep.route_search.bundles \
  --graph-dir "$GRAPH_OUT" --outdir "$BUNDLE_OUT"

HAZARD_DATA_PROFILE=kensetsu \
  BUNDLES_DIR=../data/processed/bundles \
  GRAPH_DIR=../data/processed/runtime_graph \
  uv run --frozen pytest tests/test_api.py tests/test_npz_graph.py
```

旧下水道局版は `flood-gesuido_quake-risk9/scope-kitasenju-ueno`、建設局版は
`flood-kensetsu_quake-risk9/scope-kitasenju-ueno` と識別する。本番採用時は両profileを
保持し、利用者向け切替UIではなくデプロイ設定1つで選択できるようにする。

## 新スコープ（scope-tokyo-23ku-tama-shigaika）の構築

本番が使うグラフはこちらで作る。**Overpassは使わない**（2026-08-21の作業で
実際にタイムアウトしたため、Geofabrikの配布pbfへ切り替えた）。

工程は4つで、`backend/prep/route_search/area_graph/build.py` が
順に実行する。工程ごとに中間結果を残し、既に出力があればその工程を飛ばすので、
途中で落ちても同じコマンドで再開できる。

| 工程 | 内容 | 実測 |
|---|---|---|
| 1 area | 地域危険度GPKGの町丁目5,192件を融合して範囲GeoJSONにする（頂点は約20m許容差で39,956→2,253に簡略化、面積差 −0.003%） | 数秒 |
| 2 cut | `osmium extract -p <範囲> --strategy complete_ways`。範囲境界をまたぐ道はway単位で丸ごと残るので `truncate_by_edge=True` と同じ扱いになる | 15秒 / 113MB |
| 3 filter | osmnx 2.1.1 の `_get_network_filter("walk")` と同じ条件をpbfへ適用し `.osm` XMLを書く（pyosmium。Overpassの `!~` に合わせ、アンカー無し正規表現・キーが無ければ通す） | 60秒 / way 451,765・ノード1,660,045 |
| 4 graph | `osmnx.graph_from_xml(bidirectional=True, simplify=True, retain_all=False)` | 413秒 / 652,828ノード・1,905,380エッジ |

⚠️ 工程4の `bidirectional=True` を省略しないこと。osmnx は
`settings.bidirectional_network_types = ["walk"]` により `graph_from_bbox` の
walk では一方通行を無視するが、`graph_from_xml` の既定は `False` である。

```bash
cd "$(git rev-parse --show-toplevel)/backend"
curl -L -o /tmp/kanto-latest.osm.pbf \
  https://download.geofabrik.de/asia/japan/kanto-latest.osm.pbf

uv run --frozen --group prep python -u \
  -m prep.route_search.area_graph.build --pbf /tmp/kanto-latest.osm.pbf

# 浸水・地震の焼き込み（シナリオごと）。中間生成物は data/processed/graph_build/tokyo-23ku-tama-shigaika/
uv run --frozen --group prep python -u \
  -m prep.route_search.area_graph.bake --scenario envelope
uv run --frozen --group prep python -u \
  -m prep.route_search.area_graph.export_npz --scenario envelope
```

⚠️ **`osmium` コマンドと Python 3.12 が要る。** 工程2は osmium-tool（`/usr/bin/osmium`）、
工程3は pyosmium を使う。pyosmium は Python 3.14 のプロジェクト環境へ入らないため、
`uv run --no-project --python 3.12 --with osmium` で別環境を作って実行している
（`build.py` が内部で呼ぶ）。

中間生成物は `data/processed/graph_build/tokyo-23ku-tama-shigaika/` に出る（合計約4.5GB、Git管理外）。
⚠️ **スコープごとのディレクトリに分かれる。** `build.py` も `bake.py` も出力が既に
あれば工程を飛ばすので、共用すると別の範囲の中間物を掴んで黙って飛ばす。
焼き上がりpickleは1本 662,934,933B、書き出したNPZは envelope 39,169,547B /
隅田川 33,825,368B / 神田川 32,992,549B である
（2026-08-22の地震係数変更で焼き直したもの。焼き直しの所要は envelope 3分31秒 /
隅田川 2分22秒 / 神田川 2分18秒、NPZ書き出しは各34〜38秒）。

### NPZを本番配布ディレクトリへ置く（**スクリプトが無い手作業**）

⚠️ **ここはスクリプトが無い。手で置く。** 生成物の名前（`area_*.npz`）と
本番配布物の名前（`kitasenju_ueno*.npz`）が違うので、次のように対応させる。
`kitasenju_ueno.npz` が**隅田川**であることに注意（接尾辞なしが既定シナリオ）。

```bash
cd "$(git rev-parse --show-toplevel)"
SRC=data/processed/graph_build/tokyo-23ku-tama-shigaika
DST=backend/graph/flood-kensetsu_quake-risk9/scope-tokyo-23ku-tama-shigaika

cp $SRC/area_envelope.npz        $DST/kitasenju_ueno_envelope.npz
cp $SRC/area_envelope_meta.json  $DST/kitasenju_ueno_envelope_meta.json
cp $SRC/area_sumidagawa.npz      $DST/kitasenju_ueno.npz
cp $SRC/area_sumidagawa_meta.json $DST/kitasenju_ueno_meta.json
cp $SRC/area_kandagawa.npz       $DST/kitasenju_ueno_kandagawa.npz
cp $SRC/area_kandagawa_meta.json $DST/kitasenju_ueno_kandagawa_meta.json
```

⚠️ コピー先のディレクトリ名を必ず確認する。旧スコープ（`scope-kitasenju-ueno`）は
**同じファイル名で 1.6MB** なので、間違えても気づかずに上書きできてしまう。

### プリセットを作る（**pickleのリネームが要る**）

プリセットは旧スコープと同じ `prep.route_search.bundles` を使う。ただし
`--graph-dir` に渡すディレクトリのファイル名を `GRAPHS` のbasename
（`kitasenju_ueno_envelope.pkl` 等）に合わせる必要がある。

⚠️ **pickleをコピーしない。1本663MBある。** ハードリンクで別名を作る
（同じファイルシステムなので実体は増えない）。中間pickleを退避してある場合も、
リンク先を間違えると**古い係数のプリセットができる**ので、`ls -la` で日時を見る。

```bash
cd "$(git rev-parse --show-toplevel)/data/processed/graph_build/tokyo-23ku-tama-shigaika"
mkdir -p asnames
ln -f area_envelope.pkl   asnames/kitasenju_ueno_envelope.pkl
ln -f area_sumidagawa.pkl asnames/kitasenju_ueno.pkl          # 接尾辞なしが隅田川
ln -f area_kandagawa.pkl  asnames/kitasenju_ueno_kandagawa.pkl

cd "$(git rev-parse --show-toplevel)/backend"
BUNDLE_OUT=../data/processed/bundles/flood-kensetsu_quake-risk9/scope-tokyo-23ku-tama-shigaika
uv run --frozen --group prep python -m prep.route_search.bundles \
  --graph-dir ../data/processed/graph_build/tokyo-23ku-tama-shigaika/asnames --outdir "$BUNDLE_OUT"

# 検証してから本番配布物へ入れる
rsync -a --delete "$BUNDLE_OUT/" \
  bundles/flood-kensetsu_quake-risk9/scope-tokyo-23ku-tama-shigaika/
```

実測7分38秒（envelope 91秒 / 神田川 127秒 / 隅田川 196秒）、37ファイル・9.3MB。
`index.json` はOD一覧とシナリオ一覧しか持たないので、経路が変わっても内容は変わらない。

⚠️ **プリセットとNPZは必ず同じ焼き直し世代から作る。** 片方だけ更新すると、
同じODでプリセットと任意地点探索が違う経路・違う距離を返す
（2026-08-22に実際に起きた: 北千住→上野の combined がプリセット5,791.5m /
探索5,563.1m）。置いた後に一致を確認すること。

```bash
cd "$(git rev-parse --show-toplevel)/backend"
PYTHONPATH=. uv run --frozen python - <<'PY'
import json
from app.services.evac_routes import bundle_store, search as S
for od in bundle_store.index()["od"]:
    b = json.loads(bundle_store.bundle_raw("envelope", od["slug"]))
    o, d = b["od"]["origin"]["latlon"], b["od"]["dest"]["latlon"]
    live = {r["id"]: r["stats"] for r in S.search(
        tuple(o), tuple(d), hazards={"flood": "envelope", "quake": "total"})["routes"]}
    for r in b["routes"]:
        if r["id"] in live:
            assert r["stats"]["distance_m"] == live[r["id"]]["distance_m"], (od["slug"], r["id"])
print("プリセットと任意地点探索は一致")
PY
```

### この手順の置き場（2026-08-22に移設済み）

新スコープの構築コードは `backend/prep/route_search/area_graph/` にある。
本番の成果物を作る手順が検証専用領域（`studies/`）にあるのは矛盾していたため、
`prep.route_search.graph`（旧スコープ・矩形bbox）と並ぶ位置へ移した。

| 範囲の作り方 | 置き場 | 実行 |
|---|---|---|
| 矩形bbox（旧スコープ） | `prep/route_search/graph.py` | 1コマンドで取得〜焼き込み〜保存 |
| ポリゴン融合（新スコープ） | `prep/route_search/area_graph/` | `build` → `bake` → `export_npz` の3コマンド |

`studies/graph_array/measure_area_graph.py` は成果物を作らない実測スクリプトなので
`studies/` に残してある。

## runtime成果物と切替設定

Git・Dockerへ含める成果物は、次の2世代を同時に保持する。

```text
backend/graph/flood-kensetsu_quake-risk9/scope-tokyo-23ku-tama-shigaika/   ← 本番
backend/graph/flood-kensetsu_quake-risk9/scope-kitasenju-ueno/
backend/graph/flood-gesuido_quake-risk9/scope-kitasenju-ueno/
backend/bundles/flood-kensetsu_quake-risk9/scope-tokyo-23ku-tama-shigaika/ ← 本番
backend/bundles/flood-kensetsu_quake-risk9/scope-kitasenju-ueno/
backend/bundles/flood-gesuido_quake-risk9/scope-kitasenju-ueno/
```

⚠️ **2世代の同時保持は新スコープでは成立していない。** `gesuido` には
新スコープの成果物が無いため、いまは `kensetsu` から戻す先が無い
（`docs/dev/07_課題と作業計画.md` の P0-5）。

本番の選択箇所は `worker/wrangler.jsonc` の `HAZARD_DATA_PROFILE` 1つだけ。

- `gesuido`: 旧・下水道局世代
- `kensetsu`: 新・建設局世代

Workerはこの値をFastAPI Containerへ渡す。FastAPIは同じ値からプリセットとNPZを選び、
`/api/hazards` は同じprofileを含むタイルURLを返す。変更後はWorkerを再デプロイする。
起動済みContainerのグラフを途中で差し替える運用はしない。

FastAPIを単体起動するときは `backend/.env` の同名設定を使う。

## R2タイル

R2はprofileをオブジェクトキーに含め、旧新のタイルと24時間キャッシュが混ざらない
構造にする。

```text
flood/gesuido/{scenario}/{z}/{x}/{y}.png
flood/kensetsu/{scenario}/{z}/{x}/{y}.png
quake/{building,fire,total}.geojson
```

旧タイルが `data/processed/tiles/flood/{scenario}` にある環境では、初回だけ次のように
profile名の下へコピーする。元ディレクトリは削除しない。

```bash
cd "$(git rev-parse --show-toplevel)/data/processed/tiles/flood"
mkdir -p gesuido
cp -a envelope kandagawa sumidagawa gesuido/
```

両profile 2,491枚ずつと地震GeoJSON 3件、合計4,985件が揃った後にアップロードする。
このコマンドはR2を書き換えるため、PRのローカル検証では実行しない。

```bash
cd "$(git rev-parse --show-toplevel)/worker"
npm run tiles:upload -- "$(cd ../data/processed/tiles && pwd)" --check
# `validated 4985 assets (no upload)` を確認した後、レビュー済みなら:
npm run tiles:upload -- "$(cd ../data/processed/tiles && pwd)"
```

従来の `flood/{scenario}/...` は直ちに削除せずロールバック期間中は残すが、新しいAPIは
profile付きURLだけを返す。

## 採用前の確認

- タイル、pickle、NPZ、プリセットがすべて別出力にある
- グラフ生成ログに地震5,192町丁目が読み込まれたことが出る
- NPZ変換時の全12 OD・全ハザード条件の検証が成功する
  （⚠️ これは旧スコープの `prep.route_search.export_npz` の話。新スコープの
  `prep/route_search/area_graph/export_npz.py` は `save_graph_npz` だけを呼び、
  pickleとの一致検証を通していない。`docs/dev/07_課題と作業計画.md` の P0-6）
- プリセットAPIの全36件が静的JSONとバイト一致する
- 入力ファイル、SHA256、bbox、coverage、タイル数、経路統計を記録する
- 旧版との差分は機械検証だけに使い、利用者向け比較UIは作らない
- API・探索・タイルURLが同じ `HAZARD_DATA_PROFILE` を参照する
