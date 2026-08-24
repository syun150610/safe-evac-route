import { act } from 'react'
import { createRoot } from 'react-dom/client'
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

const alternateCallout: CalloutSpec = {
  ...callout,
  id: 'alternate',
  html: '<strong>第二小学校</strong>',
}

describe('RouteCalloutCards', () => {
  it('地図の地点ではなく画面上のカードとして描く', () => {
    const html = renderToStaticMarkup(<RouteCalloutCards callouts={[callout]} mobile />)
    expect(html).toContain('data-callout-id="dest"')
    expect(html).toContain('経路要約カードを移動')
    expect(html).toContain('この要約を閉じる')
    expect(html.indexOf('経路要約カードを移動')).toBeLessThan(html.indexOf('この要約を閉じる'))
    expect(html).toContain('<svg')
    expect(html).not.toContain('↔')
    expect(html).toContain('第一小学校')
    expect(html).toContain('top:72px')
  })

  it('後から移動操作を始めたカードを最前面にする', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () =>
      root.render(<RouteCalloutCards callouts={[callout, alternateCallout]} mobile />),
    )

    const cards = [...host.querySelectorAll<HTMLElement>('[data-callout-id]')]
    const moveButtons = [
      ...host.querySelectorAll<HTMLButtonElement>('[aria-label="経路要約カードを移動"]'),
    ]

    function startMoving(button: HTMLButtonElement, pointerId: number) {
      button.setPointerCapture = () => undefined
      const event = new MouseEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 100 })
      Object.defineProperties(event, {
        isPrimary: { value: true },
        pointerId: { value: pointerId },
      })
      button.dispatchEvent(event)
    }

    await act(async () => startMoving(moveButtons[0], 1))
    expect(cards[0].style.zIndex).toBe('1')
    expect(cards[1].style.zIndex).toBe('0')

    await act(async () => startMoving(moveButtons[1], 2))
    expect(cards[0].style.zIndex).toBe('0')
    expect(cards[1].style.zIndex).toBe('1')

    await act(async () => root.unmount())
    host.remove()
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

  it('左上の検索ボタンへカードを重ねない', () => {
    expect(
      clampCalloutPosition(
        { x: 12, y: 12 },
        { width: 390, height: 700 },
        { width: 220, height: 140 },
        104,
      ),
    ).toEqual({ x: 12, y: 72 })
  })
})
