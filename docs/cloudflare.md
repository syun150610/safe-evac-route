# Cloudflare構成・開発手順

## 構成

```text
ブラウザ
   │
   ▼
Cloudflare Worker
   ├── /api/*  ── FastAPI Container
   └── その他  ── React Static Assets

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
FastAPI Containerを起動し、ローカルD1を `.wrangler/` に作成します。本番D1には
接続しません。

ReactのHMRが必要な場合は、別ターミナルで `cd frontend && npm run dev` を実行します。
Viteは `/api` を `http://localhost:8787` へプロキシします。

## Bindings疎通

現段階では業務テーブルを作成しません。次のAPIだけが、Containerのoutbound handlerと
D1 Binding APIを通して `SELECT 1` を実行します。

```bash
curl http://localhost:8787/api/health/d1
# {"status":"ok"}
```

R2も保存用途はまだ決めず、ローカルbucketの一覧取得による疎通だけを確認します。

```bash
curl http://localhost:8787/api/health/r2
# {"status":"ok"}
```

`worker/migrations/` は将来のD1 migration用です。

## デプロイについて

この段階では本番D1・R2を作成・接続しません。Wrangler設定のBindingsは自動
プロビジョニング形式のため、将来初めてdeployする際にはCloudflare上のリソース作成を
確認したうえで実行してください。

Containersの利用には対応するCloudflareプランと、Dockerが必要です。ハッカソン配布
アカウントを利用する場合は、deploy前に `npx wrangler whoami` で対象アカウントを確認します。
