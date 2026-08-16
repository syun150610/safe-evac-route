# CI/CD

このプロジェクトでは、GitHub ActionsでCIを実行し、mainへマージされた変更を
Cloudflareへ自動デプロイする。

## CI

`.github/workflows/ci.yml` は、main以外へのpushとPull Requestで実行される。
mainへのマージ後はCDだけを実行し、CIは重複して実行しない。変更されたパスに
応じて必要なジョブだけを実行し、最後に `CI Success` で結果を集約する。

| 変更パス | 実行するジョブ |
|---|---|
| `backend/**`、`.python-version` | Backend、Container |
| `frontend/**` | Frontend |
| `worker/**` | Worker |
| `.node-version` | Frontend、Worker |
| `.github/workflows/ci.yml` | すべて |
| ドキュメント、その他 | `CI Success` のみ |

GitHub Rulesetでは、`CI Success` だけを必須ステータスチェックとして登録する。

## CD

`.github/workflows/deploy.yml` は、デプロイ対象に関係する変更がmainへ入った場合に
実行される。GitHub Actions画面から手動実行する場合も、mainを選択する。

デプロイは次の順番で行う。

1. FrontendとWorkerの依存関係を復元する
2. 未適用のD1 migrationを本番D1へ適用する
3. `wrangler deploy` でStatic Assets、Worker、Containerをデプロイする

D1 migrationに失敗した場合、デプロイは実行されない。稼働中のアプリケーションと
互換性を保つため、migrationではテーブルやカラムの追加を先に行い、既存カラムの
削除や名前変更を同じデプロイで行わない。

## GitHub Environment

GitHubリポジトリの `Settings` → `Environments` で `production` を作成し、
Environment Secretsとして次の値を登録する。

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

`CLOUDFLARE_API_TOKEN` はCloudflare公式の `Edit Cloudflare Workers` テンプレートで
作成し、対象をこのプロジェクトのCloudflareアカウントだけに限定する。秘密値は
リポジトリ、`.env.example`、Issue、Pull Requestへ記載しない。

## GitHub Ruleset

mainを対象に、次のRulesetをGitHub Dashboardから設定する。

- Pull Requestを必須にし、mainへの直接pushを禁止する
- 必須ステータスチェックに `CI Success` を指定する
- Pull Requestブランチとmainの同期は必須にしない
- レビュー承認とレビューコメントの解決は必須にしない
- Merge commitを許可する
- force pushとmainの削除を禁止する
- コミット署名は必須にしない
- リポジトリ管理者だけ緊急時の迂回を許可する

`CI Success` はworkflowがGitHub上で一度実行された後に選択できる。

## Cloudflareリソース

本番では次のリソースを使用する。

| 種類 | リソース名 | Binding名 |
|---|---|---|
| D1 | `safe-evac-route-db` | `DATABASE` |
| R2 | `safe-evac-route-storage` | `STORAGE` |

D1のIDとR2 bucket名は `worker/wrangler.jsonc` で管理する。これらはリソースの
識別情報であり秘密値ではない。
