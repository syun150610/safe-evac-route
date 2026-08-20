# Google Maps JavaScript APIキーの準備

## 目的

Google版の地図を、ローカル開発と本番で安全に使うための設定をまとめる。
ローカル用と本番用は、利用元と更新タイミングが異なるため別々のAPIキーを使う。

| 用途 | Google Cloudの制限 | アプリへの設定先 |
|---|---|---|
| ローカル開発 | `localhost`の使用ポートだけを許可 | `frontend/.env.local` |
| 本番 | 公開サイトのオリジンだけを許可 | GitHub `production` Environment Secret |

Maps JavaScript APIのキーは、地図を読み込むため最終的にブラウザへ渡る。GitHub Secretや
`.env.local`はリポジトリへの誤コミットを防ぐための保管場所であり、配信後のキーを
ブラウザから秘匿する仕組みではない。不正利用はGoogle Cloud側のWebサイト制限と
API制限で防ぐ。

## Google Cloud側の前提

1. Google Cloudプロジェクトへ課金先アカウントを関連付ける
2. **Maps JavaScript API**を有効にする
3. ローカル用と本番用のAPIキーを1本ずつ作成する

操作するメンバーには、少なくとも次のIAM権限または同等の権限が必要になる。

- APIキーの作成・更新: API Keys Admin（`roles/serviceusage.apiKeysAdmin`）
- APIの有効化: Service Usage Admin（`roles/serviceusage.serviceUsageAdmin`）
- 課金先を新たに関連付ける場合: 対象プロジェクトと課金先アカウントの管理権限

すでに課金設定とAPI有効化が完了していれば、キーを作成・制限する作業だけでよい。

## ローカル開発用キー

Google Cloud Consoleの「APIとサービス」→「認証情報」でAPIキーを作成し、次のように
制限する。キー名の例は `Local API Key for Hackathon`。

### アプリケーションの制限

「ウェブサイト（HTTPリファラー）」を選び、実際に使うViteのURLだけを登録する。
このリポジトリのrunbookで使う例:

```text
http://localhost:5173/*
http://localhost:5174/*
http://127.0.0.1:5173/*
http://127.0.0.1:5174/*
```

別ポートで起動する場合は、そのポートも明示的に追加する。`*`だけで全サイトを許可しない。

### APIの制限

「キーを制限」を選び、**Maps JavaScript API**だけを許可する。

### ローカルファイルへ設定

```bash
cd "$(git rev-parse --show-toplevel)/frontend"
test -f .env.local || cp .env.example .env.local
```

`frontend/.env.local`の空欄へ発行したキーを設定する。

```dotenv
VITE_GOOGLE_MAPS_API_KEY=<ローカル開発用キー>
```

`.env.local`はGit管理外である。値を設定した後はViteを再起動する。キー不要で確認する
場合は `?platform=maplibre` を付けてMapLibre版を使う。

## 本番用キー

ローカル用とは別のAPIキーを作成する。現在のキー名は
`Production API Key for Hackathon`。

### アプリケーションの制限

「ウェブサイト（HTTPリファラー）」を選び、現在の公開サイトだけを登録する。

```text
https://saigai-map-api.tokyo-odh-150.workers.dev/*
```

カスタムドメインや別のプレビュー環境を追加した場合は、そのオリジンを個別に追加する。
公開URLを変更するときは、デプロイ前に制限も更新する。

### APIの制限

ローカル用と同じく、**Maps JavaScript API**だけを許可する。

### GitHubへ設定

リポジトリの`production` Environment Secretへ登録する。値をコマンドライン引数へ書かず、
対話入力する。

```bash
cd "$(git rev-parse --show-toplevel)"
gh secret set VITE_GOOGLE_MAPS_API_KEY --env production
gh secret list --env production
```

GUIでは `Settings` → `Environments` → `production` → `Environment secrets` から同じ名前で
登録できる。Environment Secretを管理するには、GitHubリポジトリのownerまたはadmin相当の
権限が必要になる。

`.github/workflows/deploy.yml`は、値が未設定ならD1 migrationとデプロイの前に失敗させる。
設定済みならデプロイ時のViteビルドへ渡し、Cloudflare Workers Static Assetsへ反映する。
`frontend/.env.example`には変数名だけを置き、本番の値は書かない。

## 動作確認

### ローカル

Viteを再起動し、Google版を開く。

```bash
cd "$(git rev-parse --show-toplevel)/frontend"
API_TARGET=http://127.0.0.1:8000 npm run dev -- --strictPort
```

ブラウザの開発者コンソールにGoogle Mapsの認証エラーが出ず、Google地図、経路、
ハザードレイヤーが表示されることを確認する。

### 本番

mainへのマージ後にDeploy workflowが成功したことを確認し、公開URLでGoogle版と
`?platform=maplibre`の両方を確認する。JavaScriptやネットワークリクエストから本番用キーを
確認できること自体は、クライアント向けMaps JavaScript APIでは想定内である。

## よくあるエラー

| 症状・エラー | 確認すること |
|---|---|
| キー未設定、`MissingKeyMapError` | `.env.local`またはGitHub Environment Secret、Viteの再起動 |
| `RefererNotAllowedMapError` | 現在のプロトコル・ホスト・ポートがWebサイト制限に含まれるか |
| `ApiNotActivatedMapError` | Maps JavaScript APIが対象プロジェクトで有効か |
| `BillingNotEnabledMapError` | 対象プロジェクトへ有効な課金先が関連付いているか |
| Deployの必須設定チェックが失敗 | Repository Secretではなく`production` Environment Secretに登録したか |

キーを交換するときは、制限済みの新しいキーを作成し、ローカルまたはGitHubの設定を更新して
動作確認してから古いキーを無効化する。

## 公式資料

- [Maps JavaScript APIのセットアップ](https://developers.google.com/maps/documentation/javascript/get-api-key)
- [Google Maps PlatformのAPIキー保護](https://developers.google.com/maps/api-security-best-practices)
- [Google CloudのService Usageロール](https://cloud.google.com/iam/docs/roles-permissions/serviceusage)
- [GitHub Environment Secretの設定](https://docs.github.com/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets#creating-secrets-for-an-environment)
