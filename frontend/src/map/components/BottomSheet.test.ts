import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MapAdapter } from '../adapters/types'
import type { Bundle, RouteInfo, RouteStats } from '../types'
import { BottomSheet } from './BottomSheet'
import { decideSheet, sheetSummary } from './bottomSheetLogic'

let host: HTMLDivElement | null = null

afterEach(() => {
  host?.remove()
  host = null
})

const stats: RouteStats = {
  distance_m: 5000,
  duration_min_80: 62.5,
  duration_min_60: 83.3,
  max_depth_m: 0.4,
  mean_depth_m: 0.1,
  ratio_over_03: 0.2,
  quake_r4plus_ratio: 0.3,
  out_of_coverage_ratio: 0,
}

function route(overrides: Partial<RouteInfo>): RouteInfo {
  return {
    id: 'baseline',
    no: '①',
    label: '単純最短',
    role: 'compare',
    desc: '',
    weight: '',
    stats,
    ambiguous_parallel_edges: 0,
    ...overrides,
  }
}

describe('sheetSummary', () => {
  it('探索時は選択された経路とベースラインとの差を返す', () => {
    const bundle = {
      selected_route: 'quake',
      routes: [
        route({}),
        route({
          id: 'quake',
          no: '⑤',
          label: '地震のみ',
          stats: { ...stats, distance_m: 5400, duration_min_60: 90.1 },
        }),
      ],
    } as Bundle

    expect(sheetSummary(bundle)).toEqual({
      label: '⑤ 地震のみ',
      distance: '5.40km',
      minutes: 90,
      baselineDelta: 7,
    })
  })
})

describe('decideSheet', () => {
  it('速いスワイプは向きで開閉を決める', () => {
    expect(decideSheet(false, 250, 300, -0.5)).toBe(true)
    expect(decideSheet(true, 30, 300, 0.5)).toBe(false)
  })

  it('ゆっくり動かした場合は移動距離で決める', () => {
    expect(decideSheet(false, 100, 300, 0)).toBe(true)
    expect(decideSheet(false, 250, 300, 0)).toBe(false)
    expect(decideSheet(true, 30, 300, 0)).toBe(true)
    expect(decideSheet(true, 100, 300, 0)).toBe(false)
  })
})

describe('BottomSheet', () => {
  it('上方向のポインター操作で開き、地図ジェスチャを復帰する', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    const lockGestures = vi.fn()
    const onOpenChange = vi.fn()
    const fakeAdapter = {
      lockGestures,
      reserveBottom: vi.fn(),
    } as unknown as MapAdapter
    const adapter = { current: fakeAdapter }

    host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () =>
      root.render(
        createElement(
          BottomSheet,
          { adapter, bundle: null, mobile: true, open: false, onOpenChange },
          createElement('div', null, '設定'),
        ),
      ),
    )

    const button = host.querySelector('button') as HTMLButtonElement
    const body = host.querySelector('#route-sheet-body') as HTMLDivElement
    Object.defineProperty(body, 'offsetHeight', { configurable: true, value: 400 })
    Object.defineProperty(button.parentElement, 'offsetHeight', { configurable: true, value: 474 })
    button.setPointerCapture = vi.fn()

    function pointer(type: string, y: number, time: number) {
      const event = new MouseEvent(type, { bubbles: true, clientX: 100, clientY: y })
      Object.defineProperties(event, {
        pointerId: { value: 1 },
        isPrimary: { value: true },
        timeStamp: { value: time },
      })
      button.dispatchEvent(event)
    }

    await act(async () => {
      pointer('pointerdown', 500, 0)
      pointer('pointermove', 350, 100)
      pointer('pointermove', 150, 150)
      pointer('pointerup', 150, 200)
    })

    expect(onOpenChange).toHaveBeenCalledWith(true)
    expect(lockGestures).toHaveBeenNthCalledWith(1, true)
    expect(lockGestures).toHaveBeenLastCalledWith(false)

    await act(async () => root.unmount())
  })
})
