# 認証API設計

## 概要

ユーザー登録・ログイン・トークン管理を行うエンドポイント群。  
ログインIDは `name`（ユーザー名）を使用する。

## `name` の仕様

| 項目 | 内容 |
|---|---|
| 使用可能文字 | 半角英数字・アンダースコア・ハイフン（`a-z`, `0-9`, `_`, `-`） |
| 文字数 | 3〜20文字 |
| 変更可否 | **変更不可（immutable）** — ログインIDを兼ねるため登録後は変えられない |

## トークン方針

| 種別 | 有効期限 | 受け渡し方法 |
|---|---|---|
| access token | 15分 | レスポンスボディ（`Bearer` トークン） |
| refresh token | 30日 | HttpOnly Cookie（JSから読めないためXSS耐性あり） |

**refresh token rotation**: `/api/auth/refresh` を叩くたびに古い refresh token を失効させ、新しいものを発行する。これによりトークン盗難時の被害を最小化する。

**同時リフレッシュ**: 同一ユーザーが並行して `/api/auth/refresh` を叩いた場合、先に処理された方のみ成功し、後発は 401 を返す。クライアントは 401 を受け取ったら再ログインを促す。

**レート制限**: `/api/auth/login` と `/api/auth/register` はブルートフォース攻撃の標的になりやすい。Cloudflare Workers のレート制限機能（Rate Limiting Rules）で対処する。FastAPI 側での実装は行わない。

## `email` の UNIQUE 制約について

`email` は任意項目（NULL許容）であるため、D1（SQLite）の仕様上 `NULL` 同士は重複とみなされない。入力された場合のみ一意性を保証する。将来パスワードリセット機能を実装する際は、`email` を必須化することを検討する。

---

## エンドポイント一覧

| メソッド | パス | 概要 | 認証 |
|---|---|---|---|
| POST | `/api/auth/register` | ユーザー登録 | 不要 |
| POST | `/api/auth/login` | ログイン | 不要 |
| POST | `/api/auth/refresh` | access token 更新 | refresh token (Cookie) |
| POST | `/api/auth/logout` | ログアウト | 不要（Cookie があれば失効、なければ何もしない） |
| GET | `/api/auth/me` | 自分のプロフィール取得 | access token |

---

## 各エンドポイント詳細

### POST `/api/auth/register`

ユーザーを新規登録し、トークンを発行する。

**リクエストボディ**

```json
{
  "name": "yamada",
  "password": "password123",
  "email": "yamada@example.com"
}
```

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| name | string | ✓ | ユーザー名（ログインID・一意・immutable） |
| password | string | ✓ | パスワード（8文字以上） |
| email | string | | メールアドレス（任意） |

**レスポンス `201 Created`**

```json
{
  "user": {
    "id": "01JXXXXXXXXXXXXXXXXXXXXXXX",
    "name": "yamada",
    "email": "yamada@example.com",
    "avatar_url": null,
    "created_at": "2026-08-21T10:00:00Z"
  },
  "access_token": "eyJ...",
  "token_type": "bearer"
}
```

Set-Cookie: `refresh_token=<token>; HttpOnly; Secure; SameSite=Strict; Path=/api/auth`

**エラー**

| ステータス | 条件 |
|---|---|
| 409 Conflict | name がすでに使われている |
| 422 Unprocessable Entity | バリデーションエラー（パスワード短すぎ・name の文字種違反等） |

---

### POST `/api/auth/login`

ユーザー名とパスワードで認証し、トークンを発行する。

**リクエストボディ**

```json
{
  "name": "yamada",
  "password": "password123"
}
```

**レスポンス `200 OK`**

```json
{
  "user": {
    "id": "01JXXXXXXXXXXXXXXXXXXXXXXX",
    "name": "yamada",
    "email": "yamada@example.com",
    "avatar_url": null,
    "created_at": "2026-08-21T10:00:00Z"
  },
  "access_token": "eyJ...",
  "token_type": "bearer"
}
```

Set-Cookie: `refresh_token=<token>; HttpOnly; Secure; SameSite=Strict; Path=/api/auth`

**エラー**

| ステータス | 条件 |
|---|---|
| 401 Unauthorized | name またはパスワードが不正 |

---

### POST `/api/auth/refresh`

Cookie の refresh token を失効させ、新しい access token と refresh token を発行する（rotation）。

**リクエスト**

ボディなし。Cookie に `refresh_token` が必要。

**レスポンス `200 OK`**

```json
{
  "access_token": "eyJ...",
  "token_type": "bearer"
}
```

Set-Cookie: `refresh_token=<新トークン>; HttpOnly; Secure; SameSite=Strict; Path=/api/auth`

**エラー**

| ステータス | 条件 |
|---|---|
| 401 Unauthorized | refresh token が無効・期限切れ・失効済み（同時リフレッシュで負けた場合を含む） |

---

### POST `/api/auth/logout`

refresh token を失効させ、Cookie を削除する。  
トークンの有無・有効性に関わらず **常に `204` を返す**（トークンの有効性を外部に漏らさないため）。

**リクエスト**

ボディなし。Cookie は任意。

**レスポンス `204 No Content`**

---

### GET `/api/auth/me`

現在ログイン中のユーザー情報を返す。

**リクエストヘッダー**

```
Authorization: Bearer <access_token>
```

**レスポンス `200 OK`**

```json
{
  "id": "01JXXXXXXXXXXXXXXXXXXXXXXX",
  "name": "yamada",
  "email": "yamada@example.com",
  "avatar_url": null,
  "created_at": "2026-08-21T10:00:00Z"
}
```

**エラー**

| ステータス | 条件 |
|---|---|
| 401 Unauthorized | access token が無効・期限切れ |
