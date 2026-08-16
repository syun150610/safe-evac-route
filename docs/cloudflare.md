# Cloudflare 解説・デプロイ手順書

## 構成概要

```
ユーザーのブラウザ
    │
    ├─→ Cloudflare Pages（React 静的ファイル）
    │       URL: https://saigai-map.pages.dev
    │
    └─→ Cloudflare Containers（FastAPI + Uvicorn）
            URL: https://saigai-map-api.tokyo-odh-150.workers.dev
                    │
                    ├─→ D1 or SQLite（DB）
                    └─→ R2（画像等のファイル保存）
```

- **Cloudflare Pages**: フロントエンド（React）のホスティングサービス。静的ファイルを配信する。
- **Cloudflare Containers**: Docker コンテナを Cloudflare 上で動かすサービス。FastAPI バックエンドをここで動かす。
- **Cloudflare Worker**: ブラウザからのリクエストを受け取り、Container にプロキシする薄いレイヤー（`worker/src/index.ts`）。

---

## 前提条件

| ツール | 確認コマンド |
|---|---|
| Node.js | `node --version` |
| npm | `npm --version` |
| Docker Desktop | 起動済みであること |
| wrangler | `npx wrangler --version`（都度 npx で実行するため個別インストール不要）|

---

## 重要：アカウントについて

**必ずハッカソン配布アカウントでログインすること。**

個人の Cloudflare アカウントは無料プランのため Containers が使えず、以下のエラーが発生する：

```
Unauthorized: You do not have access to Cloudflare Containers.
Deploying containers requires the Workers Paid plan.
```

ハッカソン配布アカウント（`tokyo_odh_150`）は Paid プラン相当で Containers が利用可能（事務局確認済み）。

---

## 初回セットアップ

### 1. wrangler にログイン

```bash
npx wrangler login
```

ブラウザが開くので、**ハッカソン配布アカウント**でログインする。

### 2. ログインアカウントの確認

```bash
npx wrangler whoami
```

`tokyo_odh_150` と表示されれば OK。個人アカウントになっていたらログアウトして再ログイン。

```bash
npx wrangler logout
npx wrangler login
```

### 3. Docker Desktop を起動

Containers のデプロイ時にローカルで Docker ビルドが走るため、Docker Desktop を起動しておく必要がある。

---

## バックエンドのデプロイ（Cloudflare Containers）

```bash
cd worker
npm install
npx wrangler deploy
```

成功すると以下のように表示される：

```
Deployed saigai-map-api triggers
  https://saigai-map-api.tokyo-odh-150.workers.dev
```

### 動作確認

```bash
curl https://saigai-map-api.tokyo-odh-150.workers.dev/health
# → {"status":"ok"}
```

---

## フロントエンドのデプロイ（Cloudflare Pages）

```bash
cd frontend
npm run build
npx wrangler pages deploy dist --project-name saigai-map
```

成功すると URL が発行される：

```
https://{hash}.saigai-map.pages.dev  # デプロイごとに変わる
https://saigai-map.pages.dev         # 固定URL（こちらを共有用に使う）
```

---

## ファイル構成

```
worker/
├── wrangler.jsonc      # Cloudflare Containers / Worker の設定
├── package.json
└── src/
    └── index.ts        # Worker → Container へのプロキシ処理

backend/
└── Dockerfile          # FastAPI コンテナのビルド定義
```

### wrangler.jsonc の主要設定

| フィールド | 説明 |
|---|---|
| `account_id` | ハッカソン配布アカウントの ID |
| `containers[].image` | Dockerfile のパス |
| `containers[].max_instances` | 同時起動するコンテナの最大数 |
| `durable_objects` | Container を Durable Object として紐付ける設定 |
| `migrations` | Durable Object のマイグレーション定義 |

---

## トラブルシューティング

### `Unauthorized` エラーが出る

個人アカウントでログインしている可能性がある。

```bash
npx wrangler whoami  # tokyo_odh_150 になっているか確認
npx wrangler logout
npx wrangler login   # 配布アカウントで再ログイン
```

### `Cannot connect to the Docker daemon` エラーが出る

Docker Desktop が起動していない。アプリケーションから Docker Desktop を起動する。

### デプロイ後にページが開けない

Cloudflare の反映に数十秒かかることがある。少し待ってからリロードする。

---

## 稼働 URL

| 環境 | URL |
|---|---|
| フロントエンド | https://saigai-map.pages.dev |
| バックエンド API | https://saigai-map-api.tokyo-odh-150.workers.dev |
