# 認証API設計

## 概要

ユーザー登録・ログイン・トークン管理を行うエンドポイント群。  
ログインIDは `name`（ユーザー名）を使用する。

## トークン方針

| 種別 | 有効期限 | 受け渡し方法 |
|---|---|---|
| access token | 15分 | レスポンスボディ（`Bearer` トークン） |
| refresh token | 30日 | HttpOnly Cookie（JSから読めないためXSS耐性あり） |

---

## エンドポイント一覧

| メソッド | パス | 概要 | 認証 |
|---|---|---|---|
| POST | `/api/auth/register` | ユーザー登録 | 不要 |
| POST | `/api/auth/login` | ログイン | 不要 |
| POST | `/api/auth/refresh` | access token 更新 | refresh token (Cookie) |
| POST | `/api/auth/logout` | ログアウト | refresh token (Cookie) |
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
| name | string | ✓ | ユーザー名（ログインID・一意） |
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
| 422 Unprocessable Entity | バリデーションエラー（パスワード短すぎ等） |

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

Cookie の refresh token を使って access token を再発行する。

**リクエスト**

ボディなし。Cookie に `refresh_token` が必要。

**レスポンス `200 OK`**

```json
{
  "access_token": "eyJ...",
  "token_type": "bearer"
}
```

**エラー**

| ステータス | 条件 |
|---|---|
| 401 Unauthorized | refresh token が無効・期限切れ・失効済み |

---

### POST `/api/auth/logout`

refresh token を失効させ、Cookie を削除する。

**リクエスト**

ボディなし。Cookie に `refresh_token` が必要。

**レスポンス `204 No Content`**

**エラー**

| ステータス | 条件 |
|---|---|
| 401 Unauthorized | refresh token が無効 |

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
