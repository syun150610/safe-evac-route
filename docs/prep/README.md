# 前処理・runtime成果物の全体像

## この文書の目的

ハザードデータの一次入力から、画面表示・プリセット・任意地点探索で使う成果物までの
関係を示す。実際のコマンドは [ローカル実行・検証runbook](../local-runbook.md)、
[一次データの取得](raw-data.md)、[浸水データの入力と再生成](flood-data.md)を参照する。

## 先に結論

通常のAPI起動に前処理（`backend/prep/`）の再実行は不要である。

- NPZグラフとプリセットJSONは `backend/graph/`、`backend/bundles/` に追跡済み
- Dockerイメージにも上の2ディレクトリを同梱する
- rawと再生成可能なprocessedの実データはGitに入れない
- `data/`配下は実ディレクトリとして使い、symlinkは使わない
- ローカルで浸水・地震レイヤーまで表示するときだけ `data/processed/tiles/` が必要
- 本番の表示タイルはContainerではなくR2から配信する

したがって、clone直後でもAPI・プリセット・任意地点探索は動かせる。表示タイルの
ローカル確認または成果物の再生成を行う人だけが、raw・processedを用意する。

## データフロー

```text
東京都建設局 浸水CSV ─ scenario定義 ─ 格子再構成 ─┬─ PNGタイル ── R2
                                                  └─ 浸水値 ───────┐
東京都 地域危険度SHP ─ GPKG正規化 ──────────────── 地震ランク ────┤
OpenStreetMap（Geofabrik関東pbf）─ osmium ─ walkフィルタ ─ 道路グラフ ──┤
                                                                    ▼
                                                          前処理pickleグラフ
                                                             ├─ 圧縮NPZ ── 任意地点探索
                                                             └─ 37 JSON ── プリセットAPI
```

タイルと道路グラフは同じ浸水格子処理を使う。表示と探索で別々に値を解釈しない。

## 一次入力

| 種類 | ローカル配置 | 用途 |
|---|---|---|
| 東京都建設局 浸水予想区域図CSV | `data/raw/tokyoto_kensetsukyoku/` | 浸水格子、タイル、道路エッジ属性 |
| 東京都 第9回地域危険度SHP | `data/raw/tokyoto_toshiseibikyoku/all2.zip` | 地震の公式一次入力 |
| 正規化した地域危険度GPKG | `data/raw/hazard/hazard.gpkg` | 地震危険度の道路エッジ属性 |
| OpenStreetMap道路網（新スコープ） | Geofabrik関東pbf → `data/processed/graph_build/` | 本番の歩行者道路グラフ |
| OpenStreetMap道路網（旧スコープ） | OSMnxのOverpass取得・`data/cache/` | 北千住〜上野の旧グラフ |

一次入力の取得とSHPからGPKGへの変換は[一次データの取得](raw-data.md)を参照する。
現在の3シナリオと建設局CSVの対応は
`backend/prep/hazard_sources/flood/scenarios.py`を単一の出所とする。詳細は
[浸水データの入力と再生成](flood-data.md)に記載している。

## 生成物と配置

| 成果物 | 生成・検証時の配置 | 本番runtime | Git |
|---|---|---|---|
| 浸水PNG | `data/processed/tiles/flood/{profile}/` | R2 `flood/{profile}/` | 対象外 |
| 地震GeoJSON | `data/processed/tiles/quake/` | R2 `quake/` | 対象外 |
| 前処理pickle（旧スコープ） | `data/processed/graph/{profile-id}/{scope}/` | 使用しない | 対象外 |
| OSM中間物・新スコープpickle | `data/processed/graph_build/`（約2.7GB） | 使用しない | 対象外 |
| 圧縮NPZ | `data/processed/runtime_graph/{profile-id}/{scope}/` | `backend/graph/{profile-id}/{scope}/` | 追跡 |
| プリセット | `data/processed/bundles/{profile-id}/{scope}/` | `backend/bundles/{profile-id}/{scope}/` | 追跡 |

`data/`は標準ディレクトリを示す`.gitkeep`だけをGitで追跡し、raw・processed・cacheの
実データはGit管理外とする。別の場所へのsymlinkは使わず、一次データをコピーまたは取得し、
成果物を実ディレクトリへ生成する。生成後に本番採用するNPZとプリセットだけを、数値検証後に
runtimeディレクトリへ明示的に追加する。

## データprofileと探索範囲

| 設定値 | runtime識別子 | 浸水入力 |
|---|---|---|
| `gesuido` | `flood-gesuido_quake-risk9` | 旧・下水道局世代 |
| `kensetsu` | `flood-kensetsu_quake-risk9` | 新・建設局世代 |

地震は両profileとも第9回地域危険度である。**探索範囲はprofileごとに異なる。**

| profile | 探索範囲 | 規模 |
|---|---|---|
| `kensetsu` | `scope-tokyo-23ku-tama-shigaika`（23区＋多摩の市街化区域 1,324.85 km²） | 652,828ノード / 1,905,380エッジ |
| `gesuido` | `scope-kitasenju-ueno`（北千住駅～上野駅のbbox＋片側1km、26.7 km²） | 27,144ノード / 82,586エッジ |

本番が使うのは `kensetsu` ＝新スコープである（`app/core/config.py` の
`RUNTIME_SCOPE_DIR`）。島嶼部・山間部・非市街化区域は範囲外で、東京都全域ではない。

⚠️ `gesuido` には新スコープの成果物が無いため、いまはprofileを切り替えても
旧世代へ戻せない（`/api/evac-routes/presets` が503になる）。

`HAZARD_DATA_PROFILE`の1設定から、次を同時に選ぶ。

- プリセットJSON
- 任意地点探索NPZ
- `/api/hazards`が返す浸水タイルURL
- 任意地点探索レスポンスの浸水タイルURL

本番は `worker/wrangler.jsonc` の値をWorkerがContainerへ渡す。FastAPI単体起動では
`backend/.env` またはプロセス環境変数から読む。グラフをプロセス内にキャッシュするため、
profile変更後はAPIまたはContainerを再起動する。

## 実行方式ごとのデータ境界

| 実行方式 | NPZ・プリセット | 表示タイル | 確認できること |
|---|---|---|---|
| `uvicorn`直起動 | Git追跡済みruntime | `data/processed/tiles/` | チームメンバーの通常開発 |
| Docker単体 | イメージ同梱 | ホストをread-only mount | 本番Containerに近いAPIとローカル画面 |
| `wrangler dev` | ローカルContainer | 空のローカルR2が既定 | Worker・Assets・Bindings・Containerの結合 |
| 本番 | Cloudflare Container | 本番R2 | 公開環境 |

`wrangler dev`は本番R2へ自動接続しない。ローカルR2は空で開始するため、タイル未投入時の
404はAPIやContainerの故障ではない。画面のタイルまで素早く確認する場合は、uvicorn直起動
またはDockerのread-only mountを使う。

## 重み・コスト表を変える場合

浸水深と地域危険度ランクの係数はエッジ属性へ焼き込んである。コードを直しただけでは
探索結果は変わらず、焼き直しと読み込み先の指定が要る。手順と落とし穴は
[ローカル実行・検証runbook](../local-runbook.md#重みコスト表を変えたときの確認)にまとめた。

## 変更時に守る不変条件

- 素のHTML提出版は変更しない
- raw・processedをGitへ追加しない
- タイルとグラフを同じ格子処理から生成する
- 0mと想定範囲外を区別する
- 移動と数値変更を同じコミットに混ぜない
- NPZはpickleと全12 OD・全ハザード条件で比較する
  （⚠️ 新スコープのNPZはこの検証を通していない。`docs/dev/07_課題と作業計画.md` の P0-6）
- プリセット36件は選択中の静的JSONとバイト一致させる
- R2キーにprofileを含め、旧新のキャッシュを混在させない
