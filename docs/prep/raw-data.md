# 一次データの取得

## 目的と置き場

前処理に必要な東京都オープンデータを、チームメンバーが同じURL・ファイル名・配置で
取得できるようにする。rawは容量が大きいためGitへ入れず、各自が次のスクリプトで取得する。

```bash
cd "$(git rev-parse --show-toplevel)"
./scripts/prep/download-raw.sh all
```

役割が異なるため、スクリプトとPython実装は分けている。

```text
scripts/prep/   公式配布元からの取得と、前処理全体の操作入口
backend/prep/   格子化・タイル・グラフなどのPython実装
docs/prep/      データフロー、入力仕様、再生成手順
```

## 取得元とローカル配置

| データ | 公式配布元 | 取得物 | 配置 |
|---|---|---|---|
| 建設局 浸水予想区域図 | [東京都オープンデータカタログ](https://catalog.data.metro.tokyo.lg.jp/dataset/t000014d0000000029) | CSV 17件 | `data/raw/tokyoto_kensetsukyoku/` |
| 都市整備局 第9回地域危険度 | [東京都オープンデータカタログ](https://catalog.data.metro.tokyo.lg.jp/dataset/t000008d0000000012) | `all2.zip`（SHP） | `data/raw/tokyoto_toshiseibikyoku/` |

浸水CSVは17件をすべて取得する。現行の3シナリオが直接使うのは隅田川、神田川、
中川・綾瀬川、江東内部河川だが、今後の東京都全域対応でも取得手順を変えずに済むためである。

地震は `all2.csv` ではなく `all2.zip` を使う。CSVはランク等の属性表だけで町丁目の
ポリゴンを含まないため、経路への空間的な焼き込みや地図表示に必要なGPKGを単独では
生成できない。SHPは同じ公式データセットが配布している。

## 種類を絞って取得する

```bash
# 浸水CSV 17件のみ
./scripts/prep/download-raw.sh flood

# 地震SHPのみ
./scripts/prep/download-raw.sh quake
```

既存の空でないファイルは既定でスキップする。通信失敗時は完成ファイルへ置き換えず、
ダウンロードしたZIPは破損検査、CSVは空ファイル・HTML応答の簡易検査を行う。
配布元から明示的に取り直す場合だけ `--force` を付ける。

```bash
./scripts/prep/download-raw.sh all --force
```

## 地震SHPをGPKGへ正規化する

下流の前処理は `data/raw/hazard/hazard.gpkg` を共通入力として使う。公式SHPを取得した後、
prep依存を入れて変換する。

```bash
cd "$(git rev-parse --show-toplevel)/backend"
uv sync --frozen --group prep
uv run --frozen --group prep python -m prep.hazard_sources.quake.build
```

既存GPKGがある場合は上書きせず終了する。公式SHPから作り直すことを確認した場合だけ
`--force` を付ける。

```bash
uv run --frozen --group prep python -m prep.hazard_sources.quake.build --force
```

変換時に次を機械検証し、一致しなければGPKGを採用しない。

- 5,192町丁目、51市区町村
- 足立区269件、うち総合ランク5が16件
- 荒川区52件、世田谷区277件
- 荒川区「荒川１丁目」の総合ランクが4
- 出力CRSがEPSG:4326

2026-08-20に公式 `all2.zip` から生成したGPKGは、従来の検証済みGPKGと全属性値・形状が
一致した。GeoPackage自体のバイト列はメタデータ等で変わり得るため、バイト一致ではなく
レコード、属性、形状で比較する。

## raw取得後の次工程

現行3シナリオのタイル、グラフ、NPZ、プリセットを再生成する場合は
[浸水データの入力と再生成](flood-data.md#探索範囲は2つある)へ進む。
通常のAPI起動だけなら、Git追跡済みのNPZとプリセットを使うためraw取得は不要である。
