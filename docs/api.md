# API一覧

## ヘルスチェック

| No | 大分類 | メソッド | パス | 認証 | 概要 | リクエストパラメータ | レスポンス概要 | ステータスコード |
|---|---|---|---|---|---|---|---|---|
| 1 | ヘルス | GET | /api/health | 不要 | FastAPI プロセスの死活確認 | なし | `{ status: "ok" }` | 200 |
| 2 | ヘルス | GET | /api/health/d1 | 不要 | Worker Binding 経由の D1 接続確認 | なし | `{ status: "ok" }` | 200 / 503 |
| 3 | ヘルス | GET | /api/health/r2 | 不要 | Worker Binding 経由の R2 接続確認 | なし | `{ status: "ok" }` | 200 / 503 |

## 認証

| No | 大分類 | メソッド | パス | 認証 | 概要 | リクエストパラメータ | レスポンス概要 | ステータスコード |
|---|---|---|---|---|---|---|---|---|
| 4 | 認証 | POST | /api/auth/register | 不要 | 新規ユーザー登録 | ボディ: `name`(str, 3〜20文字, 半角英数字・_・-), `password`(str, 8文字以上), `email`(str, 任意) | TokenResponse（user + access_token）。refresh_token を HttpOnly Cookie にセット | 201 / 409 / 422 |
| 5 | 認証 | POST | /api/auth/login | 不要 | ログイン | ボディ: `name`(str), `password`(str) | TokenResponse（user + access_token）。refresh_token を HttpOnly Cookie にセット | 200 / 401 |
| 6 | 認証 | POST | /api/auth/refresh | Cookie | アクセストークン再発行 | Cookie: `refresh_token` | `{ access_token, token_type }` | 200 / 401 |
| 7 | 認証 | POST | /api/auth/logout | Cookie | ログアウト | Cookie: `refresh_token` | なし（204） | 204 |
| 8 | 認証 | GET | /api/auth/me | Bearer | ログイン中ユーザーの情報取得 | ヘッダー: `Authorization: Bearer <access_token>` | `{ id, name, email, avatar_url, created_at }` | 200 / 401 |

## ハザード

| No | 大分類 | メソッド | パス | 認証 | 概要 | リクエストパラメータ | レスポンス概要 | ステータスコード |
|---|---|---|---|---|---|---|---|---|
| 9 | ハザード | GET | /api/hazards | 不要 | ハザード種別・シナリオ・凡例の一覧 | なし | ハザード種別ごとのメタ情報（label, risk, legend 等） | 200 |

## 避難所

| No | 大分類 | メソッド | パス | 認証 | 概要 | リクエストパラメータ | レスポンス概要 | ステータスコード |
|---|---|---|---|---|---|---|---|---|
| 10 | 避難所 | GET | /api/shelters | 不要 | 避難所・避難場所の一覧 | クエリ: `bbox`(str, `left,bottom,right,top`, 省略時は全件), `type`(str, `urgent`\|`designated`\|`all`, 省略時は全件) | GeoJSON FeatureCollection | 200 / 400 |

## 避難経路

| No | 大分類 | メソッド | パス | 認証 | 概要 | リクエストパラメータ | レスポンス概要 | ステータスコード |
|---|---|---|---|---|---|---|---|---|
| 11 | 避難経路 | GET | /api/evac-routes/presets | 不要 | OD・シナリオ一覧と既定値 | なし | `{ default_scenario, default_od, scenarios[], od[] }` | 200 / 503 |
| 12 | 避難経路 | GET | /api/evac-routes/presets/{od} | 不要 | 事前計算済みバンドル1件 | パス: `od`(str), クエリ: `scenario`(str, 必須) | バンドル（routes[], geojson, minimax_floor_m 等）をバイト列のまま返す | 200 / 400 / 404 / 503 |
| 13 | 避難経路 | GET | /api/evac-routes/area | 不要 | 経路探索の対象エリア（bbox） | クエリ: `scenario`(str, 省略時はデフォルト) | `{ bbox: [left, bottom, right, top] }` 等 | 200 / 400 / 503 |
| 14 | 避難経路 | POST | /api/evac-routes/search | 不要 | 任意の2点間の経路探索 | ボディ: `origin`({lat, lon, label?}), `dest`({lat, lon, label?}), `hazards`(dict, 省略時は空＝最短のみ), `include`(list, 省略時は["baseline","selected"]), `scenario`(str, 任意) | バンドル + `rationale`（経路選択根拠） | 200 / 400 / 422 / 503 |
| 15 | 避難経路 | POST | /api/evac-routes/search/shelter | 不要 | 目的地未指定・近隣の最適避難先を探索 | ボディ: `origin`({lat, lon, label?}), `hazards`(dict), `include`(list), `scenario`(str, 任意), `limit`(int, 1〜10, デフォルト5) | バンドル + `shelter` / `shelter_candidates` / `shelter_query` | 200 / 400 / 422 / 503 |

## 投稿

| No | 大分類 | メソッド | パス | 認証 | 概要 | リクエストパラメータ | レスポンス概要 | ステータスコード |
|---|---|---|---|---|---|---|---|---|
| 16 | 投稿 | GET | /api/posts | 不要 | 投稿一覧取得。ソート・ページング・helpful済み状態に対応 | クエリ: `limit`(int, 1〜10, デフォルト10), `offset`(int, デフォルト0), `sort`(str, `recent`\|`helpful`\|`nearby`, デフォルト"recent"), `latitude`(float, nearbyソート時必須), `longitude`(float, nearbyソート時必須), `user_id`(str, デフォルト"anonymous") | `{ items: Post[], has_more: bool }` | 200 / 400 / 503 |
| 17 | 投稿 | POST | /api/posts | 不要 | 新規投稿作成 | ボディ: `user_id`(str, 必須), `content`(str, 1〜1000文字, 必須), `latitude`(float, 任意), `longitude`(float, 任意), `image_url`(str, 任意) | 作成した投稿（Post） | 201 / 401 / 503 |
| 18 | 投稿 | POST | /api/posts/{post_id}/helpful | 不要 | 「役に立った」の追加・取り消し（トグル） | パス: `post_id`(str), ボディ: `user_id`(str, 必須) | 更新後の投稿（Post）。`helpful_count` と `helpful` が反映される | 200 / 401 / 404 / 503 |

---

## 補足

### 422 エラーの `detail` 形式（避難経路）

`/api/evac-routes/search` と `/api/evac-routes/search/shelter` の 422 は 2 パターンあり、フロントは `detail?.error` の有無で区別する。

| パターン | `detail` の形 | 例 |
|---|---|---|
| アプリ独自エラー | オブジェクト `{ error, message, ... }` | `{ "error": "out_of_area", "message": "...", "which": "origin", "bbox": [...] }` |
| Pydantic バリデーションエラー | 配列 `[{ loc, msg, type, ... }]` | `[{ "loc": ["body", "origin"], "msg": "..." }]` |

`detail.error` の値一覧:

| 値 | 意味 | 該当エンドポイント |
|---|---|---|
| `out_of_area` | 出発地または目的地が対象エリア外 | /search, /search/shelter |
| `no_shelter` | 条件を満たす避難先が見つからない | /search/shelter |
| `bad_request` | その他の入力不正 | /search, /search/shelter, /shelters |
| `not_generated` | データ未生成（503 で返ることもある） | /presets, /search, /search/shelter |

### 投稿の認証について

現在 `user_id` はリクエストパラメータで渡す簡易方式。認証機能（Bearer トークン）との統合は今後の課題。
