# ローカル実行・検証runbook

## 目的

次の3方式を、用途を混同せずに起動・確認する。

1. uvicorn直起動: チームメンバーの通常ローカル開発
2. Docker単体: 本番Containerに近いバックエンド確認
3. Wrangler: Worker・Static Assets・Bindings・Containerの結合確認

データ構造は [前処理・runtime成果物の全体像](prep/README.md) を参照する。

## 前提

- Node.js 24（`.node-version`）
- Python 3.14（`.python-version`）
- uv
- Docker EngineまたはDocker Desktop
- `safe-evac-route` の作業ツリー内でコマンドを実行すること

この文書では、clone先の絶対パスを固定せず、Gitが返すリポジトリルートから移動する。
したがって、リポジトリ内のどのディレクトリからコードブロックを実行してもよい。

初回だけ依存関係を復元する。

```bash
cd "$(git rev-parse --show-toplevel)/backend"
uv sync --frozen

cd ../frontend
npm ci

cd ../worker
npm ci
```

通常起動ではrawデータと前処理pickleは不要である。NPZとプリセットはGitから取得できる。

## profileの選び方

- `kensetsu`: 新・建設局世代。現在の既定値
- `gesuido`: 旧・下水道局世代。ロールバック・比較検証用

profileを変えた後は、起動中のAPIまたはContainerを再起動する。

## A. uvicorn直起動

### バックエンド

```bash
cd "$(git rev-parse --show-toplevel)/backend"
test -f .env || cp .env.example .env
HAZARD_DATA_PROFILE=kensetsu uv run --frozen uvicorn app.main:app --host 127.0.0.1 --port 8000
```

`.env`の `HAZARD_DATA_PROFILE` を変更してもよい。コマンド先頭の環境変数が優先される。

### フロントエンド

別ターミナルで起動する。

```bash
cd "$(git rev-parse --show-toplevel)/frontend"
API_TARGET=http://127.0.0.1:8000 npm run dev -- --strictPort
```

- MapLibre: <http://localhost:5173/?platform=maplibre>
- Google Maps: <http://localhost:5173/>。`frontend/.env.local` のAPIキーが必要

`--strictPort`は、5173番が別のViteで使用中なら起動を失敗させる。Vite既定の自動的な
ポート繰り上げを許すと、runbookのURLから別の古いフロントを開いても気づきにくいため、
再現確認では使用しない。既存プロセスを止められない場合は、バックエンドとフロントの
ポートを明示的に変更し、Viteが表示した`Local`のURLを開く。

fresh cloneで前処理を実行していない場合の正常な表示は次のとおり。

- プリセットの地点組・シナリオ・経路一覧と、地図上の経路が表示される
- 「地点を指定」で浸水・地震を選び、任意地点探索を実行できる
- MapLibreでは地理院の背景地図が表示される
- 浸水ラスタは`/tiles/flood/.../*.png`、地震ベクターは`/tiles/quake/*.geojson`が404になり、
  ハザードレイヤーは表示されない

`data/processed/tiles/`がある端末では、FastAPIが `/tiles/*` も配信する。fresh cloneで
このディレクトリがない場合も、プリセットと任意地点探索は動くが、浸水・地震レイヤーは
404になる。タイルを確認する人は、チームで共有した生成物を配置するか前処理を実行する。

## B. Docker単体

### API・探索だけを確認する

リポジトリ直下で実行する。

```bash
cd "$(git rev-parse --show-toplevel)"
docker build \
  --tag safe-evac-route-backend:local \
  --file backend/Dockerfile \
  backend

docker run --rm \
  --publish 8000:8000 \
  --env HAZARD_DATA_PROFILE=kensetsu \
  safe-evac-route-backend:local
```

NPZとプリセットはイメージへ同梱されるため、`data/`なしでもAPIと任意地点探索が動く。
`Uvicorn running on http://0.0.0.0:8000`まで表示されればContainerの起動は成功している。
そのターミナルは止めず、別ターミナルから[共通スモークテスト](#共通スモークテスト)を
実行する。表示用成果物をmountしていないため、タイル確認だけは404が正常である。

### Dockerバックエンド＋npmフロントで表示タイルも確認する

これは「バックエンドは本番Containerに近いDocker、フロントはHMRが使える
`npm run dev`」という組み合わせである。この表示確認は任意であり、通常のAPI・探索開発に
必要な手順ではない。

fresh cloneには表示用成果物がない。浸水・地震レイヤーも確認したい場合だけ、先に
[表示タイルだけ必要な場合](prep/flood-data.md#表示タイルだけ必要な場合)の手順で公式rawを
取得し、`data/processed/tiles/`を生成する。生成後、ホストの成果物を読み取り専用で
Containerへマウントする。

ターミナル1でバックエンドを起動する。

```bash
cd "$(git rev-parse --show-toplevel)"
TASK_TILES_DIR="$(pwd)/data/processed/tiles"
if test -f "$TASK_TILES_DIR/quake/total.geojson" && \
   test -d "$TASK_TILES_DIR/flood/kensetsu/envelope"; then
  docker run --rm \
    --publish 8000:8000 \
    --env HAZARD_DATA_PROFILE=kensetsu \
    --env TILES_DIR=/tiles-data \
    --mount type=bind,src="$TASK_TILES_DIR",dst=/tiles-data,readonly \
    safe-evac-route-backend:local
else
  echo "表示用成果物がありません。任意のタイル生成手順を先に実行してください。" >&2
fi
```

ターミナル2でフロントを起動する。

```bash
cd "$(git rev-parse --show-toplevel)/frontend"
API_TARGET=http://127.0.0.1:8000 npm run dev -- --strictPort
```

上のmount構文はLinux・macOS・WSL向けである。Windows PowerShellからDockerを直接使う
場合は、`src`をWindowsの絶対パスへ置き換える。

## C. Worker・Container結合確認

Cloudflareのローカル構成をまとめて起動する。

```bash
cd "$(git rev-parse --show-toplevel)/worker"
npm run dev
```

`predev`がReactをbuildし、WranglerがWorker、Static Assets、ローカルD1/R2、
FastAPI Containerを起動する。初回はContainer補助イメージの取得で時間がかかる。

- アプリ: <http://localhost:8787/>
- API: <http://localhost:8787/api/health>
- D1: <http://localhost:8787/api/health/d1>
- R2: <http://localhost:8787/api/health/r2>

WranglerのローカルR2は本番R2と別で、初期状態は空である。そのため `/tiles/*` が404でも、
Static Assets・API・Container・Bindingsの結合確認は成功し得る。タイルを含む画面確認は
AまたはBを使う。本番Containerを含むため `wrangler dev --remote` は使わない。

参考:

- [Cloudflare Containersのローカル開発](https://developers.cloudflare.com/containers/local-dev/)
- [Workersローカル環境へのデータ追加](https://developers.cloudflare.com/workers/local-development/local-data/)
- [開発方式ごとのBinding対応](https://developers.cloudflare.com/workers/local-development/bindings-per-env/)

## 共通スモークテスト

以下はポート8000のuvicornまたはDockerに対する例である。Wranglerの場合は8000を8787へ
置き換える。ただしタイル確認は、上記のとおりローカルR2の状態に依存する。

```bash
curl --fail --silent --show-error \
  http://127.0.0.1:8000/api/health

curl --fail --silent --show-error --dump-header - --output /dev/null \
  http://127.0.0.1:8000/api/evac-routes/presets

curl --fail --silent --show-error \
  http://127.0.0.1:8000/api/hazards

curl --fail --silent --show-error --head \
  http://127.0.0.1:8000/tiles/flood/kensetsu/envelope/12/3635/1611.png

curl --fail --silent --show-error \
  --header 'content-type: application/json' \
  --data '{
    "origin":{"lat":35.7497,"lon":139.8050,"label":"北千住駅"},
    "dest":{"lat":35.7141,"lon":139.7774,"label":"上野駅"},
    "hazards":{"flood":"envelope","quake":"total"},
    "include":["baseline","selected"]
  }' \
  http://127.0.0.1:8000/api/evac-routes/search
```

確認点:

- `/api/hazards` の `data_profile` が起動設定と一致する
- プリセット応答ヘッダー `X-Hazard-Data-Profile` が同じprofileを示す
- タイルURLにも `/flood/{profile}/` が含まれる
- 検索結果の `data_profile` と `selected_route` が期待どおり

## 前処理を実行する場合

初回cloneした全員が前処理する必要はない。必要範囲は目的によって異なる。

| 目的 | raw・processed | 完全再生成 |
|---|---|---|
| 通常のフロント・API・任意地点探索開発 | 不要 | 不要 |
| ローカルで浸水・地震レイヤーも表示 | `data/processed/tiles/`のみ必要 | 不要 |
| raw・シナリオ・格子処理・重み・探索範囲を変更 | 必要 | 必要 |
| 本番採用するタイル・NPZ・プリセットを更新 | 必要 | 必要 |

表示確認だけなら、チームで共有した `data/processed/tiles/` を配置するのが最短である。
自分でタイルを再現する場合は[一次データの取得](prep/raw-data.md)と
[浸水データの入力と再生成](prep/flood-data.md)の「表示タイルだけ必要な場合」を使う。

完全再生成は、データ入力や計算処理を変更した担当者が、タイル・pickle・NPZ・
プリセットの整合性を確認するときに行う。

```bash
cd "$(git rev-parse --show-toplevel)/backend"
uv sync --frozen --group prep
```

次のrawが必要になる。取得・地震GPKG変換は
[一次データの取得](prep/raw-data.md)を参照する。

```text
data/raw/tokyoto_kensetsukyoku/*.csv
data/raw/hazard/hazard.gpkg
```

3シナリオを既存成果物と別の場所へ生成する完全なコマンドは、データ成果物の更新担当が
[浸水データの入力と再生成](prep/flood-data.md#既存成果物を上書きしない再生成)を使う。
生成後は最低限、次を確認する。

```bash
cd "$(git rev-parse --show-toplevel)/backend"
uv run --frozen ruff check .
uv run --frozen ruff format --check .
uv run --frozen pytest

cd ../worker
npm run tiles:upload -- /absolute/path/to/data/processed/tiles --check
```

`--check`は4,985件と公開キーだけを検証し、R2へ書き込まない。`--check`を外す操作は
本番R2を書き換えるため、レビューと実行許可の後に行う。

## よくある症状

| 症状 | 主な原因 | 確認 |
|---|---|---|
| uvicornが`address already in use`で終了 | 別プロセスが8000番を使用中 | 使用中のAPIを止めるか、uvicornと`API_TARGET`を同じ別ポートへ変更 |
| Viteが`Port 5173 is in use`で終了 | 別のフロントが5173番を使用中 | 使用中のViteを止めるか、`--port`で別ポートを明示してそのURLを開く |
| プリセットAPIが503 | 古いブランチ、profile成果物なし、Docker build context違い | `backend/bundles/{profile-id}/{scope}/index.json` |
| 任意地点探索が503 | 選択profileのNPZなし | `backend/graph/{profile-id}/{scope}/*.npz` |
| uvicornでタイル404 | `data/processed/tiles/`なし、profile名不一致 | `TILES_DIR`とタイル配置 |
| Dockerでタイル404 | mountまたは`TILES_DIR`なし | Dockerの`--mount`と環境変数 |
| Wranglerでタイル404 | ローカルR2が空 | API故障と混同しない。A/Bで画面確認 |
| profile変更が反映されない | 起動済みグラフのメモリキャッシュ | API・Containerを再起動 |
| Google地図だけ表示できない | ローカルAPIキーなし | MapLibreを使うか`.env.local`を設定 |

## 本番反映前の境界

ローカル確認は本番R2・本番Workerを変更しない。本番反映では次を別々に確認する。

1. profile付きR2キー4,985件をアップロード
2. `worker/wrangler.jsonc` の `HAZARD_DATA_PROFILE` を確認
3. mainへのマージ後、GitHub ActionsのDeploy成功を確認
4. 公開URLでStatic Assets、API、プリセット、任意地点探索、浸水・地震タイルを確認
5. Google・MapLibreとスマホ表示を実機確認
