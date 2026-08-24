import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { CalloutSpec } from '../adapters/types'
import { clampCalloutPosition, RouteCalloutCards } from './RouteCalloutCards'

const callout: CalloutSpec = {
  id: 'dest',
  lngLat: [139.7, 35.7],
  anchor: 'top',
  html: '<strong>第一小学校</strong>',
}

describe('RouteCalloutCards', () => {
  it('地図の地点ではなく画面上のカードとして描く', () => {
    const html = renderToStaticMarkup(<RouteCalloutCards callouts={[callout]} mobile />)
    expect(html).toContain('data-callout-id="dest"')
    expect(html).toContain('経路要約カードを移動')
    expect(html).toContain('この要約を閉じる')
    expect(html.indexOf('経路要約カードを移動')).toBeLessThan(html.indexOf('この要約を閉じる'))
    expect(html).toContain('第一小学校')
  })

  it('ドラッグ位置を画面内へ収める', () => {
    expect(
      clampCalloutPosition(
        { x: -100, y: 900 },
        { width: 390, height: 700 },
        { width: 220, height: 140 },
        104,
      ),
    ).toEqual({ x: 12, y: 456 })
  })
})
