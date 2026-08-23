# 地震データ（quake）

東京都「地震に関する地域危険度測定調査（第9回）」を、地図表示と経路探索で使える形へ
変換する手順。浸水（flood）とは工程が違うので分けてある。

## 浸水との違い

| | 浸水（flood） | 地震（quake） |
|---|---|---|
| 元データ | 点群CSV 17件 | 町丁目ポリゴンSHP 1件 |
| 表示 | **PNGラスタタイル**を焼く（z10〜15、profile別） | **GeoJSONを1枚**書き出す。タイルは焼かない |
| 前処理 | 格子再構成 → タイル生成 | GPKG正規化 → GeoJSON書き出し |
| シナリオ | `envelope` / `sumidagawa` / `kandagawa` | `total` / `building` / `fire`（ランクの列違い） |
| 経路への焼き込み | グラフ構築時に同時に行う（[flood-data.md](flood-data.md)） | ← **同じ工程で一緒に焼かれる** |

⚠️ **ラスタに焼かない理由**は `prep/hazard_sources/quake/export.py` に書いてある。
町丁目単位の離散ランクなので、境界がそのまま意味を持つ。ラスタにすると境界がぼやけ、
クリックしてランクを出すこともできなくなる。

⚠️ **経路への焼き込みに地震専用の手順は無い。** グラフを焼くコマンド
（`prep.route_search.graph` / `prep.route_search.area_graph.bake`）が浸水と地震を
まとめてエッジ属性へ入れる。地震だけを焼き直すことはできない。

## 前処理は2工程だけ

```text
公式SHP（all2.zip）
   │  ① prep.hazard_sources.quake.build
   ▼
data/raw/hazard/hazard.gpkg      ← 下流の共通入力
   │  ② prep.hazard_sources.quake.export      ③ グラフ構築（flood と同時）
   ▼                                             ▼
data/processed/tiles/quake/*.geojson          エッジ属性 quake_rank_* / cost_quake
   （地図表示・R2へ）                            （経路探索）
```

前提として、公式SHPを取得しておく（[一次データの取得](raw-data.md)）。

```bash
cd "$(git rev-parse --show-toplevel)"
./scripts/prep/download-raw.sh quake
```

prep依存も入れておく。

```bash
cd "$(git rev-parse --show-toplevel)/backend"
uv sync --frozen --group prep
```

## ① SHP → GPKG 正規化

下流の前処理はすべて `data/raw/hazard/hazard.gpkg` を共通入力として使う。

```bash
cd "$(git rev-parse --show-toplevel)/backend"
uv run --frozen --group prep python -m prep.hazard_sources.quake.build
```

既存GPKGがある場合は**上書きせず終了する**。公式SHPから作り直すと決めたときだけ
`--force` を付ける。

```bash
uv run --frozen --group prep python -m prep.hazard_sources.quake.build --force
```

### 変換時の機械検証

次を検証し、一致しなければGPKGを採用しない。

- 5,192町丁目、51市区町村
- 足立区269件、うち総合ランク5が16件
- 荒川区52件、世田谷区277件
- 荒川区「荒川１丁目」の総合ランクが4
- 出力CRSがEPSG:4326

2026-08-20に公式 `all2.zip` から生成したGPKGは、従来の検証済みGPKGと全属性値・形状が
一致した。GeoPackage自体のバイト列はメタデータ等で変わり得るため、**バイト一致ではなく
レコード・属性・形状で比較する。**

## ② GeoJSON 書き出し

地図に描くベクタを作る。3シナリオぶん出る。

```bash
cd "$(git rev-parse --show-toplevel)/backend"
uv run --frozen --group prep python -m prep.hazard_sources.quake.export
```

1つだけ作り直す場合と、範囲を絞る場合。

```bash
uv run --frozen --group prep python -m prep.hazard_sources.quake.export --scenario total
uv run --frozen --group prep python -m prep.hazard_sources.quake.export --bbox 139.76 35.70 139.82 35.76
```

出力は次の3件。**profileの階層を持たない**（地震データは1世代しかないため）。

```text
data/processed/tiles/quake/total.geojson      総合危険度（既定）
data/processed/tiles/quake/building.geojson   建物倒壊危険度
data/processed/tiles/quake/fire.geojson       火災危険度
```

`total.geojson` は約4.6MB ある。フロントは一度読んだものをメモリに持つ（`useVector`）。

## 凡例の出所

⚠️ **凡例はAPIが配る。** 色とラベルの単一の出所は
`backend/prep/hazard_sources/quake/source.py` の `PALETTE` / `RANK_LABEL` /
`legend_items()` で、地図の塗り（`export.py`）と `/api/hazards` の凡例が
**同じ表を読む**。フロントにもGeoJSONにも書き写さない。

| 出口 | 係数（`cost_factor`） |
|---|---|
| `/api/hazards` の `hazards[].legend` | **載せない**（画面に出さない値なので配らない） |
| GeoJSON に同梱される `legend` | 載せる（生成時点で何に効いていたかの記録） |

⚠️ GeoJSON に残る `cost_factor` は**生成時点の値**である。係数を変えて
グラフを焼き直しても、GeoJSONを作り直さない限り古い値のまま残る。

## R2への配信

R2のキーは `quake/{scenario}.geojson`。浸水と違い **profileを含まない。**

```text
quake/total.geojson
quake/building.geojson
quake/fire.geojson
```

アップロードは浸水タイルと同じスクリプトがまとめて行う。手順と件数の検証は
[浸水データの入力と再生成](flood-data.md#r2タイル)を参照する。

## 変更したときの再生成範囲

| 変えたもの | 作り直すもの |
|---|---|
| 公式SHP（データ更新） | ① → ② → グラフ（③）→ NPZ・プリセット |
| `PALETTE` / `RANK_LABEL`（色・呼び名） | ②のみ。APIの凡例は再起動で反映される |
| `QUAKE_COST` / `QUAKE_COVERAGE_PENALTY`（係数） | **グラフ（③）→ NPZ・プリセット。**②は表示に影響しないが、GeoJSONの`legend`に古い係数が残る |
| `source.py` の `COLUMNS`（列の対応） | ① → ② → グラフ（③） |

係数を変えたときの落とし穴（コードを直しただけでは経路が変わらない）は
[ローカル実行・検証runbook](../local-runbook.md#5-6-重みコスト表を変えたとき)を参照する。
