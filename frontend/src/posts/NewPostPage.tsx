import { type ChangeEvent, type FormEvent, useState } from 'react'
import { createPost } from '../api/client'
import { useAuth } from '../auth/AuthProvider'
import { reverseGeocode } from './geocode'
import type { CreatePostRequest } from './types'

const initialForm: CreatePostRequest = {
  user_id: '',
  content: '',
  latitude: null,
  longitude: null,
  image_url: null,
}

export function NewPostPage() {
  const { user } = useAuth()
  const [form, setForm] = useState<CreatePostRequest>({
    ...initialForm,
    user_id: user?.id ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [locationEnabled, setLocationEnabled] = useState(false)
  const [locationName, setLocationName] = useState<string | null>(null)
  const [locationLoading, setLocationLoading] = useState(false)

  function selectImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    if (file.size > 1_000_000) {
      setError('画像は1MB以下にしてください')
      return
    }
    const reader = new FileReader()
    reader.onload = () => setForm((current) => ({ ...current, image_url: String(reader.result) }))
    reader.readAsDataURL(file)
  }

  function toggleLocation() {
    if (locationEnabled) {
      setLocationEnabled(false)
      setLocationName(null)
      setForm((current) => ({ ...current, latitude: null, longitude: null }))
      return
    }
    if (!navigator.geolocation) {
      setError('このブラウザでは現在地を取得できません')
      return
    }
    setError(null)
    setLocationLoading(true)
    navigator.geolocation.getCurrentPosition(
      ({ coords }) =>
        void (async () => {
          const next = { latitude: coords.latitude, longitude: coords.longitude }
          setForm((current) => ({ ...current, ...next }))
          setLocationEnabled(true)
          setLocationName(await reverseGeocode(next))
          setLocationLoading(false)
        })(),
      () => {
        setLocationLoading(false)
        setError('現在地を取得できませんでした')
      },
    )
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!form.content.trim()) return
    setSaving(true)
    setError(null)
    try {
      await createPost({ ...form, content: form.content.trim() })
      location.href = '/timeline'
    } catch {
      setError('投稿を保存できませんでした')
    } finally {
      setSaving(false)
    }
  }

  const valid = form.content.trim()

  return (
    <main className="new-post-page min-h-screen bg-[#fbfbfd] text-[#111b54]">
      <header className="sticky top-0 z-10 flex h-[54px] items-center justify-between border-b border-slate-200 bg-white/95 px-4">
        <a
          className="flex items-center gap-2 text-sm tracking-[0.08em] text-[#07156f]"
          href="/timeline"
          aria-label="タイムラインに戻る"
        >
          <span className="grid size-6 place-items-center rounded-lg bg-[#07156f] text-white">
            ◇
          </span>
          <strong>SAFE</strong>
        </a>
        <div className="flex items-center gap-3">
          <a href="/mypage" aria-label="マイページ">
            <span className="grid size-8 place-items-center rounded-full bg-[#07145f] text-xs font-bold text-white">
              {user?.name.slice(0, 1).toUpperCase() ?? '?'}
            </span>
          </a>
          <button
            className={`rounded-full px-5 py-2 text-sm font-bold text-white disabled:opacity-60 ${valid && !saving ? 'bg-[#ff6b00] shadow-md' : 'bg-[#e3e3e8] text-slate-400'}`}
            disabled={!valid || saving}
            type="submit"
            form="new-post-form"
          >
            {saving ? '投稿中' : '投稿'}
          </button>
        </div>
      </header>
      <form className="mx-auto max-w-xl px-8 py-8" id="new-post-form" onSubmit={submit}>
        <div className="flex items-center gap-4">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[#e9e9ed] text-2xl font-bold text-slate-600">
            ◎
          </span>
          <p className="text-xl font-semibold text-slate-700">登録ユーザーとして投稿</p>
        </div>
        <textarea
          className="mt-10 min-h-[360px] w-full resize-none border-0 bg-transparent text-2xl font-medium leading-relaxed outline-none placeholder:text-slate-400"
          placeholder="現在の状況を教えてください…"
          maxLength={1000}
          value={form.content}
          onChange={(e) => setForm({ ...form, content: e.target.value })}
        />
        <label className="mt-8 flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[#c5c5d8] text-center text-slate-600">
          <span className="text-3xl">▧</span>
          <span className="mt-2 font-semibold">写真を追加</span>
          <input className="sr-only" type="file" accept="image/*" onChange={selectImage} />
          {form.image_url && (
            <img className="mt-3 max-h-32 rounded-lg" src={form.image_url} alt="選択した画像" />
          )}
        </label>
        <div className="mt-8 flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <div>
            <p className="text-sm font-bold">現在地</p>
            <p className="text-lg font-semibold">
              {!locationEnabled ? '位置情報なし' : (locationName ?? '位置情報を取得中…')}
            </p>
          </div>
          <button
            className={`relative inline-flex h-8 w-14 shrink-0 appearance-none items-center rounded-full border-0 p-0 transition-colors ${locationEnabled ? 'bg-[#07145f]' : 'bg-slate-300'} ${locationLoading ? 'cursor-wait opacity-70' : ''}`}
            aria-label={locationEnabled ? '位置情報を外す' : '位置情報を付ける'}
            aria-pressed={locationEnabled}
            disabled={locationLoading}
            type="button"
            onClick={toggleLocation}
          >
            <span
              className={`absolute left-1 top-1 h-6 w-6 rounded-full bg-white shadow transition-transform ${locationEnabled ? 'translate-x-6' : 'translate-x-0'}`}
            />
          </button>
        </div>
        {error && <p className="mt-4 text-sm text-rose-700">{error}</p>}
      </form>
    </main>
  )
}
