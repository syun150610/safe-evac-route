import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MapAdapter } from '../adapters/types'
import type { Bundle, RouteInfo, RouteStats } from '../types'
import { BottomSheet } from './BottomSheet'
import { compareText, decideSheet, sheetOpenAfterSearch, sheetSummary } from './bottomSheetLogic'

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
      // ⚠️ 経路番号（①⑤）は入れない。畳んだバーには色の凡例もチェックボックスも
      //    並んでいないので、番号だけ見せられても何を指すのか分からない
      label: '地震のみ',
      distance: '5.40km',
      minutes: 90,
      baselineDelta: 7,
      baselineDistanceDelta: 400,
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

describe('sheetOpenAfterSearch', () => {
  it('⚠️ スマホでは結果が返ったら畳む（地図が隠れて経路が見えない）', () => {
    expect(sheetOpenAfterSearch(true, true)).toBe(false)
  })

  it('PCでは畳まない（地図と並んでいて隠れない）', () => {
    expect(sheetOpenAfterSearch(false, true)).toBe(true)
  })

  it('⚠️ 条件の切り替えによる引き直しでは、スマホでも畳まない', () => {
    // シートの中を操作している最中なので、押すたびに消えると条件を比べられない
    expect(sheetOpenAfterSearch(true, false)).toBe(true)
  })
})

/** 畳んだ状態のシートを描いて、見出し部分のHTMLを返す */
function renderCollapsed(bundle: Bundle, conditionLabel?: string): string {
  const host = document.createElement('div')
  document.body.append(host)
  const adapter = {
    current: { lockGestures: vi.fn(), reserveBottom: vi.fn() } as unknown as MapAdapter,
  }
  const root = createRoot(host)
  act(() =>
    root.render(
      createElement(BottomSheet, {
        adapter,
        bundle,
        conditionLabel,
        mobile: true,
        open: false,
        onOpenChange: vi.fn(),
      }),
    ),
  )
  const html = host.innerHTML
  act(() => root.unmount())
  host.remove()
  return html
}

describe('畳んだシートの見出し', () => {
  // 最短より400m・7分遠回りする経路（差の言い回しを見るため）。
  // ⚠️ 距離と所要は同じ速度から出るので、片方だけ動かした固定値は現実に無い
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

  it('⚠️ 経路番号（①⑤）を出さない', () => {
    const html = renderCollapsed(bundle)
    expect(html).not.toContain('⑤')
    expect(html).not.toContain('①')
  })

  it('⚠️ 「①比」ではなく、何と比べたかを言葉で書く', () => {
    const html = renderCollapsed(bundle)
    expect(html).not.toContain('①比')
    expect(html).toContain('最短経路と比べて')
  })

  it('渡された条件ラベルを見出しに使う（災害の呼び名はAPI由来）', () => {
    const html = renderCollapsed(bundle, '地震を考慮')
    expect(html).toContain('地震を考慮')
    expect(html).not.toContain('地震のみ')
  })

  it('⚠️ 距離差も出す（何分余計かだけでは遠回りの実感が湧かない）', () => {
    const html = renderCollapsed(bundle)
    expect(html).toContain('最短経路と比べて +0.40km, +7分')
  })

  it('差が無ければ「同じ」と言う', () => {
    const same = {
      selected_route: 'quake',
      routes: [
        route({}),
        route({ id: 'quake', label: '地震のみ', stats: { ...stats, duration_min_60: 83 } }),
      ],
    } as Bundle
    expect(renderCollapsed(same)).toContain('最短経路と同じ')
  })
})

describe('compareText', () => {
  const base = { label: '', distance: '', minutes: 0 }

  it('距離と所要を並べる', () => {
    expect(compareText({ ...base, baselineDelta: 8, baselineDistanceDelta: 341 })).toBe(
      '最短経路と比べて +0.34km, +8分',
    )
  })

  it('どちらも差が無ければ「同じ」', () => {
    expect(compareText({ ...base, baselineDelta: 0, baselineDistanceDelta: 0 })).toBe(
      '最短経路と同じ',
    )
  })

  it('丸めで0分になっても、距離に差があれば黙らない', () => {
    // 30m の遠回りは 0.5分。分だけ見ると「同じ」に見えてしまう
    expect(compareText({ ...base, baselineDelta: 0, baselineDistanceDelta: 30 })).toBe(
      '最短経路と比べて +0.03km, +0分',
    )
  })

  it('10m未満の差は距離を出さない（丸めのノイズ）', () => {
    expect(compareText({ ...base, baselineDelta: 0, baselineDistanceDelta: 4 })).toBe(
      '最短経路と同じ',
    )
  })

  it('最短そのものを見ているときは何も言わない', () => {
    expect(compareText({ ...base, baselineDelta: null, baselineDistanceDelta: null })).toBe('')
  })
})
