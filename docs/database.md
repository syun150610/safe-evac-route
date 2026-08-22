# データベース

スキーマの設計と、ローカル・本番D1の操作手順。

## スキーマ設計

### テーブル一覧

| テーブル名 | 用途 |
|---|---|
| USERS | ユーザー情報 |
| POSTS | ユーザー投稿（安否・状況報告） |
| POST_EVALUATIONS | 投稿への評価（いいね・信頼度など） |
| NOTIFICATIONS | ユーザー間の通知 |
| CONNECTIONS | ユーザー間のつながり申請 |
| REFRESH_TOKENS | 認証用リフレッシュトークン |
| STRUCTURES | 避難所・施設などの構造物情報 |

---

### 各テーブルの詳細

#### USERS

ユーザーアカウント情報を管理する。

| カラム名 | 型 | 制約 | 説明 |
|---|---|---|---|
| id | string | PK | ユーザーID |
| name | string | UNIQUE | 表示名（ログインIDとして使用） |
| email | string | NULL許容 | メールアドレス（任意） |
| password_hash | string | | ハッシュ化されたパスワード |
| avatar_url | string | NULL許容 | アイコン画像のR2 URL |
| created_at | datetime | | 登録日時 |

---

#### POSTS

ユーザーが投稿する安否・現地状況の報告を管理する。

| カラム名 | 型 | 制約 | 説明 |
|---|---|---|---|
| id | string | PK | 投稿ID |
| user_id | string | FK → USERS.id | 投稿者 |
| content | string | | 投稿テキスト |
| image_url | string | | 添付画像のURL |
| latitude | float | | 投稿位置の緯度 |
| longitude | float | | 投稿位置の経度 |
| status | string | | 投稿ステータス（公開・非公開等） |
| created_at | datetime | | 投稿日時 |

---

#### POST_EVALUATIONS

投稿に対するユーザーの評価を管理する。

| カラム名 | 型 | 制約 | 説明 |
|---|---|---|---|
| id | string | PK | 評価ID |
| post_id | string | FK → POSTS.id | 対象投稿 |
| user_id | string | FK → USERS.id | 評価したユーザー |
| evaluation_type | string | | 評価種別（例: 信頼できる・役に立った等） |
| created_at | datetime | | 評価日時 |

「役に立った」は `evaluation_type = 'helpful'` として保存する。

---

#### NOTIFICATIONS

ユーザー間の通知（接続申請・評価通知など）を管理する。

| カラム名 | 型 | 制約 | 説明 |
|---|---|---|---|
| id | string | PK | 通知ID |
| sender_id | string | FK → USERS.id | 送信者 |
| recipient_id | string | FK → USERS.id | 受信者 |
| status | string | | 通知ステータス（未読・既読等） |
| sent_at | datetime | | 送信日時 |

---

#### CONNECTIONS

ユーザー間のつながり（フォロー・友達申請など）を管理する。

| カラム名 | 型 | 制約 | 説明 |
|---|---|---|---|
| id | string | PK | 接続ID |
| requester_id | string | FK → USERS.id | 申請者 |
| recipient_id | string | FK → USERS.id | 受信者 |
| status | string | | 申請ステータス（pending・accepted・rejected等） |
| created_at | datetime | | 申請日時 |
| responded_at | datetime | | 返答日時 |

---

#### REFRESH_TOKENS

JWT認証のリフレッシュトークンを管理する。

| カラム名 | 型 | 制約 | 説明 |
|---|---|---|---|
| id | string | PK | トークンID |
| user_id | string | FK → USERS.id | 対象ユーザー |
| token_hash | string | | ハッシュ化されたトークン値 |
| expires_at | datetime | | 有効期限 |
| revoked | boolean | | 無効化フラグ |
| created_at | datetime | | 発行日時 |

---

#### STRUCTURES

避難所・病院・公共施設などの構造物情報を管理する。

| カラム名 | 型 | 制約 | 説明 |
|---|---|---|---|
| id | string | PK | 施設ID |
| name | string | | 施設名 |
| type | string | | 種別（避難所・病院・学校等） |
| latitude | float | | 緯度 |
| longitude | float | | 経度 |

---

### テーブル間のリレーション

```
USERS ──(writes)──────────────→ POSTS
USERS ──(sends / receives)────→ NOTIFICATIONS
USERS ──(requests / receives)─→ CONNECTIONS
USERS ──(holds)───────────────→ REFRESH_TOKENS
USERS ──(evaluates via)───────→ POST_EVALUATIONS

POSTS ──(receives)────────────→ POST_EVALUATIONS

NOTIFICATIONS ──(evaluates)───→ POST_EVALUATIONS
```

---

## ローカルD1の操作

Wranglerが `worker/.wrangler/state/v3/d1/` にSQLiteの実体を持つ。Gitには入らないので、
**各自の手元で作る。**

### ⚠️ マイグレーションは自動適用されない

`wrangler dev`（`npm run dev`）を起動しても、**マイグレーションは適用されない。**
隔離したstateで実測した結果、起動直後のテーブルは `_cf_METADATA` だけで、
`d1_migrations` すら作られない。

適用しないまま認証や投稿を叩くと `no such table` で失敗する。**初回は必ず実行する。**

```bash
cd "$(git rev-parse --show-toplevel)/worker"
npm run db:migrate:local
```

Workerを起動している必要はない。マイグレーションはWranglerがstateへ直接適用する。

### いまの状態を調べる

未適用のものが無ければ `No migrations to apply!` と出る。

```bash
cd "$(git rev-parse --show-toplevel)/worker"
npx wrangler d1 migrations list safe-evac-route-db --local
```

実際に何が入っているかはテーブル一覧で見る。

```bash
npx wrangler d1 execute safe-evac-route-db --local \
  --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```

適用済みマイグレーションの記録は `d1_migrations` にある。

```bash
npx wrangler d1 execute safe-evac-route-db --local \
  --command "SELECT name, applied_at FROM d1_migrations"
```

正常なら次の10件が並ぶ。アプリのテーブル7件に、Wranglerの管理用3件が加わる
（`sqlite_sequence` は AUTOINCREMENT を使った副産物）。

```text
CONNECTIONS  NOTIFICATIONS  POSTS  POST_EVALUATIONS  REFRESH_TOKENS
STRUCTURES   USERS          _cf_METADATA  d1_migrations  sqlite_sequence
```

### 中身を見る

```bash
npx wrangler d1 execute safe-evac-route-db --local \
  --command "SELECT id, name, created_at FROM USERS ORDER BY created_at DESC LIMIT 5"
```

### 作り直す（リセット）

⚠️ **ローカルのアカウントと投稿は全部消える。** 本番D1には影響しない。

```bash
cd "$(git rev-parse --show-toplevel)/worker"
rm -rf .wrangler/state/v3/d1
npm run db:migrate:local
```

`.wrangler/state/v3/d1` だけを消せばよい。`state` ごと消すとローカルR2やCacheの
状態も落ちるが、どちらも再取得できるので害はない。

## 本番D1

### Deploy workflowが自動で適用する

`.github/workflows/deploy.yml` が `wrangler deploy` の**前に**適用する。

```yaml
- name: Apply D1 migrations
  run: npm run db:migrate:remote
```

したがって、mainへマージしてDeployが成功すれば本番D1も更新済みである。**手で流す必要はない。**

### 手動で適用する場合

Deployが失敗したときなど、切り分けのために単独で実行する。Cloudflareの認証情報が要る。

```bash
cd "$(git rev-parse --show-toplevel)/worker"
npm run db:migrate:remote
```

## マイグレーションを追加するとき

- ファイル名は `NNNN_内容.sql`（`worker/migrations/`）。番号順に適用される
- **適用済みのファイルは編集しない。** Wranglerはファイル名で適用済みを判断するので、
  中身を書き換えても再適用されず、手元と本番でスキーマがずれる
- `CREATE TABLE IF NOT EXISTS` を付ける

⚠️ 現在の `0001_init.sql` は7テーブル中 **`NOTIFICATIONS` と `CONNECTIONS` だけ
`IF NOT EXISTS` が付いていない**（PR #30 の取りこぼし）。適用済みのため実害は出ていないが、
新規に足すときは揃えること。
