import type { FeatureCollection, LineString } from 'geojson'

import type { RouteStyle } from '../constants'
import type { RouteId } from '../types'

/** 折れ線を法線方向にずらす距離の上限。
 *
 * 経路の頂点間隔（概ね10〜50m）より大きくずらすと、折返し付近で線が裏返る。
 * 画面上のpx指定を世界座標へ直す両地図基盤で、同じ安全弁を使う。 */
export const MAX_ROUTE_OFFSET_M = 12

/** Web Mercator の指定緯度・ズームにおける1pxの長さ(m)。 */
export function metersPerPixel(zoom: number, lat: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom
}

/** 折れ線を法線方向に meters だけずらす。
 *
 * 地図ライブラリ固有の `line-offset` は、鋭い折返しで長い突起を作ることがある。
 * Google / MapLibre とも同じ座標変換を通し、見え方と安全弁を揃える。 */
export function offsetPath(coords: number[][], meters: number): number[][] {
  if (!meters) return coords
  const limited = Math.max(-MAX_ROUTE_OFFSET_M, Math.min(MAX_ROUTE_OFFSET_M, meters))
  const out: number[][] = []
  for (let i = 0; i < coords.length; i++) {
    const a = coords[Math.max(0, i - 1)]
    const b = coords[Math.min(coords.length - 1, i + 1)]
    const kx = Math.cos((coords[i][1] * Math.PI) / 180) || 1e-6
    let dx = (b[0] - a[0]) * kx
    let dy = b[1] - a[1]
    const len = Math.hypot(dx, dy)
    if (len === 0) {
      out.push(coords[i].slice())
      continue
    }
    dx /= len
    dy /= len
    const dLat = limited / 111320
    out.push([coords[i][0] + (dy * dLat) / kx, coords[i][1] - dx * dLat])
  }
  return out
}

/** MapLibreへ渡す経路だけを、現在の縮尺に応じて事前にずらす。
 * 区間フィーチャはクリック時の統計参照に使うため、元座標のまま残す。 */
export function offsetRouteCollection(
  geojson: FeatureCollection,
  styleMap: Record<RouteId, RouteStyle>,
  metresPerPixel: number,
): FeatureCollection {
  return {
    ...geojson,
    features: geojson.features.map((feature) => {
      const route = feature.properties?.route as RouteId | undefined
      if (
        feature.properties?.kind !== 'route' ||
        feature.geometry.type !== 'LineString' ||
        !route ||
        !styleMap[route]
      ) {
        return feature
      }
      const geometry = feature.geometry as LineString
      return {
        ...feature,
        geometry: {
          ...geometry,
          coordinates: offsetPath(geometry.coordinates, styleMap[route].offset * metresPerPixel),
        },
      }
    }),
  }
}
