/** 地図に出す要約（吹き出し）の作り方。
 *
 * ⚠️ 見た目そのものは目視で確かめるしかない。ここで押さえるのは
 * **誤読・取り違えにつながる作り**だけ:
 * 行き先ごとに1つか / 消した経路が残らないか / 未評価区間が落ちないか /
 * 施設名がエスケープされているか / 座標の順が [lon, lat] か。
 */
import { describe, expect, it } from 'vitest'

import type { Bundle, HazardRisk, RouteId, RouteStats } from '../types'
import { pickAnchor, routeCallouts } from './route-callouts'

/** 度で与えた向きの単位ベクトル（0=北、90=東） */
function toward(deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180
  return [Math.sin(rad), Math.cos(rad)]
}

/** 地点 dest へ deg の方向から入ってくる経路の線 */
function lineFrom(deg: number, dest: [number, number] = [139.7774, 35.7141]) {
  const [x, y] = toward(deg)
  const coords: [number, number][] = []
  for (let i = 8; i >= 0; i--) {
    coords.push([dest[0] + x * 0.001 * i, dest[1] + y * 0.001 * i])
  }
  return coords
}

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
    max_depth_m: 0.4,
    mean_depth_m: 0.1,
    ratio_over_03: ratio,
    quake_r4plus_ratio: 0,
    out_of_coverage_ratio: coverage,
  } as unknown as RouteStats
}

function route(id: RouteId, label: string, s: RouteStats) {
  return {
    id,
    no: '',
    label,
    role: 'compare' as const,
    desc: '',
    weight: '',
    stats: s,
    ambiguous_parallel_edges: 0,
  }
}

function bundle(over: Partial<Bundle> = {}): Bundle {
  return {
    scenario: 'envelope',
    scenario_display: '全河川（想定最大）',
    scenario_kind: 'envelope',
    scenario_note: '',
    graph: '',
    tiles: '',
    od: {
      origin: { name: 'o', display: '出発地', latlon: [35.7497, 139.805] },
      dest: { name: 'd', display: '上野駅', latlon: [35.7141, 139.7774] },
      note: '',
      role: null,
    },
    minimax_floor_m: null,
    depth_threshold_m: 0.3,
    routes: [
      route('baseline', '最短経路', stats(1000, 0.2)),
      route('flood', '浸水を考慮', stats(1200, 0.0)),
    ],
    selected_route: 'flood',
    geojson: { type: 'FeatureCollection', features: [] },
    ...over,
  } as unknown as Bundle
}

const shelter = {
  id: 'urgent-1',
  name: '第一小学校',
  type: 'designated' as const,
  type_label: '指定避難所',
  address: '調布市小島町1-8-1',
  municipality: '調布市',
  hazard_types: [],
  hazard_match: false,
  latlon: [35.6501, 139.5412] as [number, number],
  straight_m: 333.1,
  node: 1,
  snap_m: 10,
  rank: 1,
  basis: 'hazard' as const,
  cost: 333,
  baseline_distance_m: 370,
  within_limit: true,
  danger_ratio: 0,
}

describe('routeCallouts', () => {
  it('経路が無いときは何も出さない', () => {
    expect(routeCallouts(null, { shown: {} })).toEqual([])
  })

  it('行き先ごとに1つだけ出す（経路ごとには出さない）', () => {
    const list = routeCallouts(bundle(), { shown: {}, risk: RISK })
    expect(list).toHaveLength(1)
    expect(list[0].html).toContain('最短経路')
    expect(list[0].html).toContain('浸水を考慮')
  })

  it('地図が受け取る座標は [lon, lat]', () => {
    const [callout] = routeCallouts(bundle(), { shown: {} })
    expect(callout.lngLat).toEqual([139.7774, 35.7141])
  })

  it('避難先探索では施設名と種別を見出しにする', () => {
    const [callout] = routeCallouts(bundle({ shelter }), { shown: {} })
    expect(callout.html).toContain('指定避難所')
    expect(callout.html).toContain('第一小学校')
  })

  it('目的地を指定した探索では目的地名を見出しにする', () => {
    const [callout] = routeCallouts(bundle(), { shown: {} })
    expect(callout.html).toContain('上野駅')
  })

  it('選ばれた経路を先に並べる', () => {
    const [callout] = routeCallouts(bundle(), { shown: {} })
    expect(callout.html.indexOf('浸水を考慮')).toBeLessThan(callout.html.indexOf('最短経路'))
  })

  it('消した経路は吹き出しにも出さない', () => {
    const [callout] = routeCallouts(bundle(), { shown: { baseline: false } })
    expect(callout.html).not.toContain('最短経路')
    expect(callout.html).toContain('浸水を考慮')
  })

  it('経路を全部消したら吹き出しごと消す', () => {
    expect(routeCallouts(bundle(), { shown: { baseline: false, flood: false } })).toEqual([])
  })

  it('危険区間の呼び名と割合はAPIのものを使う', () => {
    const [callout] = routeCallouts(bundle(), { shown: {}, risk: RISK })
    expect(callout.html).toContain('浸水30cm超 20.0%')
  })

  it('カタログ未取得のあいだは危険区間を書かない（言い切らない）', () => {
    const [callout] = routeCallouts(bundle(), { shown: {} })
    expect(callout.html).not.toContain('%')
  })

  // ⚠️ 危険区間0%だけを見せると「安全」と読まれる
  it('未評価区間があれば必ず添える', () => {
    const list = routeCallouts(
      bundle({ routes: [route('flood', '浸水を考慮', stats(1200, 0, 0.749))] }),
      { shown: {}, risk: RISK },
    )
    expect(list[0].html).toContain('74.9%は評価範囲外')
  })

  it('もう一方の避難先は別の吹き出しにする', () => {
    const alt = { ...shelter, id: 'urgent-2', name: '多摩川河川敷', type: 'urgent' as const }
    const list = routeCallouts(
      bundle({
        shelter,
        alt_shelter: { ...alt, stats: stats(1490, 0), route: 'shelter_alt' },
      } as Partial<Bundle>),
      { shown: {}, hazardLabel: '地震' },
    )
    expect(list).toHaveLength(2)
    expect(list[1].lngLat).toEqual([139.5412, 35.6501])
    expect(list[1].html).toContain('多摩川河川敷')
    expect(list[1].html).toContain('地震を考慮')
  })

  it('もう一方の避難先を消したらその吹き出しも消す', () => {
    const alt = { ...shelter, id: 'urgent-2', name: '多摩川河川敷' }
    const list = routeCallouts(
      bundle({
        shelter,
        alt_shelter: { ...alt, stats: stats(1490, 0), route: 'shelter_alt' },
      } as Partial<Bundle>),
      { shown: { shelter_alt: false } },
    )
    expect(list).toHaveLength(1)
  })

  // ⚠️ 施設名はAPI由来の文字列。HTMLへそのまま埋めない
  it('施設名をエスケープする', () => {
    const list = routeCallouts(
      bundle({ shelter: { ...shelter, name: '<script>x</script>' } } as Partial<Bundle>),
      { shown: {} },
    )
    expect(list[0].html).not.toContain('<script>')
    expect(list[0].html).toContain('&lt;script&gt;')
  })

  describe('吹き出しを置く向き', () => {
    const routeFeature = (id: RouteId, deg: number, dest?: [number, number]) => ({
      type: 'Feature' as const,
      properties: { kind: 'route' as const, route: id },
      geometry: { type: 'LineString' as const, coordinates: lineFrom(deg, dest) },
    })

    function anchorFor(...features: ReturnType<typeof routeFeature>[]) {
      const list = routeCallouts(
        bundle({
          geojson: { type: 'FeatureCollection', features },
        } as unknown as Partial<Bundle>),
        { shown: {} },
      )
      return list[0].anchor
    }

    // ⚠️ 経路が北から入ってくるのに上へ出すと、線に重なる（2026-08-23の指摘）
    it('北から来た経路の上に置かない', () => {
      expect(anchorFor(routeFeature('flood', 0), routeFeature('baseline', 0))).toBe('bottom')
      expect(anchorFor(routeFeature('flood', 45), routeFeature('baseline', 45))).not.toBe('top')
    })

    // 上が空いているなら上に出す。ピンの高さぶんは別に逃がしてある
    it('上が空いていれば上に置く', () => {
      expect(anchorFor(routeFeature('flood', 180), routeFeature('baseline', 180))).toBe('top')
      expect(anchorFor(routeFeature('flood', 90), routeFeature('baseline', 90))).toBe('top')
    })

    // ⚠️ 2本が別々の方向から入ってくることがある（種類を両方選んだとき）
    it('上下とも経路がいるなら横へ逃がす', () => {
      const anchor = anchorFor(routeFeature('flood', 0), routeFeature('baseline', 180))
      expect(['left', 'right']).toContain(anchor)
    })

    it('経路の線が無ければ上に置く', () => {
      expect(pickAnchor([])).toBe('top')
    })

    // ⚠️ もう一方の避難先は行き先が違うので、線の向き（始点→終点）が逆になりうる
    it('もう一方の避難先は自分の線だけで向きを決める', () => {
      const alt = { ...shelter, id: 'urgent-2', name: '多摩川河川敷' }
      const at: [number, number] = [139.5412, 35.6501]
      const list = routeCallouts(
        bundle({
          shelter,
          alt_shelter: { ...alt, stats: stats(1490, 0), route: 'shelter_alt' },
          geojson: {
            type: 'FeatureCollection',
            features: [routeFeature('flood', 180), routeFeature('shelter_alt', 0, at)],
          },
        } as unknown as Partial<Bundle>),
        { shown: {} },
      )
      expect(list[0].anchor).toBe('top')
      expect(list[1].anchor).toBe('bottom')
    })
  })

  it('地図を覆わないよう並べる経路は3本までにする', () => {
    const list = routeCallouts(
      bundle({
        routes: [
          route('baseline', '最短経路', stats(1000, 0.2)),
          route('flood', '浸水を考慮', stats(1200, 0)),
          route('quake', '地震を考慮', stats(1100, 0.1)),
          route('minimax', '下限', stats(3000, 0)),
        ],
      }),
      { shown: {} },
    )
    expect(list[0].html).not.toContain('下限')
  })
})
