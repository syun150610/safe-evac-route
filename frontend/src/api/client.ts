/** APIクライアント。**相対パスでバックの中を直接読まない**
 * （docs/dev/05_チーム移行案.md §3-2。フロントの階層に依存しなくなる）
 */
import type {
  Area,
  Bundle,
  HazardCatalog,
  PresetIndex,
  SearchRequest,
  ShelterCollection,
  ShelterSearchRequest,
} from '../map/types'

import type { CreatePostRequest, Post, PostList } from '../posts/types'

const BASE = import.meta.env.VITE_API_BASE ?? '/api'

/** APIが返した `detail`（辞書）を持ったままのエラー。
 *
 * ⚠️ 対象エリア外は **422 + detail.error === "out_of_area"** で来る。
 * FastAPI のバリデーションエラーも 422 だが、あちらの detail は**配列**なので
 * `detail.error` の有無で区別できる（backend/app/routers/evac_routes.py）。
 */
export class ApiError extends Error {
  readonly status: number
  readonly detail: unknown
  constructor(status: number, detail: unknown, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }

  /** 対象エリア外か。true ならどちらの地点が外かは `outside` で分かる */
  get outOfArea(): boolean {
    return this.status === 422 && this.code === 'out_of_area'
  }

  get code(): string | null {
    const d = this.detail as { error?: string } | null
    return d && typeof d === 'object' && typeof d.error === 'string' ? d.error : null
  }

  get outside(): ('origin' | 'dest')[] {
    const d = this.detail as { which?: ('origin' | 'dest')[] } | null
    return Array.isArray(d?.which) ? d.which : []
  }
}

async function toError(r: Response, path: string): Promise<ApiError> {
  let detail: unknown = null
  let message = `${path}: ${r.status} ${r.statusText}`
  try {
    const body = (await r.json()) as { detail?: unknown }
    detail = body?.detail ?? null
    const d = detail as { message?: string } | null
    if (d && typeof d === 'object' && typeof d.message === 'string') message = d.message
    else if (typeof detail === 'string') message = detail
  } catch {
    // JSONでない（502など）。既定のメッセージのままでよい
  }
  return new ApiError(r.status, detail, message)
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`)
  if (!r.ok) throw await toError(r, path)
  return (await r.json()) as T
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw await toError(r, path)
  return (await r.json()) as T
}

export const getPresets = () => get<PresetIndex>('/evac-routes/presets')

export const getBundle = (od: string, scenario: string) =>
  get<Bundle>(
    `/evac-routes/presets/${encodeURIComponent(od)}` + `?scenario=${encodeURIComponent(scenario)}`,
  )

export const getHazards = () => get<HazardCatalog>('/hazards')

/** 対象エリア（bbox）。**この外の地点では経路を引けない** */
export const getArea = (scenario?: string) =>
  get<Area>(`/evac-routes/area${scenario ? `?scenario=${encodeURIComponent(scenario)}` : ''}`)

/** 任意の2点の経路。戻り値はプリセットと同じ形 */
export const postSearch = (req: SearchRequest) => post<Bundle>('/evac-routes/search', req)

/** 安全な避難先の検索。目的地を指定せず、近隣で一番安全に着ける避難所を探す。
 *
 * 戻り値は `postSearch` と同じ形（routes[] / geojson / rationale）に
 * `shelter` / `shelter_candidates` / `shelter_query` が付いたもの。
 * 候補一覧の描画はまだ入れていないので、型は Bundle のまま扱う。
 */
export const postShelterSearch = (req: ShelterSearchRequest) =>
  post<Bundle>('/evac-routes/search/shelter', req)

/** 避難所・避難場所一覧（GeoJSON）。bbox は "left,bottom,right,top" */
export const getShelters = (params?: { bbox?: string; type?: string }) => {
  const q = new URLSearchParams()
  if (params?.bbox) q.set('bbox', params.bbox)
  if (params?.type) q.set('type', params.type)
  const qs = q.toString()
  return get<ShelterCollection>(`/shelters${qs ? `?${qs}` : ''}`)
}
/** 投稿一覧を取得する。 */
export const getPosts = (params: {
  limit?: number
  offset?: number
  sort?: 'recent' | 'nearby' | 'helpful'
  latitude?: number | null
  longitude?: number | null
  userId: string
}) => {
  const query = new URLSearchParams({
    limit: String(params.limit ?? 10),
    offset: String(params.offset ?? 0),
    sort: params.sort ?? 'recent',
    user_id: params.userId,
  })

  if (params.latitude != null && params.longitude != null) {
    query.set('latitude', String(params.latitude))
    query.set('longitude', String(params.longitude))
  }

  return get<PostList>(`/posts?${query}`)
}

/** 投稿を作成する。 */
export const createPost = (req: CreatePostRequest) => post<Post>('/posts', req)

/** 投稿に評価を付ける。 */
export const markPostHelpful = (postId: string, userId: string) =>
  post<Post>(`/posts/${encodeURIComponent(postId)}/helpful`, { user_id: userId })
