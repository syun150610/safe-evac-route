/** 比較カードが「APIの配る呼び名とキー」で描かれることの確認。
 *
 * ⚠️ **種別ごとの文字列や統計キーをこの部品に書かせない**ための回帰テスト。
 * 以前は `hazard === 'quake' ? '地震R4以上' : '0.3m超区間'` と分岐していて、
 * 災害を増やすたびに修正が要る状態だった。
 *
 * ⚠️ **未評価の但し書きを落とさない。** 危険区間0%でも大半が整備範囲の外なら
 * 「安全」ではなく「判断材料が無い」。閾値の判定はAPI（`unevaluated_stage`）に任せ、
 * ここでは「warn のときだけ出る」ことだけを見る。
 *
 * 新しい依存を足さないため、react-dom/server で文字列に落として見る。
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { Bundle, HazardRisk, Rationale, RouteStats } from '../types'
import { RouteTable } from './RouteTable'

const QUAKE_RISK: HazardRisk = {
  label: '危険度4以上',
  length_key: 'quake_r4plus_m',
  ratio_key: 'quake_r4plus_ratio',
  coverage_key: 'quake_out_of_coverage_ratio',
}

function stats(over: Partial<RouteStats> = {}): RouteStats {
  return {
    distance_m: 19910,
    duration_min_80: 249,
    duration_min_60: 332,
    max_depth_m: 4.68,
    mean_depth_m: 0.3,
    ratio_over_03: 0.216,
    quake_r4plus_ratio: 0.068,
    quake_r4plus_m: 1354,
    out_of_coverage_ratio: 0,
    quake_out_of_coverage_ratio: 0,
    ...over,
  }
}

const BUNDLE = {
  selected_route: 'quake',
  routes: [
    { id: 'baseline', no: '①', label: '単純最短', stats: stats() },
    {
      id: 'quake',
      no: '⑤',
      label: '地震のみ',
      stats: stats({ distance_m: 22300, duration_min_60: 372, quake_r4plus_ratio: 0 }),
    },
  ],
} as unknown as Bundle

const HAZARD = {
  id: 'quake',
  label: '地震',
  risk_label: '危険度4以上',
  considered: true,
  after_m: 0,
  unevaluated_stage: 'none',
} as unknown as Rationale['hazards'][number]

const DISTANCE = {
  baseline_min_60: 332,
  selected_min_60: 372,
} as unknown as Rationale['distance']

const render = (props: Partial<Parameters<typeof RouteTable>[0]> = {}) =>
  renderToStaticMarkup(
    <RouteTable
      bundle={BUNDLE}
      shown={{}}
      risk={QUAKE_RISK}
      hazard={HAZARD}
      distance={DISTANCE}
      onToggle={() => {}}
      {...props}
    />,
  )

describe('RouteTable', () => {
  it('危険区間の呼び名と割合をAPIのキーから描く', () => {
    const html = render()
    expect(html).toContain('危険度4以上 6.8%')
    expect(html).toContain('危険度4以上 0.0%')
    // 種別を書き分けていた頃の文字列が復活していないこと
    expect(html).not.toContain('地震R4以上')
    expect(html).not.toContain('0.3m超区間')
  })

  it('表示中でない種別の指標を出さない', () => {
    // 地震を考慮しているのに「最大浸水深」を出していた（実際に画面へ出ていた）
    expect(render()).not.toContain('最大浸水深')
  })

  it('未評価の但し書きは warn のときだけ出す', () => {
    const uneval = { quake_out_of_coverage_ratio: 0.749 }
    const routes = BUNDLE.routes.map((r) => ({ ...r, stats: { ...r.stats, ...uneval } }))
    const bundle = { ...BUNDLE, routes } as unknown as Bundle

    const quiet = render({ bundle })
    expect(quiet).not.toContain('評価範囲外')

    const warned = render({
      bundle,
      hazard: { ...HAZARD, unevaluated_stage: 'warn' } as typeof HAZARD,
    })
    expect(warned).toContain('74.9%は評価範囲外')
  })

  it('根拠が無いときは指標タイルを出さない', () => {
    const html = render({ hazard: null, distance: null })
    expect(html).not.toContain('最短との差')
    expect(html).toContain('単純最短')
  })
})
