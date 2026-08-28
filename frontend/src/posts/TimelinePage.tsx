import { useCallback, useEffect, useRef, useState } from 'react'
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
  const { status: authStatus, user } = useAuth()
  // ⚠️ **空文字で投げない。** `GET /api/posts` の `user_id` は `min_length=1` で、
  //    空だと422になり「投稿を読み込めませんでした」しか出ない（未ログインで再現）。
  //    既定値は API 側も "anonymous"（地図のホームも同じ値で読んでいる）
  const userId = user?.id ?? 'anonymous'
  const [posts, setPosts] = useState<Post[]>([])
  const [sort, setSort] = useState<'recent' | 'nearby' | 'helpful'>('recent')
  const [position, setPosition] = useState<{ latitude: number; longitude: number } | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [locationNames, setLocationNames] = useState<Record<string, string>>({})
  const [sharePostId, setSharePostId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const geocodedIds = useRef(new Set<string>())
  const sharePopupRef = useRef<HTMLDivElement>(null)
  const [expandedPosts, setExpandedPosts] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (sharePostId === null) return
    function handleClickOutside(e: MouseEvent) {
      if (sharePopupRef.current && !sharePopupRef.current.contains(e.target as Node)) {
        setSharePostId(null)
        setCopied(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [sharePostId])

  const copyLink = useCallback(async (postId: string) => {
    const url = `${window.location.origin}/timeline#post-${postId}`
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => {
      setCopied(false)
      setSharePostId(null)
    }, 1500)
  }, [])

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
    if (loading || posts.length === 0) return
    const hash = window.location.hash
    if (!hash) return
    const el = document.querySelector(hash)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [posts, loading])

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
    // ⚠️ **未ログインのまま投げない。** 読み取りは "anonymous" で通るが、
    //    書き込みまで通すと誰の評価か分からないものが積まれる。押しても
    //    エラーだけ出るのでは何が足りないのか分からないので、理由を出す
    if (!user) {
      setError('「役に立った」の登録にはログインが必要です（右上のログインから）')
      return
    }
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
          <strong>Safe Evac Route</strong>
        </a>
        <div className="flex items-center gap-3">
          {/* ⚠️ 閲覧は未ログインでもできる。ここがログインへの導線になる */}
          {authStatus === 'initializing' ? null : user ? (
            <a href="/mypage" aria-label="マイページ">
              <span className="grid size-8 place-items-center rounded-full bg-[#07145f] text-xs font-bold text-white">
                {user.name.slice(0, 1).toUpperCase()}
              </span>
            </a>
          ) : (
            <a
              className="flex h-8 items-center rounded-full border border-slate-200 px-3 text-xs font-bold text-[#07156f]"
              href="/mypage"
            >
              ログイン
            </a>
          )}
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
          {posts.map((post) => {
            const isLong = post.content.split('\n').length > 4 || post.content.length > 150
            const isExpanded = expandedPosts.has(post.id)
            return (
              <article
                className="timeline-card scroll-mt-[62px]"
                id={`post-${post.id}`}
                key={post.id}
              >
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
                    <p
                      className={`mt-4 whitespace-pre-wrap text-[1.05rem] font-medium leading-8 text-slate-900 ${isLong && !isExpanded ? 'line-clamp-4' : ''}`}
                    >
                      {post.content}
                    </p>
                    {isLong && !isExpanded && (
                      <button
                        className="mt-2 text-sm font-semibold text-[#07145f]"
                        type="button"
                        onClick={() => setExpandedPosts((current) => new Set(current).add(post.id))}
                      >
                        詳細を見る
                      </button>
                    )}
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
                      <div className="relative">
                        <button
                          className="text-sm font-semibold text-slate-700"
                          type="button"
                          onClick={() => {
                            setSharePostId(sharePostId === post.id ? null : post.id)
                            setCopied(false)
                          }}
                        >
                          ⌯ 共有
                        </button>
                        {sharePostId === post.id && (
                          <div
                            ref={sharePopupRef}
                            className="absolute bottom-8 left-0 z-10 w-48 rounded-xl border border-slate-200 bg-white p-2 shadow-lg"
                          >
                            <button
                              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                              type="button"
                              onClick={() => void copyLink(post.id)}
                            >
                              {copied ? '✓ コピーしました！' : '🔗 リンクをコピー'}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </article>
            )
          })}
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
