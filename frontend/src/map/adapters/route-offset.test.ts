import type { FeatureCollection } from 'geojson'
import { describe, expect, it } from 'vitest'

import type { RouteStyle } from '../constants'
import type { RouteId } from '../types'
import { MAX_ROUTE_OFFSET_M, offsetPath, offsetRouteCollection } from './route-offset'

const styles = {
  baseline: { color: '#666', width: 3, offset: 0, dash: null, casing: false },
  quake: { color: '#07156f', width: 5, offset: 20, dash: null, casing: true },
} as unknown as Record<RouteId, RouteStyle>

const feature = (kind: 'route' | 'segment', route: RouteId) => ({
  type: 'Feature' as const,
  properties: { kind, route },
  geometry: {
    type: 'LineString' as const,
    coordinates: [
      [139.8, 35.75],
      [139.79, 35.74],
      [139.8, 35.75],
    ],
  },
})

describe('経路の座標オフセット', () => {
  it('鋭い折返しでも指定上限より遠くへ飛ばさない', () => {
    const original = [
      [139.78, 35.73],
      [139.79, 35.74],
      [139.78001, 35.73001],
    ]
    const shifted = offsetPath(original, 1000)
    const metres = shifted.map((point, index) =>
      Math.hypot(
        (point[0] - original[index][0]) * 111320 * Math.cos((original[index][1] * Math.PI) / 180),
        (point[1] - original[index][1]) * 111320,
      ),
    )
    expect(Math.max(...metres)).toBeLessThanOrEqual(MAX_ROUTE_OFFSET_M * 1.001)
  })

  it('表示する経路だけをずらし、統計参照用の区間は変えない', () => {
    const route = feature('route', 'quake' as RouteId)
    const segment = feature('segment', 'quake' as RouteId)
    const data = { type: 'FeatureCollection', features: [route, segment] } as FeatureCollection
    const rendered = offsetRouteCollection(data, styles, 4)

    expect(rendered.features[0].geometry).not.toEqual(route.geometry)
    expect(rendered.features[1]).toBe(segment)
    expect(data.features[0]).toBe(route)
  })

  it('オフセット0の経路は元座標のままにする', () => {
    const route = feature('route', 'baseline' as RouteId)
    const data = { type: 'FeatureCollection', features: [route] } as FeatureCollection
    const rendered = offsetRouteCollection(data, styles, 4)
    expect(rendered.features[0].geometry).toEqual(route.geometry)
  })
})
