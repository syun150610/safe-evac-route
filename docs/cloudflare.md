# Cloudflare構成・開発手順

## 構成

```text
ブラウザ
   │
   ▼
Cloudflare Worker
   ├── /api/*    ── FastAPI Container
   ├── /tiles/*  ── R2
   └── その他    ── React Static Assets

FastAPI Container
   │ HTTP（d1.internal / r2.internal）
   ▼
Container outbound handler
   ├── D1 Binding API
   └── R2 Binding API
```

Workerの設定は `worker/wrangler.jsonc` を正とします。フロントエンド、API、
Container、Bindingsを単一Workerで管理します。

## ローカル開発

Node.js、npm、uv、Docker Engineが必要です。

```bash
cd backend && uv sync
cd ../frontend && npm install
cd ../worker && npm install
npm run dev
```

`npm run dev` はReactをビルドしてからWranglerを起動します。WranglerはDockerで
FastAPI Containerを起動し、ローカルD1・R2を `.wrangler/` に作成します。本番の
D1・R2には接続しません。ローカルR2は空なので、タイルを投入していない状態の
`/tiles/*` は404になります。

ReactのHMRが必要な場合は、別ターミナルで `cd frontend && npm run dev` を実行します。
Viteは `/api` を `http://localhost:8787` へプロキシします。

## Bindings疎通

現段階では業務テーブルを作成しません。次のAPIだけが、Containerのoutbound handlerと
D1 Binding APIを通して `SELECT 1` を実行します。

```bash
curl http://localhost:8787/api/health/d1
# {"status":"ok"}
```

R2は浸水PNGと地震GeoJSONの配信に使います。ローカルbucketの一覧取得によるBinding疎通は
次で確認します。

```bash
curl http://localhost:8787/api/health/r2
# {"status":"ok"}
```

`worker/migrations/` は将来のD1 migration用です。

詳細な起動方法と、uvicorn・Docker・Wranglerの使い分けは
[ローカル実行・検証runbook](local-runbook.md)を参照してください。

## デプロイについて

本番D1とR2は `worker/wrangler.jsonc` の既存リソースへ接続します。mainへのマージ後、
GitHub ActionsがD1 migration、Static Assets、Worker、Containerを順にデプロイします。
ローカル確認で `wrangler deploy` やR2のremote uploadを実行しません。

Containersの利用には対応するCloudflareプランと、Dockerが必要です。ハッカソン配布
アカウントを利用する場合は、手動deploy前に `npx wrangler whoami` で対象アカウントを確認します。
