import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Bundle, RouteId, RouteInfo, RouteStats } from '../types'
import { RouteMessages } from './RouteMessages'

const stats: RouteStats = {
  distance_m: 1000,
  duration_min_80: 12.5,
  duration_min_60: 16.7,
  max_depth_m: 0.4,
  mean_depth_m: 0.1,
  ratio_over_03: 0.2,
  quake_r4plus_ratio: 0.3,
  out_of_coverage_ratio: 0,
}

function route(id: RouteId, no: string, overrides: Partial<RouteStats> = {}): RouteInfo {
  return {
    id,
    no,
    label: id,
    role: id === 'combined' ? 'recommended' : id === 'quake' ? 'counterexample' : 'compare',
    desc: '',
    weight: '',
    stats: { ...stats, ...overrides },
    ambiguous_parallel_edges: 0,
  }
}

const bundle = {
  routes: [
    route('baseline', '①'),
    route('flood', '②', { distance_m: 1050 }),
    route('combined', '④', {
      distance_m: 1100,
      duration_min_80: 13.8,
      ratio_over_03: 0.1,
      quake_r4plus_ratio: 0.2,
    }),
    route('quake', '⑤', {
      max_depth_m: 0.8,
      ratio_over_03: 0.4,
      quake_r4plus_ratio: 0.1,
    }),
  ],
} as Bundle

const hidden = {
  baseline: true,
  flood: true,
  combined: true,
  quake: false,
  minimax: false,
}

function render(messagesBundle: Bundle, quake: boolean): string {
  return renderToStaticMarkup(
    createElement(RouteMessages, {
      bundle: messagesBundle,
      shown: { ...hidden, quake },
    }),
  )
}

describe('RouteMessages', () => {
  it('④の判定文を表示する', () => {
    const html = render(bundle, false)

    expect(html).toContain('推奨は ④（浸水×地震）。')
    expect(html).toContain('★①より浸水・地震のどちらも悪化していない。')
    expect(html).not.toContain('⑤は提案経路ではない。')
  })

  it('⑤を表示しているときだけ警告を表示する', () => {
    const html = render(bundle, true)

    expect(html).toContain('⑤は提案経路ではない。')
    expect(html).toContain('片方のハザードだけを見た場合に何が起きるかを示す比較用。')
  })

  it('④がない探索結果でも⑤の基本警告を表示する', () => {
    const quakeOnly = { ...bundle, routes: [bundle.routes[0], bundle.routes[3]] }
    const html = render(quakeOnly, true)

    expect(html).toContain('⑤は提案経路ではない。')
    expect(html).not.toContain('推奨の④と比べると')
  })
})
