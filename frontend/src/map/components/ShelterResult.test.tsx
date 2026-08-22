/** 避難先の見せ方の確認。
 *
 * ⚠️ ここで検証するのは「誤読させない形になっているか」だけ。
 * 数値そのものはAPIが決めており、`backend/tests/test_shelter_search.py` が
 * 選び方を押さえている。
 *
 * 新しい依存を足さないため、react-dom/server で文字列に落として見る
 * （RouteRationale.test.tsx と同じやり方）。
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { HazardRisk, RouteStats, ShelterCandidate, ShelterQuery } from '../types'
import { ShelterResult } from './ShelterResult'

const RISK: HazardRisk = {
  label: '浸水30cm超',
  length_key: 'length_over_03_m',
  ratio_key: 'ratio_over_03',
  coverage_key: 'out_of_coverage_ratio',
}

function stats(distance_m: number, ratio: number, coverage = 0): RouteStats {
  return {
    distance_m,
    duration_min_80: distance_m / 80,
    duration_min_60: distance_m / 60,
    max_depth_m: 1.0,
    ratio_over_03: ratio,
    mean_depth_m: 0.2,
    out_of_coverage_ratio: coverage,
    length_over_03_m: distance_m * ratio,
    n_edges: 10,
    n_impassable_edges: 0,
  } as unknown as RouteStats
}

function candidate(over: Partial<ShelterCandidate> & { id: string }): ShelterCandidate {
  return {
    name: `避難所${over.id}`,
    type: 'urgent',
    type_label: '指定緊急避難場所',
    address: '東京都',
    municipality: '江戸川区',
    hazard_types: ['flood'],
    latlon: [35.7, 139.8],
    straight_m: 1000,
    node: 1,
    snap_m: 10,
    rank: 1,
    stats: stats(1500, 0.3),
    basis: 'length',
    cost: 1500,
    baseline_distance_m: 1500,
    within_limit: true,
    ...over,
  }
}

/** 江戸川区平井の実測に対応する形。近くは危険、遠くは安全 */
const NEAR = candidate({ id: 'a', basis: 'length', stats: stats(1562, 0.303, 0.378) })
const FAR = candidate({
  id: 'b',
  basis: 'hazard',
  cost: 7685,
  baseline_distance_m: null,
  within_limit: false,
  stats: stats(6142, 0.045),
})
const OTHER_NEAR = candidate({ id: 'c', basis: 'length', stats: stats(2684, 0.61) })

const QUERY: ShelterQuery = {
  limit: 5,
  type: 'urgent',
  hazard_types: ['flood'],
  pool: 60,
  reachable: 8,
  radius_m: 10000,
  nearest_distance_m: 1562,
  detour_limit_m: 2843,
  detour_ratio: 1.5,
  detour_slack_m: 500,
  fell_back_to_nearest: true,
  at_origin: [],
}

function render(
  candidates: ShelterCandidate[],
  query: ShelterQuery = QUERY,
  chosen = candidates[0],
) {
  const { stats: _stats, ...shelter } = chosen
  return renderToStaticMarkup(
    <ShelterResult
      candidates={candidates}
      onSelect={() => {}}
      query={query}
      risk={RISK}
      shelter={shelter}
    />,
  )
}

describe('ShelterResult', () => {
  it('推奨1件を主役にし、ほかの候補も出す', () => {
    const html = render([NEAR, FAR, OTHER_NEAR])
    expect(html).toContain('おすすめ')
    expect(html).toContain(NEAR.name)
    expect(html).toContain(FAR.name)
    expect(html).toContain(OTHER_NEAR.name)
  })

  it('⚠️ 通し番号の順位を振らない', () => {
    // 別のものさし（ハザードコストと距離）で並んだものを一列の優劣に見せない。
    // 群の見出しで、何で並んでいるかを言う
    const html = render([NEAR, FAR, OTHER_NEAR])
    expect(html).toContain('危険が小さい順')
    expect(html).toContain('近い順')
    expect(html).not.toMatch(/[1-9]位/)
  })

  it('⚠️ 足切りしたことを黙らない', () => {
    const html = render([NEAR, FAR, OTHER_NEAR])
    // 「近所に安全な避難先がある」と読ませないための一文
    expect(html).toContain('いちばん近い避難先を出しています')
    // 上限の外にある候補は、そうと分かるようにする
    expect(html).toContain('遠い')
  })

  it('足切りしていないときは、その注記を出さない', () => {
    const html = render([NEAR, FAR], { ...QUERY, fell_back_to_nearest: false })
    expect(html).not.toContain('いちばん近い避難先を出しています')
  })

  it('⚠️ 未評価区間を落とさない（危険区間の数値だけを見せない）', () => {
    const html = render([NEAR, FAR, OTHER_NEAR])
    expect(html).toContain('評価範囲外')
    expect(html).toContain('安全という意味ではありません')
    expect(html).toContain('37.8%')
  })

  it('危険区間の呼び名はAPIが配るものを使う（種別名を持たない）', () => {
    const html = render([NEAR, FAR])
    expect(html).toContain('浸水30cm超')
    const quake = render([NEAR, FAR], QUERY)
    expect(quake).not.toContain('ratio_over_03')
  })

  it('すでに避難場所にいるときは、そう伝える', () => {
    const html = render([NEAR, FAR], { ...QUERY, at_origin: ['小松川公園'] })
    expect(html).toContain('出発地はすでに小松川公園の場所です')
  })

  it('候補が推奨1件だけでも壊れない', () => {
    const html = render([NEAR], { ...QUERY, fell_back_to_nearest: false })
    expect(html).toContain(NEAR.name)
    expect(html).not.toContain('ほかの候補')
  })
})
