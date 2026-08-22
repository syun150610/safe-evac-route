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

浸水CSVは17件をすべて取得する。`envelope` が使うのは2026-08-21時点で10件、
単一河川シナリオが2件で、残りは不採用または未使用である。採否と理由は
`backend/prep/hazard_sources/flood/scenarios.py` を単一の出所とする。
17件すべて取るのは、シナリオの入力が変わっても取得手順を変えずに済むためである。

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

## 取得のあとにすること

取得しただけでは前処理に使えないものがある。

| データ | 取得後に必要な変換 | 手順 |
|---|---|---|
| 建設局 浸水CSV | 不要（そのまま読む） | [浸水データ](flood-data.md) |
| 地域危険度SHP | **`data/raw/hazard/hazard.gpkg` へ正規化が要る** | [地震データ](quake-data.md) |

⚠️ 地震は正規化しないと下流が動かない。下流の前処理はすべて `hazard.gpkg` を
共通入力として使う。

## raw取得後の次工程

- 浸水のタイル・グラフ・NPZ・プリセット → [浸水データ](flood-data.md)
- 地震のGPKG正規化・GeoJSON → [地震データ](quake-data.md)
- 全体の流れと、どこまで必要か → [前処理・runtime成果物の全体像](README.md)

通常のAPI起動だけならGit追跡済みのNPZとプリセットを使うためraw取得は不要である。
