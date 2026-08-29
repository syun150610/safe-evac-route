import { useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { AuthApiError } from '../auth/api'

function formatDate(value: string) {
  const iso = value.replace(' ', 'T')
  return new Date(/[Z+]/.test(iso.slice(-6)) ? iso : `${iso}Z`).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export function MyPage() {
  const { user, logout, updateUser } = useAuth()
  const [loggingOut, setLoggingOut] = useState(false)
  const [editing, setEditing] = useState(false)
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [editSuccess, setEditSuccess] = useState(false)

  async function handleLogout() {
    setLoggingOut(true)
    try {
      await logout()
    } finally {
      setLoggingOut(false)
    }
  }

  function openEdit() {
    setNewName(user?.name ?? '')
    setNewEmail(user?.email ?? '')
    setCurrentPassword('')
    setNewPassword('')
    setEditError(null)
    setEditSuccess(false)
    setEditing(true)
  }

  function cancelEdit() {
    setEditing(false)
    setEditError(null)
  }

  async function handleSave() {
    if (!user) return
    const body: {
      name?: string
      email?: string
      current_password?: string
      new_password?: string
    } = {}
    if (newName && newName !== user.name) body.name = newName
    if (newEmail !== (user.email ?? '')) body.email = newEmail
    if (newPassword) {
      body.current_password = currentPassword
      body.new_password = newPassword
    }
    if (Object.keys(body).length === 0) {
      setEditing(false)
      return
    }
    setSaving(true)
    setEditError(null)
    try {
      await updateUser(body)
      setEditSuccess(true)
      setEditing(false)
    } catch (err) {
      if (err instanceof AuthApiError) {
        setEditError(typeof err.detail === 'string' ? err.detail : '保存に失敗しました')
      } else {
        setEditError('保存に失敗しました')
      }
    } finally {
      setSaving(false)
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
          <strong>Safe Evac Route</strong>
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

        <div className="timeline-card mt-8 flex items-center gap-5">
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[#07145f] text-2xl font-bold text-white">
            {initial}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xl font-bold text-slate-900">{user.name}</p>
            <p className="truncate text-sm text-slate-500">{user.email ?? 'メール未登録'}</p>
          </div>
          <button
            className="shrink-0 rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-[#07156f]"
            type="button"
            onClick={openEdit}
          >
            編集
          </button>
        </div>

        {editSuccess && (
          <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            プロフィールを更新しました
          </p>
        )}

        {editing && (
          <div className="timeline-card mt-4 space-y-4">
            <h2 className="text-sm font-bold text-slate-700">プロフィールを編集</h2>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-500" htmlFor="edit-name">
                ユーザー名
              </label>
              <input
                id="edit-name"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-[#07156f] focus:outline-none"
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="半角英数字・_ ・- で3〜20文字"
                autoComplete="username"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-500" htmlFor="edit-email">
                メールアドレス
              </label>
              <input
                id="edit-email"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-[#07156f] focus:outline-none"
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="example@example.com"
                autoComplete="email"
              />
            </div>

            <div className="space-y-3 border-t border-slate-100 pt-4">
              <p className="text-xs font-semibold text-slate-500">
                パスワード変更（変更しない場合は空欄）
              </p>
              <div className="space-y-1">
                <label
                  className="text-xs font-semibold text-slate-500"
                  htmlFor="edit-current-password"
                >
                  現在のパスワード
                </label>
                <input
                  id="edit-current-password"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-[#07156f] focus:outline-none"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-500" htmlFor="edit-new-password">
                  新しいパスワード
                </label>
                <input
                  id="edit-new-password"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-[#07156f] focus:outline-none"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="8文字以上"
                  autoComplete="new-password"
                />
              </div>
            </div>

            {editError && (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{editError}</p>
            )}

            <div className="flex gap-3 pt-1">
              <button
                className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-bold text-slate-600 disabled:opacity-50"
                type="button"
                onClick={cancelEdit}
                disabled={saving}
              >
                キャンセル
              </button>
              <button
                className="flex-1 rounded-xl bg-[#07156f] py-2.5 text-sm font-bold text-white disabled:opacity-50"
                type="button"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? '保存中…' : '保存する'}
              </button>
            </div>
          </div>
        )}

        <dl className="timeline-card mt-6 space-y-4">
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
