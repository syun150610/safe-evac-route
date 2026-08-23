import { useState } from 'react'
import { useAuth } from '../auth/AuthProvider'

function formatDate(value: string) {
  const iso = value.replace(' ', 'T')
  return new Date(/[Z+]/.test(iso.slice(-6)) ? iso : `${iso}Z`).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export function MyPage() {
  const { user, logout } = useAuth()
  const [loggingOut, setLoggingOut] = useState(false)

  async function handleLogout() {
    setLoggingOut(true)
    try {
      await logout()
    } finally {
      setLoggingOut(false)
    }
  }

  if (!user) return null

  const initial = user.name.slice(0, 1).toUpperCase()

  return (
    <main className="min-h-screen bg-[#f8f8fb] pb-24 text-[#111b54]">
      <header className="sticky top-0 z-10 flex h-[54px] items-center justify-between border-b border-slate-200 bg-white/95 px-4">
        <a
          className="flex items-center gap-2 text-sm tracking-[0.08em] text-[#07156f]"
          href="/"
          aria-label="地図に戻る"
        >
          <span className="grid size-6 place-items-center rounded-lg bg-[#07156f] text-white">
            ◇
          </span>
          <strong>SAFE</strong>
        </a>
        <span
          className="grid size-8 place-items-center rounded-full bg-[#07145f] text-xs font-bold text-white ring-2 ring-[#07145f] ring-offset-1"
          aria-hidden="true"
        >
          {initial}
        </span>
      </header>

      <section className="mx-auto max-w-xl px-5 pt-10">
        <p className="mb-2 text-sm font-bold tracking-[0.22em] text-[#ff6b00]">MY PAGE</p>
        <h1 className="text-[2rem] font-bold leading-tight tracking-tight">マイページ</h1>

        <div className="mt-8 timeline-card flex items-center gap-5">
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[#07145f] text-2xl font-bold text-white">
            {initial}
          </span>
          <div className="min-w-0">
            <p className="text-xl font-bold text-slate-900 truncate">{user.name}</p>
            <p className="text-sm text-slate-500 truncate">{user.email ?? 'メール未登録'}</p>
          </div>
        </div>

        <dl className="mt-6 timeline-card space-y-4">
          <div className="flex justify-between">
            <dt className="text-sm font-semibold text-slate-500">メールアドレス</dt>
            <dd className="text-sm font-medium text-slate-900">{user.email ?? '未登録'}</dd>
          </div>
          <div className="flex justify-between border-t border-slate-100 pt-4">
            <dt className="text-sm font-semibold text-slate-500">登録日</dt>
            <dd className="text-sm font-medium text-slate-900">{formatDate(user.created_at)}</dd>
          </div>
        </dl>

        <button
          className="mt-8 w-full rounded-2xl border border-rose-200 bg-white py-4 text-sm font-bold text-rose-600 shadow-sm disabled:opacity-50"
          type="button"
          disabled={loggingOut}
          onClick={handleLogout}
        >
          {loggingOut ? 'ログアウト中…' : 'ログアウト'}
        </button>
      </section>
    </main>
  )
}
