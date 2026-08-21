# データベース設計書

## テーブル一覧

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

## 各テーブルの詳細

### USERS

ユーザーアカウント情報を管理する。

| カラム名 | 型 | 制約 | 説明 |
|---|---|---|---|
| id | string | PK | ユーザーID |
| name | string | | 表示名 |
| email | string | UNIQUE | メールアドレス |
| password_hash | string | | ハッシュ化されたパスワード |
| avatar_url | string | NULL許容 | アイコン画像のR2 URL |
| created_at | datetime | | 登録日時 |

---

### POSTS

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

### POST_EVALUATIONS

投稿に対するユーザーの評価を管理する。

| カラム名 | 型 | 制約 | 説明 |
|---|---|---|---|
| id | string | PK | 評価ID |
| post_id | string | FK → POSTS.id | 対象投稿 |
| user_id | string | FK → USERS.id | 評価したユーザー |
| evaluation_type | string | | 評価種別（例: 信頼できる・役に立った等） |
| created_at | datetime | | 評価日時 |

---

### NOTIFICATIONS

ユーザー間の通知（接続申請・評価通知など）を管理する。

| カラム名 | 型 | 制約 | 説明 |
|---|---|---|---|
| id | string | PK | 通知ID |
| sender_id | string | FK → USERS.id | 送信者 |
| recipient_id | string | FK → USERS.id | 受信者 |
| status | string | | 通知ステータス（未読・既読等） |
| sent_at | datetime | | 送信日時 |

---

### CONNECTIONS

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

### REFRESH_TOKENS

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

### STRUCTURES

避難所・病院・公共施設などの構造物情報を管理する。

| カラム名 | 型 | 制約 | 説明 |
|---|---|---|---|
| id | string | PK | 施設ID |
| name | string | | 施設名 |
| type | string | | 種別（避難所・病院・学校等） |
| latitude | float | | 緯度 |
| longitude | float | | 経度 |

---

## テーブル間のリレーション

```
USERS ──(writes)──────────────→ POSTS
USERS ──(sends / receives)────→ NOTIFICATIONS
USERS ──(requests / receives)─→ CONNECTIONS
USERS ──(holds)───────────────→ REFRESH_TOKENS
USERS ──(evaluates via)───────→ POST_EVALUATIONS

POSTS ──(receives)────────────→ POST_EVALUATIONS

NOTIFICATIONS ──(evaluates)───→ POST_EVALUATIONS
```
