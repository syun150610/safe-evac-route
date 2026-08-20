# 浸水データの入力と再生成

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
| `envelope` | 隅田川、神田川、中川・綾瀬川、江東内部河川 |

神田川CSVには、小数メートルと整数メートルの図郭が混在する。整数値を未知のランクとして
除外せず、東京都の公開値をメートルとしてそのまま採用する。丸め前の値は推定・補正しない。

グラフへ地震属性も焼き込むため、公式SHPから正規化した次のファイルも必要になる。

```text
data/raw/hazard/hazard.gpkg
```

このファイルがない場合、グラフ生成は警告を出して地震属性を省略する。その出力を本番へ
採用してはいけない。

## 表示タイルだけ必要な場合

通常のAPI・探索開発にはrawもタイルも不要である。Dockerバックエンドとnpmフロントで
浸水・地震レイヤーまで表示したい場合だけ、共有済みの `data/processed/tiles/` を配置するか、
次を実行する。pickle・NPZ・プリセットの生成は不要である。

```bash
cd "$(git rev-parse --show-toplevel)/backend"
uv sync --frozen --group prep

uv run --frozen --group prep python -m prep.tile_render.render \
  --all --out-root ../data/processed/tiles/flood/kensetsu

uv run --frozen --group prep python -m prep.hazard_sources.quake.export
```

必要なCSVとGPKGの準備は[一次データの取得](raw-data.md)を参照する。一度も生成していない
端末でも、このタイル生成まででローカル表示確認には足りる。

## 既存成果物を上書きしない再生成

ここから先は、raw・シナリオ・格子処理・重み・探索範囲を変更した場合や、本番採用する
成果物を更新する場合の手順である。初回cloneしただけのチームメンバーは実行不要である。

生成物は「成果物の種類 → 入力profile → 探索範囲」で分ける。浸水タイルは単一ハザード
なので `flood/kensetsu`、地震属性も含むグラフ・NPZ・bundleは
`flood-kensetsu_quake-risk9/scope-kitasenju-ueno` とする。

`scope-kitasenju-ueno` は北千住駅～上野駅を囲むbboxに片側1kmの余白を加えた範囲で、
東京都全域を意味しない。正確なbboxと余白はグラフのmeta JSONにも記録する。

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

uv run --frozen --group prep python -m prep.hazard_sources.quake.export

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

## runtime成果物と切替設定

Git・Dockerへ含める成果物は、次の2世代を同時に保持する。

```text
backend/graph/{flood-gesuido_quake-risk9,flood-kensetsu_quake-risk9}/
  scope-kitasenju-ueno/
backend/bundles/{flood-gesuido_quake-risk9,flood-kensetsu_quake-risk9}/
  scope-kitasenju-ueno/
```

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
- プリセットAPIの全36件が静的JSONとバイト一致する
- 入力ファイル、SHA256、bbox、coverage、タイル数、経路統計を記録する
- 旧版との差分は機械検証だけに使い、利用者向け比較UIは作らない
- API・探索・タイルURLが同じ `HAZARD_DATA_PROFILE` を参照する
