import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { MapSearchControl } from './MapSearchControl'

describe('MapSearchControl', () => {
  it('検索ボックスを隠す画面でも検索アイコンを残す', () => {
    const html = renderToStaticMarkup(
      <MapSearchControl compact label="目的地・避難所を検索する" onOpen={() => {}} />,
    )
    expect(html).toContain('aria-label="地点を検索"')
    expect(html).toContain('<svg')
    expect(html).not.toContain('目的地・避難所を検索する')
  })

  it('検索アイコンを押すと検索画面を開く', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const onOpen = vi.fn()
    await act(async () => root.render(<MapSearchControl compact label="" onOpen={onOpen} />))
    await act(async () => host.querySelector<HTMLButtonElement>('button')?.click())
    expect(onOpen).toHaveBeenCalledTimes(1)
    await act(async () => root.unmount())
    host.remove()
  })

  it('ホーム画面では従来どおり検索ボックスの文言を出す', () => {
    const html = renderToStaticMarkup(
      <MapSearchControl compact={false} label="目的地・避難所を検索する" onOpen={() => {}} />,
    )
    expect(html).toContain('目的地・避難所を検索する')
  })
})
