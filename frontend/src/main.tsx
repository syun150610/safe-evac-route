import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// ⚠️ 地図ライブラリ本体のCSS。**Tailwind に混ぜず、そのまま読む。**
//    ズームボタン・帰属表示・ポップアップの見た目がこれに依存している
import 'maplibre-gl/dist/maplibre-gl.css'
import './index.css'
import App from './App'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Reactのルート要素が見つかりません')
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
