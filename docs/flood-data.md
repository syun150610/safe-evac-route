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

以下は `data/processed/kensetsu/` へ別出力する。検証が終わるまで `backend/graph/`、
`backend/bundles/`、R2の本番prefixを変更しない。

```bash
cd backend
OUT=../data/processed/kensetsu

uv run --frozen --group prep python -m prep.tile_render.render \
  --all --out-root "$OUT/tiles/flood"

uv run --frozen --group prep python -m prep.route_search.graph \
  --scenario envelope --out "$OUT/graph/kitasenju_ueno_envelope.pkl"
uv run --frozen --group prep python -m prep.route_search.graph \
  --scenario kandagawa --out "$OUT/graph/kitasenju_ueno_kandagawa.pkl"
uv run --frozen --group prep python -m prep.route_search.graph \
  --scenario sumidagawa --out "$OUT/graph/kitasenju_ueno.pkl"

uv run --frozen --group prep python -m prep.route_search.export_npz \
  --source-dir "$OUT/graph" --outdir "$OUT/runtime_graph"

uv run --frozen --group prep python -m prep.route_search.bundles \
  --graph-dir "$OUT/graph" --outdir "$OUT/bundles"

BUNDLES_DIR="$OUT/bundles" uv run --frozen pytest tests/test_api.py
```

## 採用前の確認

- タイル、pickle、NPZ、プリセットがすべて別出力にある
- グラフ生成ログに地震5,192町丁目が読み込まれたことが出る
- NPZ変換時の全12 OD・全ハザード条件の検証が成功する
- プリセットAPIの全36件が静的JSONとバイト一致する
- 入力ファイル、SHA256、bbox、coverage、タイル数、経路統計を記録する
- 旧版との差分は機械検証だけに使い、利用者向け比較UIは作らない
