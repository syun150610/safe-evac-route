/** 地図に出す要約（吹き出し）の作り方。
 *
 * ⚠️ 見た目そのものは目視で確かめるしかない。ここで押さえるのは
 * **誤読・取り違えにつながる作り**だけ:
 * 行き先ごとに1つか / 消した経路が残らないか / 未評価区間が落ちないか /
 * 施設名がエスケープされているか / 座標の順が [lon, lat] か。
 */
import { describe, expect, it, vi } from 'vitest'

import type { Bundle, HazardRisk, RouteId, RouteStats } from '../types'
import { calloutPadding, mergePadding, pickAnchor, routeCallouts } from './route-callouts'

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

    // ⚠️ 経路が来ている向きへ出すと線に重なる（2026-08-23の指摘）
    it('経路が来ている向きには置かない', () => {
      expect(['top', 'top-right', 'top-left']).not.toContain(
        anchorFor(routeFeature('flood', 0), routeFeature('baseline', 0)),
      )
      expect(['bottom', 'bottom-right', 'bottom-left']).not.toContain(
        anchorFor(routeFeature('flood', 180), routeFeature('baseline', 180)),
      )
      expect(['right', 'top-right', 'bottom-right']).not.toContain(
        anchorFor(routeFeature('flood', 90), routeFeature('baseline', 90)),
      )
    })

    // ⚠️ 8方位ある。4方位だと斜めから入る経路に逃げ場が無い
    it('斜めから来た経路も避ける', () => {
      // 北東から入ってくるので、南寄りのどこかへ逃げる（東西は出発地の側で決まる）
      expect(['bottom', 'bottom-right', 'bottom-left']).toContain(
        anchorFor(routeFeature('flood', 45), routeFeature('baseline', 45)),
      )
    })

    // ⚠️ 画面は出発地を含むように収めるので、出発地の側には必ず余地がある
    it('経路が同じだけ空いているなら出発地の側へ寄せる', () => {
      // 出発地は目的地から見て北東（fixture の od）
      expect(pickAnchor([], [Math.SQRT1_2, Math.SQRT1_2])).toBe('top-right')
      expect(pickAnchor([], [0, -1])).toBe('bottom')
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
      // 目的地へは南から、もう一方へは北から入るので、避ける向きが逆になる
      expect(['bottom', 'bottom-right', 'bottom-left']).not.toContain(list[0].anchor)
      expect(['top', 'top-right', 'top-left']).not.toContain(list[1].anchor)
    })
  })

  describe('画面に収めるための余白', () => {
    const at = (anchor: 'top' | 'bottom' | 'left' | 'right' | 'bottom-left') => ({
      id: 'dest',
      lngLat: [139.7, 35.7] as [number, number],
      html: '',
      anchor,
    })
    const desktop = { w: 1400, h: 900 }

    // ⚠️ 経路の端がそのまま吹き出しの位置なので、経路だけで収めるとはみ出す
    it('出ている側に足す', () => {
      const padding = calloutPadding([at('bottom')], desktop)
      expect(padding.bottom).toBeGreaterThan(0)
      expect(padding.top).toBe(0)
    })

    // ⚠️ 上下に出すときの箱は**左右中央**。幅の半分ずつ横にもはみ出す
    //    （実機で左端が切れた）
    it('左右中央に出る向きでは横の余白も見る', () => {
      const padding = calloutPadding([at('bottom')], desktop)
      expect(padding.left).toBeGreaterThan(0)
      expect(padding.right).toBeGreaterThan(0)
      expect(padding.left).toBeLessThan(calloutPadding([at('left')], desktop).left)
    })

    it('斜めに出る向きでは2辺に広がる', () => {
      const padding = calloutPadding([at('bottom-left')], desktop)
      expect(padding.bottom).toBeGreaterThan(0)
      expect(padding.left).toBeGreaterThan(0)
      expect(padding.top).toBe(0)
      expect(padding.right).toBe(0)
    })

    // 辺ごとに、いちばん大きく広がる吹き出しに合わせる
    it('複数の吹き出しがあれば辺ごとに大きいほうを取る', () => {
      const both = calloutPadding([at('top'), at('left')], desktop)
      const top = calloutPadding([at('top')], desktop)
      const left = calloutPadding([at('left')], desktop)
      for (const side of ['top', 'right', 'bottom', 'left'] as const) {
        expect(both[side]).toBe(Math.max(top[side], left[side]))
      }
      expect(both.top).toBeGreaterThan(0)
      expect(both.left).toBeGreaterThan(0)
    })

    it('吹き出しが無ければ足さない', () => {
      expect(calloutPadding([], desktop)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })
    })

    // ⚠️ スマホの幅で200px足すと、収める余地が無くなって極端な引きの絵になる
    it('画面が狭いときは頭打ちにする', () => {
      const phone = calloutPadding([at('left'), at('top')], { w: 360, h: 640 })
      expect(phone.left).toBeLessThanOrEqual(360 * 0.3)
      expect(phone.top).toBeLessThanOrEqual(640 * 0.25)
    })

    it('もとの余白とは大きいほうを取る', () => {
      const merged = mergePadding(
        { top: 64, right: 64, bottom: 64, left: 480 },
        { top: 130, right: 0, bottom: 0, left: 200 },
      )
      expect(merged).toEqual({ top: 130, right: 64, bottom: 64, left: 480 })
    })
  })

  // ⚠️ 2つ出ているとき、×でまとめて消えると片方だけ見たい場合に困る
  describe('1つずつ閉じる', () => {
    const withAlt = () =>
      bundle({
        shelter,
        alt_shelter: {
          ...shelter,
          id: 'urgent-2',
          name: '多摩川河川敷',
          stats: stats(1490, 0),
          route: 'shelter_alt',
        },
      } as unknown as Partial<Bundle>)

    it('閉じたものだけ出さない', () => {
      const list = routeCallouts(withAlt(), { shown: {}, hidden: ['dest'] })
      expect(list.map((c) => c.id)).toEqual(['alt'])
    })

    it('閉じていなければ両方出す', () => {
      const list = routeCallouts(withAlt(), { shown: {}, hidden: [] })
      expect(list.map((c) => c.id)).toEqual(['dest', 'alt'])
    })

    // ⚠️ どちらの×が押されたか分からないと、片方だけ閉じられない
    it('×はどの吹き出しかを伝える', () => {
      const onDismiss = vi.fn()
      const list = routeCallouts(withAlt(), { shown: {}, onDismiss })
      list[1].onDismiss?.()
      expect(onDismiss).toHaveBeenCalledWith('alt')
    })

    it('×は地図カード共通の押しやすいスタイルを使う', () => {
      const [callout] = routeCallouts(withAlt(), { shown: {} })
      expect(callout.html).toContain('class="map-card-dismiss"')
      expect(callout.html).not.toContain('width:18px')
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
