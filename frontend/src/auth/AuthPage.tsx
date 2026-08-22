import { type FormEvent, useState } from 'react'
import { useAuth } from './AuthProvider'
import { AuthApiError } from './api'

type Mode = 'login' | 'register'

function errorMessage(err: unknown): string {
  if (err instanceof AuthApiError) {
    if (err.status === 409) return 'このユーザー名はすでに使われています'
    if (err.status === 401) return 'ユーザー名またはパスワードが正しくありません'
    if (err.status === 422) return '入力内容を確認してください'
  }
  return 'エラーが発生しました。もう一度お試しください'
}

export function AuthPage() {
  const { login, register } = useAuth()
  const [mode, setMode] = useState<Mode>('login')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const switchMode = (next: Mode) => {
    setMode(next)
    setError(null)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      if (mode === 'login') {
        await login(name, password)
      } else {
        await register(name, password, email || undefined)
      }
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-gray-900">安全避難経路</h1>
          <p className="mt-1 text-sm text-gray-500">浸水ハザードを考慮した避難経路検索</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          <div className="flex rounded-lg bg-gray-100 p-1 mb-6">
            <button
              type="button"
              onClick={() => switchMode('login')}
              className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${
                mode === 'login'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              ログイン
            </button>
            <button
              type="button"
              onClick={() => switchMode('register')}
              className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${
                mode === 'register'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              新規登録
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
                ユーザー名
              </label>
              <input
                id="name"
                type="text"
                autoComplete={mode === 'login' ? 'username' : 'username'}
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例: yamada_taro"
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              {mode === 'register' && (
                <p className="mt-1 text-xs text-gray-400">
                  半角英数字・アンダースコア・ハイフン（3〜20文字）
                </p>
              )}
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                パスワード
              </label>
              <input
                id="password"
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'register' ? '8文字以上' : ''}
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {mode === 'register' && (
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                  メールアドレス
                  <span className="ml-1 text-xs font-normal text-gray-400">（任意）</span>
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="example@email.com"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            )}

            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-600">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed mt-2"
            >
              {loading ? '処理中...' : mode === 'login' ? 'ログイン' : 'アカウントを作成'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
