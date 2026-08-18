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
import { EvacRouteMap } from './map'
import type { Platform } from './map/hooks/useMapAdapter'

function platformFromUrl(): Platform {
  const p = new URLSearchParams(location.search).get('platform')
  return p === 'maplibre' ? 'maplibre' : 'google'
}

export default function App() {
  return <EvacRouteMap platform={platformFromUrl()} />
}
