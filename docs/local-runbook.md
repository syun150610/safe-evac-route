# ローカル実行・検証runbook

## この文書の使い方

**自分がどれかを先に決める。** 上から順に読む文書ではない。

| あなたの状況 | 読むところ |
|---|---|
| clone したばかり | [0. 初回セットアップ](#0-初回セットアップclean-clone-の人は必ず全部) → [1. いちばん短い起動](#1-いちばん短い起動uvicorn--vite) |
| 前は動いていたのに動かない | [5. 途中から来た人へ](#5-途中から来た人へ状態別) |
| 本番Containerに近い形で見たい | [2. Docker](#2-docker-で本番containerに近づける) |
| Worker・D1・R2の結合を見たい | [3. Wrangler](#3-wrangler-で結合確認workerd1r2container) |
| ハザードのデータを作り直したい | [前処理・runtime成果物の全体像](prep/README.md) |

データ構造の全体像は [前処理・runtime成果物の全体像](prep/README.md)、
DBの操作は [データベース](database.md) にある。

## 前提

### 必須（全員）

- Node.js 24（`.node-version`）
- Python 3.14（`.python-version`）
- uv
- `safe-evac-route` の作業ツリー内でコマンドを実行すること

この文書では clone 先の絶対パスを固定せず、Gitが返すリポジトリルートから移動する。
リポジトリ内のどのディレクトリからコードブロックを実行してもよい。

### 追加で要るもの

| やること | 追加で必要 |
|---|---|
| [2. Docker](#2-docker-で本番containerに近づける) / [3. Wrangler](#3-wrangler-で結合確認workerd1r2container) | Docker EngineまたはDocker Desktop |
| ハザードレイヤーの表示 | 生成済みタイル、または[前処理](prep/README.md)の実行 |
| Google地図 | `frontend/.env.local` の `VITE_GOOGLE_MAPS_API_KEY`（[取得手順](google-maps-api-key.md)） |

**rawデータと前処理pickleは通常不要。** NPZとプリセットはGitに入っている。

## 0. 初回セットアップ（clean clone の人は必ず全部）

⚠️ **3つとも必須。** 認証機能を使わない人も飛ばせない。0-2 を飛ばすと
`/api/health` すら起動しない。

### 0-1. 依存を復元する

```bash
cd "$(git rev-parse --show-toplevel)/backend"
uv sync --frozen

cd ../frontend
npm ci

cd ../worker
npm ci
```

### 0-2. backend/.env を作る（認証を使わなくても必須）

⚠️ **すでに `.env` がある人は、先に[0-2b](#0-2b-すでに-env-がある人設定が古いと-name-or-service-not-known-になる)を見ること。**
下のコマンドは `.env` があれば何もしないので、**古い値がそのまま残る。**

`JWT_SECRET_KEY` は**デフォルトが無い必須設定**である。未設定だと
`app/main.py` の読み込み時点で `ValidationError` になり、uvicornが起動しない。

**このブロックをそのまま貼れば終わる。** エディタで開いて書き換える必要はない。

```bash
cd "$(git rev-parse --show-toplevel)/backend"
test -f .env || cp .env.example .env
uv run --frozen python - <<'SETKEY'
import pathlib, re, secrets

env = pathlib.Path(".env")
text = env.read_text(encoding="utf-8")
if re.search(r"^JWT_SECRET_KEY=.+$", text, re.M):
    print("JWT_SECRET_KEY は設定済み。変更しない")
else:
    key = secrets.token_hex(32)
    text, n = re.subn(r"^JWT_SECRET_KEY=.*$", f"JWT_SECRET_KEY={key}", text, count=1, flags=re.M)
    if n == 0:  # 行ごと無い古い .env の場合は足す
        text = text.rstrip("\n") + f"\nJWT_SECRET_KEY={key}\n"
    env.write_text(text, encoding="utf-8")
    print("JWT_SECRET_KEY を書き込んだ")
SETKEY
```

**何度貼っても安全である。** すでに値が入っていれば上書きしないので、貼り直しで
ログイン状態が飛ぶことはない。

⚠️ `sed -i` を使っていないのは、GNU sed と macOS(BSD) sed で `-i` の書式が違い、
片方の環境でしか動かないコマンドになるためである。

⚠️ `python` ではなく `uv run --frozen python` を使う。**Ubuntu・WSLには `python` が無く
（`python3` だけ）、`Command 'python' not found` になる。** uvは前提に入っていて
`.python-version` の3.14を確実に使えるので、こちらへ寄せる。

**チームで値を共有する必要はない。** 各自バラバラでよい。入った値を見るには:

```bash
grep JWT_SECRET_KEY "$(git rev-parse --show-toplevel)/backend/.env"
```

### 0-2b. すでに .env がある人（設定が古いと Name or service not known になる）

`.env` はGit管理外なので、**`.env.example` が変わっても自動では追従しない。**
古い `.env` を使い続けると、起動はするが認証・投稿で次のように落ちる。

```text
httpx.ConnectError: [Errno -2] Name or service not known
```

`D1_GATEWAY_URL` が `http://d1.internal` のままだと起きる。**`d1.internal` は
本番Containerの中からしか到達できない仮想ホスト**で、uvicorn直起動では名前解決できない。
uvicornからはWorkerのプロキシ（`localhost:8787`）を通す。

まずキー名と値の差を見る（値は表示しない）。

```bash
cd "$(git rev-parse --show-toplevel)/backend"
diff <(grep -oE '^[A-Z_]+=' .env.example | sort) <(grep -oE '^[A-Z_]+=' .env | sort) \
  && echo "キー名は一致"
grep -E '^(D1|R2)_GATEWAY_URL=' .env
```

`d1.internal` / `r2.internal` が出たら、次で直す。

```bash
cd "$(git rev-parse --show-toplevel)/backend"
sed -i.bak \
  -e 's|^D1_GATEWAY_URL=.*|D1_GATEWAY_URL=http://localhost:8787/d1|' \
  -e 's|^R2_GATEWAY_URL=.*|R2_GATEWAY_URL=http://localhost:8787/r2|' \
  .env
grep -E '^(D1|R2)_GATEWAY_URL=' .env
```

⚠️ **直したらuvicornを再起動する。** `.env` は起動時にしか読まれない。
元の `.env` は `.env.bak` に残る。

### 0-3. ローカルD1にマイグレーションを適用する

⚠️ **`wrangler dev` を起動しても自動適用されない。** 隔離したstateで実測した結果、
起動直後のテーブルは `_cf_METADATA` だけだった。適用せずに認証・投稿を叩くと
`no such table` で失敗する。

```bash
cd "$(git rev-parse --show-toplevel)/worker"
npm run db:migrate:local
```

Workerを起動している必要はない。詳しくは [データベース](database.md#ローカルd1の操作)。

### 0-4. ここまでの確認（サーバを起動せずに）

```bash
cd "$(git rev-parse --show-toplevel)/backend"
uv run --frozen python -c "from app.core.config import get_settings; print('設定OK', get_settings().hazard_data_profile)"
grep -E '^(D1|R2)_GATEWAY_URL=' .env

cd ../worker
npx wrangler d1 migrations list safe-evac-route-db --local
```

次の3つが揃えば初回セットアップは完了である。

- `設定OK kensetsu`
- `D1_GATEWAY_URL=http://localhost:8787/d1`（`d1.internal` **ではない**）
- `No migrations to apply!`

## profileの選び方

- `kensetsu`: 新・建設局世代。現在の既定値
- `gesuido`: 旧・下水道局世代。ロールバック・比較検証用

profileを変えた後は、起動中のAPIまたはContainerを再起動する。

## 1. いちばん短い起動（uvicorn + Vite）

チームメンバーの通常のローカル開発はこれ。

### 1-1. 起動

認証・投稿を使う場合は、別ターミナルでWorkerを起動してD1/R2を有効にする
（`app` はWorker経由でD1にアクセスする）。地図と経路だけならWorkerは不要。

```bash
cd "$(git rev-parse --show-toplevel)/worker"
npm run dev
```

バックエンドを起動する。

```bash
cd "$(git rev-parse --show-toplevel)/backend"
HAZARD_DATA_PROFILE=kensetsu uv run --frozen uvicorn app.main:app --host 127.0.0.1 --port 8000
```

`.env` の `HAZARD_DATA_PROFILE` を変更してもよい。コマンド先頭の環境変数が優先される。

フロントを起動する。

```bash
cd "$(git rev-parse --show-toplevel)/frontend"
API_TARGET=http://127.0.0.1:8000 npm run dev -- --strictPort
```

- MapLibre: <http://localhost:5173/?platform=maplibre>
- Google Maps: <http://localhost:5173/>。`frontend/.env.local` のAPIキーが必要

`--strictPort` は、5173番が別のViteで使用中なら起動を失敗させる。Vite既定の自動的な
ポート繰り上げを許すと、runbookのURLから別の古いフロントを開いても気づきにくいため、
再現確認では使用しない。既存プロセスを止められない場合は、バックエンドとフロントの
ポートを明示的に変更し、Viteが表示した `Local` のURLを開く。

### 1-2. 動いている状態の見え方

前処理を実行していない fresh clone での正常な表示は次のとおり。

- ログイン画面が出る（新規登録して進む。データはローカルD1に入る）
- プリセットの地点組・シナリオ・経路一覧と、地図上の経路が表示される
- 「地点を指定」で浸水・地震を選び、任意地点探索を実行できる
- MapLibreでは地理院の背景地図が表示される

### 1-3. この時点では動かないもの

- **ハザードレイヤー**: `/tiles/flood/.../*.png` と `/tiles/quake/*.geojson` が404になる。
  `data/processed/tiles/` がある端末では、FastAPIが `/tiles/*` も配信する。
  タイルを見たい人は、チームで共有した生成物を配置するか[前処理](prep/README.md)を実行する

⚠️ **`git worktree` で fresh clone を再現する場合は、worktree側で実行すること。**
`data/` はgitignoreなのでworktreeには作られないが、**本体ツリーでコマンドを実行すると
既存の生成物が見えてしまい**、fresh cloneの見え方にならない。
- **Google地図**: `frontend/.env.local` にAPIキーが無いとエラー表示になる。
  `?platform=maplibre` を付ければキー無しで確認できる

## 2. Docker で本番Containerに近づける

### 2-0. まずビルドする（2-1・2-2 のどちらに進む場合も先に実行）

⚠️ **タグを使い回すので、古いイメージが黙って動く。** `docker run` は成功し、
`/api/health` も200を返すのに、**後から足したエンドポイントだけ404**になる。
`main` を取り込んだら必ずビルドし直すこと。

```bash
cd "$(git rev-parse --show-toplevel)"
docker build \
  --tag safe-evac-route-backend:local \
  --file backend/Dockerfile \
  backend
```

いま手元にあるイメージがいつのものかは、これで分かる。

```bash
docker images safe-evac-route-backend:local --format '作成 {{.CreatedAt}}'
```

### 2-1. APIと探索だけを確認する

リポジトリ直下で実行する。

```bash
cd "$(git rev-parse --show-toplevel)"
docker run --rm \
  --publish 8000:8000 \
  --env HAZARD_DATA_PROFILE=kensetsu \
  --env JWT_SECRET_KEY="$(openssl rand -hex 32)" \
  safe-evac-route-backend:local
```

⚠️ **`JWT_SECRET_KEY` を渡さないとContainerは起動しない。** `backend/.env` は
`.dockerignore` で除外されるので、イメージからは供給されない。ここは使い捨ての値でよい
（ローカルDockerで発行したトークンを別の起動へ引き継ぐ必要がないため）。

NPZとプリセットはイメージへ同梱されるため、`data/`なしでもAPIと任意地点探索が動く。
`Uvicorn running on http://0.0.0.0:8000`まで表示されればContainerの起動は成功している。
そのターミナルは止めず、別ターミナルから[共通スモークテスト](#4-共通スモークテスト)を
実行する。表示用成果物をmountしていないため、タイル確認だけは404が正常である。

### 2-2. 表示タイルも確認する

これは「バックエンドは本番Containerに近いDocker、フロントはHMRが使える
`npm run dev`」という組み合わせである。この表示確認は任意であり、通常のAPI・探索開発に
必要な手順ではない。

⚠️ **[2-0](#2-0-まずビルドする2-12-2-のどちらに進む場合も先に実行)のビルドが前提。**
ここには `docker run` しか無いので、古いイメージが残っているとそれが動く。

> [!IMPORTANT]
> 本手順では、浸水PNGと地震GeoJSONを事前生成しない限りDockerが動作しない。
> 実施する場合は先に[表示タイルだけ必要な場合](prep/flood-data.md#表示タイルだけ必要な場合)の手順で公式rawを
> 取得し、`data/processed/tiles/`を生成しておく。

ターミナル1でバックエンドを起動する。

```bash
cd "$(git rev-parse --show-toplevel)"
TASK_TILES_DIR="$(pwd)/data/processed/tiles"
if test -f "$TASK_TILES_DIR/quake/total.geojson" && \
   test -d "$TASK_TILES_DIR/flood/kensetsu/envelope"; then
  docker run --rm \
    --publish 8000:8000 \
    --env HAZARD_DATA_PROFILE=kensetsu \
    --env JWT_SECRET_KEY="$(openssl rand -hex 32)" \
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

5173番が使用中なら、Viteは意図的に起動を中止する。使用中のフロントを止めない場合は、
空いている番号を`--port`で明示し、同じ番号のURLを開く。たとえば5174番を使う場合:

```bash
API_TARGET=http://127.0.0.1:8000 npm run dev -- --port 5174 --strictPort
```

- MapLibre: <http://localhost:5174/?platform=maplibre>
- Google Maps: <http://localhost:5174/>。`frontend/.env.local`のAPIキーが必要

上のmount構文はLinux・macOS・WSL向けである。Windows PowerShellからDockerを直接使う
場合は、`src`をWindowsの絶対パスへ置き換える。

## 3. Wrangler で結合確認（Worker・D1・R2・Container）

Cloudflareのローカル構成をまとめて起動する。

```bash
cd "$(git rev-parse --show-toplevel)/worker"
npm run dev
```

`predev`がReactをbuildし、WranglerがWorker、Static Assets、ローカルD1/R2、
FastAPI Containerを起動する。

⚠️ **Dockerが要る。** Wranglerは `backend/Dockerfile` を**その場でビルド**してから
Workerを起動する。実測では、キャッシュが無い初回は4分でもビルドが終わらなかった。
2回目以降はレイヤキャッシュが効き、`Ready on http://localhost:8787` まで数十秒で着く。

⚠️ **ローカルD1のマイグレーションは適用されない**（[0-3](#0-3-ローカルd1にマイグレーションを適用する)）。

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

## 4. 共通スモークテスト

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

## 5. 途中から来た人へ（状態別）

前に動かしたことがある人向け。[0. 初回セットアップ](#0-初回セットアップclean-clone-の人は必ず全部)と
内容が重なるが、**ここだけ読んで直せる**ように書いてある。

### 5-1. まず自分の状態を調べる

上から順に実行し、落ちたところが原因である。

```bash
# ① 設定（.env の JWT_SECRET_KEY があるか）
cd "$(git rev-parse --show-toplevel)/backend"
uv run --frozen python -c "from app.core.config import get_settings; print('設定OK', get_settings().hazard_data_profile)"

# ② 本番配布物（NPZとプリセット）
uv run --frozen python -c "
from app.core.config import get_settings; import os
s = get_settings()
for name, d in (('NPZ', s.active_graph_dir), ('プリセット', s.active_bundles_dir)):
    print(name, os.path.isdir(d), d)"

# ③ ローカルD1
cd ../worker
npx wrangler d1 migrations list safe-evac-route-db --local

# ④ 表示タイル（無くても経路は動く）
cd "$(git rev-parse --show-toplevel)"
ls data/processed/tiles/flood 2>/dev/null || echo "タイルなし（ハザードレイヤーは404）"
```

### 5-2. 前は動いていたのに起動しない

| 症状 | 原因 | 対処 |
|---|---|---|
| `ValidationError: jwt_secret_key` | `.env` が無い・鍵が空 | [0-2](#0-2-backendenv-を作る認証を使わなくても必須) |
| `no such table: USERS` | ローカルD1が未適用・作り直した | [0-3](#0-3-ローカルd1にマイグレーションを適用する) |
| `Name or service not known` | `.env` が古い（`d1.internal` のまま） | [0-2b](#0-2b-すでに-env-がある人設定が古いと-name-or-service-not-known-になる) |
| Dockerで `/api/auth/*` だけ404 | イメージが古い | [2-0](#2-0-まずビルドする2-12-2-のどちらに進む場合も先に実行) |
| `/api/evac-routes/presets` が503 | profileの成果物が無い | ①②を確認。ブランチが古い可能性 |
| 任意地点探索が503 | 選択profile・スコープのNPZが無い | ②を確認 |

`main` を取り込んだ直後は、依存が増えていることがある。

```bash
cd "$(git rev-parse --show-toplevel)/backend" && uv sync --frozen
cd ../frontend && npm ci
cd ../worker && npm ci
```

### 5-3. ローカルD1を作り直す

⚠️ ローカルのアカウントと投稿は消える。本番D1には影響しない。

```bash
cd "$(git rev-parse --show-toplevel)/worker"
rm -rf .wrangler/state/v3/d1
npm run db:migrate:local
```

### 5-4. profile・探索範囲を切り替える

どちらも**起動中は切り替わらない**（グラフをプロセス内にキャッシュするため）。
変更したらAPI・Containerを再起動する。

```bash
HAZARD_DATA_PROFILE=gesuido uv run --frozen uvicorn app.main:app --port 8000
```

### 5-5. 前処理が要るかどうか

初回cloneした全員が前処理する必要はない。

| 目的 | raw・processed | 完全再生成 |
|---|---|---|
| 通常のフロント・API・任意地点探索開発 | 不要 | 不要 |
| ローカルで浸水・地震レイヤーも表示 | `data/processed/tiles/`のみ必要 | 不要 |
| raw・シナリオ・格子処理・[重み](#5-6-重みコスト表を変えたとき)・探索範囲を変更 | 必要 | 必要 |
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
[浸水データの入力と再生成](prep/flood-data.md#探索範囲は2つある)を使う。
**探索範囲が2つあり、成果物のファイル名が同じなので、コピー先を必ず確認すること。**
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

### 5-6. 重み・コスト表を変えたとき

`prep/hazard_sources/flood/cost.py` や `prep/hazard_sources/quake/cost.py` の
係数を変えた場合、**コードを直しただけでは経路は変わらない。**

#### なぜ変わらないか

浸水深と地域危険度ランクは、前処理でエッジ属性 `cost_flood` / `cost_quake` へ
**焼き込んである**（決定 D-101）。実行時の `prep/route_search/weights.py` は
その値を読んで `length × Π cost` を計算するだけで、`hazard_cost()` も
`QUAKE_COST` も呼ばない。したがってグラフを焼き直すまで探索結果は変わらない。

⚠️ **`QUAKE_COST` だけは応答にそのまま載る。** `app/services/evac_routes/search.py`
が応答の `quake_cost` フィールドへ実行時に入れているため、**焼き直していなくても
新しい係数が表示される。** ここを見て「反映された」と判断しないこと。
判断は経路そのものと `routes[].stats`（`quake_weighted_avg_rank` /
`quake_r4plus_m` / `ratio_over_03` など）で行う。

実行時に効くもの／焼き直しが要るものは次のとおり。

| 変更箇所 | 探索への反映 |
|---|---|
| `flood/cost.py` の `hazard_cost()` の閾値・係数 | 焼き直しが要る |
| `flood/cost.py` の `COVERAGE_PENALTY` | 焼き直しが要る |
| `quake/cost.py` の `QUAKE_COST` | 焼き直しが要る（応答の `quake_cost` だけ即時に変わる） |
| `quake/cost.py` の `QUAKE_COVERAGE_PENALTY` | 焼き直しが要る |
| `flood/cost.py` の `IMPASSABLE_FINITE` | 再起動だけでよい（実行時に読む） |
| `route_search/weights.py` の掛け合わせ | 再起動だけでよい |

#### 焼き直しコマンドが黙って終了する場合がある

新スコープ用の `prep/route_search/area_graph/bake.py` は、
**出力pickleが既にあると `既にある -> ...` と1行出して正常終了する**
（中断からの再開のための挙動で、上書きフラグは無い）。
係数を変えて焼き直すときは、先に対象を消すこと。

```bash
rm ../data/processed/graph_build/tokyo-23ku-tama-shigaika/area_envelope.pkl   # 焼き直す対象だけ
```

旧スコープの `prep.route_search.graph` にこのスキップは無く、毎回上書きする。

#### 焼き直したNPZをローカルで読ませる

⚠️ **再生成の出力先と、APIが読む場所は別である。**

| | 場所 |
|---|---|
| 再生成の出力先 | `data/processed/graph/`（pickle）、`data/processed/runtime_graph/`（NPZ） |
| APIが読む既定 | `backend/graph/{profile-id}/{scope}/` |

既定が `backend/` 配下なのは意図的である。`data/` はGitにもDockerイメージにも
入らないため、既定をそちらにすると本番Containerで任意地点探索が503になる
（PR #13 以前に実際に起きた）。あわせて、**検証していない焼き直し結果が黙って
本番配布物にならないようにする関門**でもある。

そのため、**`data/processed/` を更新しただけではAPIの結果は変わらない。**
エクスプローラー上でタイムスタンプが新しくなっていても同じである。

まずどちらを読んでいるかを確定させる。

```bash
cd backend
uv run --frozen python -c \
  "from app.services.evac_routes import search as S; import os; print(os.path.abspath(S._graph_file('envelope')))"
```

確認方法は2つある。どちらか一方でよい。

```bash
# 方法1: 焼き直した成果物を読ませる（backend/graph は触らない）
cd backend
GRAPH_DIR=../data/processed/runtime_graph \
BUNDLES_DIR=../data/processed/bundles \
uv run --frozen uvicorn app.main:app --reload
```

```bash
# 方法2: 数値を確認したうえで本番配布物として採用する
cd backend
cp ../data/processed/runtime_graph/{profile-id}/{scope}/*.npz \
   graph/{profile-id}/{scope}/
```

どちらの場合も**APIの再起動が要る**。グラフはプロセス内にキャッシュされ、
`--reload` はコード変更では効くがNPZの差し替えは検知しない。

#### 確認する対象

- **任意地点探索（`POST /api/evac-routes/search`）で見る。**
  プリセット（初期表示と12OD）は静的JSONをバイト列のまま返す契約なので、
  `prep.route_search.bundles` を再実行するまで絶対に変わらない。
- ブラウザの強制リロードでは変わらない。応答はAPIが返している。

## 6. よくある症状

| 症状 | 主な原因 | 確認 |
|---|---|---|
| uvicornが`address already in use`で終了 | 別プロセスが8000番を使用中 | 使用中のAPIを止めるか、uvicornと`API_TARGET`を同じ別ポートへ変更 |
| Viteが`Port 5173 is in use`で終了 | 別のフロントが5173番を使用中 | 使用中のViteを止めるか、`--port`で別ポートを明示してそのURLを開く |
| プリセットAPIが503 | 古いブランチ、profile成果物なし、Docker build context違い | `backend/bundles/{profile-id}/{scope}/index.json` |
| 任意地点探索が503 | 選択profileのNPZなし | `backend/graph/{profile-id}/{scope}/*.npz` |
| uvicornでタイル404 | `data/processed/tiles/`なし、profile名不一致 | `TILES_DIR`とタイル配置 |
| Dockerでタイル404 | mountまたは`TILES_DIR`なし | Dockerの`--mount`と環境変数 |
| Wranglerでタイル404 | ローカルR2が空 | API故障と混同しない。1/2で画面確認 |
| **Dockerで一部のエンドポイントだけ404**（`/api/health` は200なのに `/api/auth/*` が404） | イメージが古い。タグを使い回すので黙って前のコードが動く | `docker images safe-evac-route-backend:local --format '{{.CreatedAt}}'` で作成日時を見て、[2-0](#2-0-まずビルドする2-12-2-のどちらに進む場合も先に実行)で再ビルド |
| `Name or service not known`（認証・投稿） | `.env` の `D1_GATEWAY_URL` が `d1.internal` のまま。本番Container用の値で、uvicornからは解決できない | [0-2b](#0-2b-すでに-env-がある人設定が古いと-name-or-service-not-known-になる) |
| 認証・投稿が `Connection refused` | Workerが起動していない（uvicornはWorker経由でD1へ行く） | 別ターミナルで `cd worker && npm run dev` |
| profile変更が反映されない | 起動済みグラフのメモリキャッシュ | API・Containerを再起動 |
| 重み・コスト表の変更が反映されない | コスト値はグラフへ焼き込み済み。または焼き直したNPZが `data/processed/` にあり、APIは `backend/graph/` を読んでいる | 上の「5-6. 重み・コスト表を変えたとき」 |
| 応答の `quake_cost` だけ新しい値になる | `QUAKE_COST` は実行時に応答へ載るが、経路は焼き込み済みの `cost_quake` を使う | 同上。経路と `routes[].stats` で判断する |
| Google地図だけ表示できない | ローカルAPIキーなし | MapLibreを使うか`.env.local`を設定 |

## 7. 本番反映前の境界

ローカル確認は本番R2・本番Workerを変更しない。本番反映では次を別々に確認する。

1. profile付きR2キー4,985件をアップロード
2. `worker/wrangler.jsonc` の `HAZARD_DATA_PROFILE` を確認
3. mainへのマージ後、GitHub ActionsのDeploy成功を確認
4. 公開URLでStatic Assets、API、プリセット、任意地点探索、浸水・地震タイルを確認
5. Google・MapLibreとスマホ表示を実機確認
