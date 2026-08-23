import { useEffect, useRef, useState } from 'react'
import { getPosts, markPostHelpful } from '../api/client'
import { useAuth } from '../auth/AuthProvider'
import { reverseGeocode } from './geocode'
import type { Post } from './types'

function relativeDate(value: string) {
  const iso = value.replace(' ', 'T')
  const date = new Date(/[Z+]/.test(iso.slice(-6)) ? iso : `${iso}Z`)
  const minutes = Math.floor((Date.now() - date.getTime()) / 60000)
  if (minutes < 1) return 'たった今'
  if (minutes < 60) return `${minutes}分前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}時間前`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}日前`
  return date.toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function TimelinePage() {
  const { user } = useAuth()
  const userId = user?.id ?? ''
  const [posts, setPosts] = useState<Post[]>([])
  const [sort, setSort] = useState<'recent' | 'nearby' | 'helpful'>('recent')
  const [position, setPosition] = useState<{ latitude: number; longitude: number } | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [locationNames, setLocationNames] = useState<Record<string, string>>({})
  const geocodedIds = useRef(new Set<string>())

  function load(reset: boolean) {
    setLoading(true)
    void getPosts({
      limit: 10,
      offset: reset ? 0 : posts.length,
      sort,
      latitude: position?.latitude,
      longitude: position?.longitude,
      userId: userId,
    })
      .then((result) => {
        setPosts((current) => (reset ? result.items : [...current, ...result.items]))
        setHasMore(result.has_more)
      })
      .catch(() => setError('投稿を読み込めませんでした'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    setLoading(true)
    void getPosts({
      limit: 10,
      offset: 0,
      sort,
      latitude: position?.latitude,
      longitude: position?.longitude,
      userId: userId,
    })
      .then((result) => {
        setPosts(result.items)
        setHasMore(result.has_more)
      })
      .catch(() => setError('投稿を読み込めませんでした'))
      .finally(() => setLoading(false))
  }, [sort, position, userId])

  useEffect(() => {
    const pending = posts.filter(
      (post) => post.latitude != null && !geocodedIds.current.has(post.id),
    )
    for (const post of pending.slice(0, 10)) {
      geocodedIds.current.add(post.id)
      void reverseGeocode(post)
        .then((name) => {
          if (name) setLocationNames((current) => ({ ...current, [post.id]: name }))
        })
        .catch(() => undefined)
    }
  }, [posts])

  function nearby() {
    if (!navigator.geolocation) {
      setError('このブラウザでは現在地を取得できません')
      return
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setSort('nearby')
        setPosition({ latitude: coords.latitude, longitude: coords.longitude })
      },
      () => setError('現在地を取得できませんでした'),
    )
  }

  async function helpful(post: Post) {
    try {
      const updated = await markPostHelpful(post.id, userId)
      setPosts((current) => current.map((item) => (item.id === updated.id ? updated : item)))
    } catch {
      setError('評価を保存できませんでした')
    }
  }

  return (
    <main className="timeline-page min-h-screen bg-[#f8f8fb] pb-24 text-[#111b54]">
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
        <div className="flex items-center gap-3">
          <a href="/mypage" aria-label="マイページ">
            <span className="grid size-8 place-items-center rounded-full bg-[#07145f] text-xs font-bold text-white">
              {user?.name.slice(0, 1).toUpperCase() ?? '?'}
            </span>
          </a>
          <a
            className="flex h-[30px] items-center rounded-full bg-[#ff6b00] px-4 text-xs font-bold text-white"
            href="/posts/new"
            aria-label="新規投稿を作成"
          >
            ✎ 投稿
          </a>
        </div>
      </header>
      <section className="mx-auto max-w-xl px-5 pt-7">
        <p className="mb-2 text-sm font-bold tracking-[0.22em] text-[#ff6b00]">COMMUNITY REPORTS</p>
        <h1 className="text-[2.2rem] font-bold leading-tight tracking-tight">みんなの声</h1>
        <p className="mt-3 text-lg leading-relaxed text-slate-600">
          近隣のユーザーからの最新の被害状況や安全情報を確認できます。
        </p>
        <nav className="mt-6 flex gap-2 overflow-x-auto pb-1" aria-label="投稿の並び替え">
          <button
            className={`whitespace-nowrap rounded-full px-5 py-3 text-sm font-bold ${sort === 'recent' ? 'bg-[#d7d7e4]' : 'border-2 border-[#d7d7e4]'}`}
            type="button"
            onClick={() => setSort('recent')}
          >
            ◷ 新着順
          </button>
          <button
            className={`whitespace-nowrap rounded-full px-5 py-3 text-sm font-semibold ${sort === 'helpful' ? 'bg-[#d7d7e4]' : 'border-2 border-[#d7d7e4]'}`}
            type="button"
            onClick={() => setSort('helpful')}
          >
            ☷ 話題
          </button>
          <button
            className={`whitespace-nowrap rounded-full px-5 py-3 text-sm font-semibold ${sort === 'nearby' ? 'bg-[#d7d7e4]' : 'border-2 border-[#d7d7e4]'}`}
            type="button"
            onClick={nearby}
          >
            ⌖ 現在地付近
          </button>
        </nav>
        {error && (
          <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
        )}
        <div className="mt-7 space-y-4">
          {loading && posts.length === 0 && <p className="text-sm text-slate-500">読み込み中…</p>}
          {!loading && posts.length === 0 && (
            <p className="text-sm text-slate-500">該当する投稿はありません。</p>
          )}
          {posts.map((post) => (
            <article className="timeline-card" key={post.id}>
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#e9e9ed] text-lg font-bold text-slate-600">
                  {post.user_name.slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h2 className="font-semibold text-slate-900">{post.user_name}</h2>
                      <time className="text-sm text-slate-600">
                        {relativeDate(post.created_at)}{' '}
                        {locationNames[post.id] ?? (post.latitude != null ? '位置情報あり' : '')}
                      </time>
                    </div>
                  </div>
                  <p className="mt-4 whitespace-pre-wrap text-[1.05rem] font-medium leading-8 text-slate-900">
                    {post.content}
                  </p>
                  {post.image_url && (
                    <img
                      className="mt-4 max-h-80 w-full rounded-xl object-cover"
                      src={post.image_url}
                      alt="投稿画像"
                    />
                  )}
                  <div className="mt-5 flex items-center gap-5 border-t border-slate-200 pt-4">
                    <button
                      className={`text-sm font-semibold ${post.helpful ? 'text-[#07145f]' : 'text-slate-700'}`}
                      type="button"
                      onClick={() => void helpful(post)}
                    >
                      {post.helpful ? '♥' : '♡'} 役に立った ({post.helpful_count})
                    </button>
                    <button className="text-sm font-semibold text-slate-700" type="button">
                      ⌯ 共有
                    </button>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
        {hasMore && (
          <button
            className="block w-full py-8 text-center text-sm font-semibold text-[#07145f] disabled:opacity-50"
            type="button"
            disabled={loading}
            onClick={() => load(false)}
          >
            さらに読み込む
          </button>
        )}
      </section>
    </main>
  )
}
