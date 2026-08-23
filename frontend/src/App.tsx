/** 地図基盤の選択。**既定は Google。**
 *
 * 差はアダプタ（`map/adapters/`）に閉じているので、ここは1行で切り替わる。
 *
 *   /                    Google（既定）
 *   /?platform=maplibre  地理院タイル + MapLibre（**キー不要**）
 *
 * ⚠️ Google はキーが要る（`frontend/.env.local` の `VITE_GOOGLE_MAPS_API_KEY`）。
 * 無いと地図が出ないので、その場合は `?platform=maplibre` で確認すること。
 *
 * ログインを求める範囲は `routing.ts` が単独で決める（画面ごとの分岐をここへ書かない）。
 */
import { AuthPage } from './auth/AuthPage'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import { EvacRouteMap } from './map'
import type { Platform } from './map/hooks/useMapAdapter'
import { MyPage } from './mypage/MyPage'
import { NewPostPage } from './posts/NewPostPage'
import { TimelinePage } from './posts/TimelinePage'
import { screenFor } from './routing'

function platformFromUrl(): Platform {
  const p = new URLSearchParams(location.search).get('platform')
  return p === 'maplibre' ? 'maplibre' : 'google'
}

/** ログインが要る画面へ来た未ログインの人に出す。
 *
 * ⚠️ **地図へ戻る道を必ず残す。** 以前は入口で全部を塞いでいたので戻り先が
 * 無くて良かったが、いまは地図から来る。戻れないと、投稿ボタンを押しただけの
 * 人が行き止まりになる（ブラウザの戻るしか無くなる）。
 *
 * ⚠️ リンクは `AuthPage` の外から重ねる。`AuthPage.tsx` は別のPRが触っている。
 */
function LoginRequired() {
  return (
    <>
      <a
        className="fixed top-3 left-3 z-10 rounded-full border border-slate-200 bg-white/95 px-3 py-1.5 text-xs text-[#07156f] shadow-sm"
        href="/"
      >
        ← 地図に戻る
      </a>
      <AuthPage />
    </>
  )
}

function AppInner() {
  const { status } = useAuth()

  switch (screenFor(location.pathname, status)) {
    case 'loading':
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="w-8 h-8 rounded-full border-2 border-blue-600 border-t-transparent animate-spin" />
        </div>
      )
    case 'login':
      return <LoginRequired />
    case 'timeline':
      return <TimelinePage />
    case 'new-post':
      return <NewPostPage />
    case 'mypage':
      return <MyPage />
    default:
      return <EvacRouteMap platform={platformFromUrl()} />
  }
}

export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  )
}
