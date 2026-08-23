/** 地図基盤の選択。**既定は Google。**
 *
 * 差はアダプタ（`map/adapters/`）に閉じているので、ここは1行で切り替わる。
 *
 *   /                    Google（既定）
 *   /?platform=maplibre  地理院タイル + MapLibre（**キー不要**）
 *
 * ⚠️ Google はキーが要る（`frontend/.env.local` の `VITE_GOOGLE_MAPS_API_KEY`）。
 * 無いと地図が出ないので、その場合は `?platform=maplibre` で確認すること。
 */
import { AuthPage } from './auth/AuthPage'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import { EvacRouteMap } from './map'
import type { Platform } from './map/hooks/useMapAdapter'
import { MyPage } from './mypage/MyPage'
import { NewPostPage } from './posts/NewPostPage'
import { TimelinePage } from './posts/TimelinePage'

function platformFromUrl(): Platform {
  const p = new URLSearchParams(location.search).get('platform')
  return p === 'maplibre' ? 'maplibre' : 'google'
}

function AppInner() {
  const { status } = useAuth()

  if (status === 'initializing') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 rounded-full border-2 border-blue-600 border-t-transparent animate-spin" />
      </div>
    )
  }

  if (status === 'unauthenticated') {
    return <AuthPage />
  }

  if (location.pathname === '/timeline') return <TimelinePage />
  if (location.pathname === '/posts/new') return <NewPostPage />
  if (location.pathname === '/mypage') return <MyPage />
  return <EvacRouteMap platform={platformFromUrl()} />
}

export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  )
}
