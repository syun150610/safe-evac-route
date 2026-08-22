const BASE = import.meta.env.VITE_API_BASE ?? '/api'

export interface UserResponse {
  id: string
  name: string
  email: string | null
  avatar_url: string | null
  created_at: string
}

export interface TokenResponse {
  user: UserResponse
  access_token: string
  token_type: string
}

export interface AccessTokenResponse {
  access_token: string
  token_type: string
}

export class AuthApiError extends Error {
  readonly status: number
  readonly detail: unknown
  constructor(status: number, detail: unknown) {
    super(typeof detail === 'string' ? detail : `HTTP ${status}`)
    this.name = 'AuthApiError'
    this.status = status
    this.detail = detail
  }
}

async function authFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  })
  if (r.status === 204) return undefined as T
  const body = (await r.json()) as { detail?: unknown }
  if (!r.ok) throw new AuthApiError(r.status, body.detail ?? null)
  return body as T
}

export const register = (name: string, password: string, email?: string) =>
  authFetch<TokenResponse>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name, password, ...(email ? { email } : {}) }),
  })

export const login = (name: string, password: string) =>
  authFetch<TokenResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ name, password }),
  })

export const refreshAccessToken = () =>
  authFetch<AccessTokenResponse>('/auth/refresh', { method: 'POST' })

export const logoutApi = () => authFetch<void>('/auth/logout', { method: 'POST' })

export const getMe = (accessToken: string) =>
  authFetch<UserResponse>('/auth/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
