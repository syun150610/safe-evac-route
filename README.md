# Safe Evac Route

浸水ハザード情報を考慮した避難経路検索Webアプリです。

## 構成

- `frontend/`: React + Vite。Cloudflare Workers Static Assetsで配信
- `backend/`: FastAPI。Cloudflare Container上で実行
- `worker/`: Static Assets、APIルーティング、Container、Cloudflare Bindingsを管理

ブラウザからの `/api/*` はWorker経由でFastAPI Containerへ転送され、それ以外の
パスではReact SPAが配信されます。

## セットアップ

```bash
cd backend
uv sync --frozen

cd ../frontend
npm ci

cd ../worker
npm ci
```

Dockerが起動している状態で、Worker、Container、ローカルD1を起動します。

```bash
cd worker
npm run dev
```

Reactをホットリロードしながら開発する場合は、別ターミナルで起動します。`/api` は
自動的にローカルWorkerへプロキシされます。

```bash
cd frontend
npm run dev
npm run check
npm run typecheck
npm run test
```

確認先:

- React SPA: `http://localhost:8787/`
- FastAPI: `http://localhost:8787/api/health`
- D1疎通: `http://localhost:8787/api/health/d1`
- R2疎通: `http://localhost:8787/api/health/r2`
- Vite開発サーバー: `http://localhost:5173/`

## バックエンド単体開発

```bash
cd backend
uv run uvicorn app.main:app --reload
uv run ruff check .
uv run ruff format --check .
uv run pytest
```

FastAPI単体起動ではCloudflare Bindingsが存在しないため、D1・R2疎通APIは利用できません。
環境変数は `.env.example` をコピーして使用します。

```bash
cp .env.example .env
```

## 関連ドキュメント

- [Cloudflare構成](docs/cloudflare.md)
- [前処理・runtime成果物の全体像](docs/prep/README.md)
- [ローカル実行・検証runbook](docs/local-runbook.md)
- [一次データの取得](docs/prep/raw-data.md)
- [浸水データの入力と再生成](docs/prep/flood-data.md)
- [データベース構成](docs/database.md)
- [CI/CD](docs/ci-cd.md)
- [Google Maps JavaScript APIキーの準備](docs/google-maps-api-key.md)
