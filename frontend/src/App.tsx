/** 地図基盤の選択。**既定は Google、利用不能ならMapLibreへ自動退避。**
 *
 * 差はアダプタ（`map/adapters/`）に閉じているので、ここは1行で切り替わる。
 *
 *   /                    Google（既定。キーなし・読込/認証失敗時はMapLibre）
 *   /?platform=maplibre  地理院タイル + MapLibre（**キー不要**）
 *
 * ⚠️ Google はキーが要る（`frontend/.env.local` の `VITE_GOOGLE_MAPS_API_KEY`）。
 * 利用できない場合も地図機能全体を止めず、理由を表示してMapLibreへ切り替える。
 *
 * ログインを求める範囲は `routing.ts` が単独で決める（画面ごとの分岐をここへ書かない）。
 */
import { useEffect, useState } from 'react'

import { AuthPage } from './auth/AuthPage'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import { EvacRouteMap } from './map'
import type { Platform } from './map/hooks/useMapAdapter'
import {
  GOOGLE_MAPS_UNAVAILABLE_EVENT,
  type GoogleMapsUnavailableReason,
  mapsApiKey,
} from './map/lib/google-maps'
import { MyPage } from './mypage/MyPage'
import { NewPostPage } from './posts/NewPostPage'
import { TimelinePage } from './posts/TimelinePage'
import { screenFor } from './routing'

function platformFromUrl(): Platform {
  const p = new URLSearchParams(location.search).get('platform')
  return p === 'maplibre' ? 'maplibre' : 'google'
}

const GOOGLE_FALLBACK_MESSAGE = 'Google Mapsを利用できないため、地理院地図に切り替えました。'

/** Googleの設定・通信・認証のどれかが欠けても、地図機能全体は止めない。 */
function MapPage() {
  const requested = platformFromUrl()
  const missingKey = requested === 'google' && !mapsApiKey()
  const [platform, setPlatform] = useState<Platform>(missingKey ? 'maplibre' : requested)
  const [notice, setNotice] = useState<string | null>(missingKey ? GOOGLE_FALLBACK_MESSAGE : null)

  useEffect(() => {
    const fallback = (event: Event) => {
      const reason = (event as CustomEvent<GoogleMapsUnavailableReason>).detail
      console.warn(`[map] ${reason}のためMapLibreへ切り替えます`)
      setNotice(GOOGLE_FALLBACK_MESSAGE)
      setPlatform('maplibre')
    }
    window.addEventListener(GOOGLE_MAPS_UNAVAILABLE_EVENT, fallback)
    return () => window.removeEventListener(GOOGLE_MAPS_UNAVAILABLE_EVENT, fallback)
  }, [])

  // keyで地図画面を作り直し、利用不能になったGoogle MapのDOM・状態を引き継がない。
  return <EvacRouteMap key={platform} mapNotice={notice} platform={platform} />
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
      return <MapPage />
  }
}

export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  )
}
