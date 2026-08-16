# CLAUDE.md

このファイルはClaude Codeがこのリポジトリで作業する際のガイドです。

## プロジェクト概要

**saigai_map** — 浸水ハザード情報を考慮した避難経路検索Webアプリ。
都知事杯オープンデータハッカソン2026（本番 8/22-23）向けのプロトタイプ。

出発地・目的地を指定すると、単純最短経路とハザード（浸水深）を考慮した経路を
計算・比較し、地図上に可視化する。合わせてユーザー投稿（安否・状況共有）機能を持つ。

現在のフェーズ: **セットアップ**（ディレクトリ構成・起動確認まで。機能実装はこの後）

## 技術スタック

- **フロントエンド**: React（Vite）
- **バックエンド**: FastAPI（Python、uv）をCloudflare Containerで実行
- **配信/API入口**: Cloudflare Worker（Static Assets + Container proxy）
- **DB**: Cloudflare D1（Worker Binding API経由。業務スキーマは未実装）
- **オブジェクトストレージ**: Cloudflare R2（Worker Binding API経由。用途は未定）
- **地図/ルーティング**: 別途統合予定（Google Maps API / GraphHopperなど。この段階では未実装でよい）

## ディレクトリ構成（想定）

```
saigai_map/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── hooks/
│   │   └── api/          # backendへのfetchラッパー
│   ├── index.html
│   └── package.json
├── backend/
│   ├── app/
│   │   ├── main.py       # FastAPIエントリポイント
│   │   ├── api/          # エンドポイント定義
│   │   ├── clients/      # Worker Bindingsへのクライアント
│   │   ├── core/         # 環境変数などの共通設定
│   │   ├── repositories/ # データ操作
│   │   ├── schemas/      # Pydanticスキーマ
│   │   └── services/     # ビジネスロジック（経路計算等）
│   ├── pyproject.toml
│   ├── uv.lock
│   └── .env.example
├── worker/                # Static Assets、Container、D1 Binding
├── data/
│   ├── raw/               # ダウンロードした生データ（shp, csv等、gitignore対象）
│   └── processed/         # 変換済みデータ（geojson等）
└── CLAUDE.md
```

## セットアップ手順

### バックエンド（FastAPI）

```bash
cd backend
uv sync
uv run uvicorn app.main:app --reload  # http://localhost:8000
```

`app/main.py` は起動確認用に `GET /api/health` を返すエンドポイントから始める。

### フロントエンド（React）

```bash
cd frontend
npm create vite@latest . -- --template react
npm install
npm run dev                    # http://localhost:5173
```

### Cloudflare Worker + D1

```bash
cd worker
npm install
npm run dev                    # http://localhost:8787
```

- D1はContainerからWorkerのoutbound handlerを通してBinding APIで操作する
- ローカルD1はWranglerが管理し、SQL migrationは `worker/migrations/` に置く
- SQLAlchemyとAlembicは使用しない

### 環境変数

- `backend/.env`（gitignore対象）にAPIキー等を管理
- `backend/.env.example` に必要なキー名だけコミットしておく

## コーディング規約

- **Python**: PEP8準拠、型ヒント必須、lint・formatはRuffに統一
- **React**: 関数コンポーネント + hooks（クラスコンポーネント不使用）、lint・formatはBiomeに統一
- **命名**: ファイル名はkebab-caseまたはPascalCase（コンポーネント）で統一し、混在させない

## データの扱いに関する前提（後続タスクの参照用）

- 浸水想定区域データ（ハザードマップ本体）: 事前ダウンロード → GeoJSON変換 → `data/processed/` に配置し、DBまたは静的配信
- 気象庁防災情報XML（[mlit_20170902_0034](https://data.e-gov.go.jp/data/dataset/mlit_20170902_0034)）: 随時〜毎時更新のリアルタイムフィード。サーバーサイドで定期フェッチする設計（この段階では未実装）

## チーム体制（担当の文脈）

| 領域 | 担当 |
|---|---|
| 地図表示（フロントベース） | 平賀 |
| リスク考慮のルート検索 | 桐澤 |
| DB・データ取得 | 青石 |
| その他フロント | 瀬沼 |
| その他バック・セットアップ | 山田 |

コードコメントやコミットメッセージで担当領域が分かるようにしておくと、後からの引き継ぎがしやすい。

## Git運用

- コード管理はGitHubで行う。作業は必ずブランチを切ってから進める
- ブランチ命名: `feature/xxx`（新機能）、`fix/xxx`（修正）、`setup/xxx`（セットアップ関連）
- 変更が完了したらプルリクエストを作成する
- **マージは人間が行う。Claude Codeはブランチ作成〜PR作成までを担当し、mainブランチへのマージは実行しない**
- PRの説明には変更内容・確認方法を簡潔に記載する

## このフェーズのTODO

- [ ] `frontend/` `backend/` `data/` のディレクトリ作成
- [x] FastAPI起動確認（`/api/health` エンドポイント）
- [ ] React起動確認（Viteデフォルト画面表示）
- [x] ローカルD1へのBinding API疎通確認
- [ ] `.gitignore` 整備（`venv/`, `node_modules/`, `*.db`, `.env`, `data/raw/`）
- [ ] `.env.example` 作成
- [ ] `setup/init-project` ブランチを切って上記の変更を行い、PRを作成する（マージは人間が行うため実行しない）
