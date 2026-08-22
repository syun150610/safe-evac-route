import { createContext, useContext, useEffect, useState } from 'react'
import {
  getMe,
  login as loginApi,
  logoutApi,
  refreshAccessToken,
  register as registerApi,
  type UserResponse,
} from './api'

type AuthStatus = 'initializing' | 'unauthenticated' | 'authenticated'

interface AuthContextValue {
  status: AuthStatus
  user: UserResponse | null
  accessToken: string | null
  login: (name: string, password: string) => Promise<void>
  register: (name: string, password: string, email?: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('initializing')
  const [user, setUser] = useState<UserResponse | null>(null)
  const [accessToken, setAccessToken] = useState<string | null>(null)

  useEffect(() => {
    refreshAccessToken()
      .then(({ access_token }) => getMe(access_token).then((u) => ({ access_token, user: u })))
      .then(({ access_token, user: u }) => {
        setAccessToken(access_token)
        setUser(u)
        setStatus('authenticated')
      })
      .catch(() => setStatus('unauthenticated'))
  }, [])

  const login = async (name: string, password: string) => {
    const res = await loginApi(name, password)
    setAccessToken(res.access_token)
    setUser(res.user)
    setStatus('authenticated')
  }

  const register = async (name: string, password: string, email?: string) => {
    const res = await registerApi(name, password, email)
    setAccessToken(res.access_token)
    setUser(res.user)
    setStatus('authenticated')
  }

  const logout = async () => {
    await logoutApi().catch(() => {})
    setAccessToken(null)
    setUser(null)
    setStatus('unauthenticated')
  }

  return (
    <AuthContext.Provider value={{ status, user, accessToken, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
