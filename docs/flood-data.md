# 浸水データの入力と再生成

## 一次入力

東京都建設局の浸水予想区域図CSVを正式な一次入力とする。

- データセット: <https://catalog.data.metro.tokyo.lg.jp/dataset/t000014d0000000029>
- 配置先: `data/raw/tokyoto_kensetsukyoku/`
- rawと再生成可能なprocessedはGitへ入れない

現在の3シナリオは `backend/prep/hazard_sources/flood/scenarios.py` を単一の出所とする。

| シナリオ | 建設局CSV |
|---|---|
| `sumidagawa` | `shinsui_sumidagawa.csv` |
| `kandagawa` | `shinsui_kandagawa.csv` |
| `envelope` | 隅田川、神田川、中川・綾瀬川、江東内部河川 |

神田川CSVには、小数メートルと整数メートルの図郭が混在する。整数値を未知のランクとして
除外せず、東京都の公開値をメートルとしてそのまま採用する。丸め前の値は推定・補正しない。

グラフへ地震属性も焼き込むため、次のファイルも必要になる。

```text
data/raw/hazard/hazard.gpkg
```

このファイルがない場合、グラフ生成は警告を出して地震属性を省略する。その出力を本番へ
採用してはいけない。

## 既存成果物を上書きしない再生成

生成物は「成果物の種類 → 入力profile → 探索範囲」で分ける。浸水タイルは単一ハザード
なので `flood/kensetsu`、地震属性も含むグラフ・NPZ・bundleは
`flood-kensetsu_quake-risk9/scope-kitasenju-ueno` とする。

`scope-kitasenju-ueno` は北千住駅～上野駅を囲むbboxに片側1kmの余白を加えた範囲で、
東京都全域を意味しない。正確なbboxと余白はグラフのmeta JSONにも記録する。

検証が終わるまで `backend/graph/`、`backend/bundles/`、R2の本番prefixを変更しない。

```bash
cd backend
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

BUNDLES_DIR="$BUNDLE_OUT" uv run --frozen pytest tests/test_api.py
```

旧下水道局版は `flood-gesuido_quake-risk9/scope-kitasenju-ueno`、建設局版は
`flood-kensetsu_quake-risk9/scope-kitasenju-ueno` と識別する。本番採用時は両profileを
保持し、利用者向け切替UIではなくデプロイ設定1つで選択できるようにする。

## 採用前の確認

- タイル、pickle、NPZ、プリセットがすべて別出力にある
- グラフ生成ログに地震5,192町丁目が読み込まれたことが出る
- NPZ変換時の全12 OD・全ハザード条件の検証が成功する
- プリセットAPIの全36件が静的JSONとバイト一致する
- 入力ファイル、SHA256、bbox、coverage、タイル数、経路統計を記録する
- 旧版との差分は機械検証だけに使い、利用者向け比較UIは作らない
