/** 座標まわりの純関数。UIに依存しないのでそのままテストできる。
 *
 * `nearestSegment` は「アダプタが返した経路ID + 座標」から区間を特定する。
 * 当たり判定の作りは地図基盤ごとに違うので、**結果が同じになるところまでを
 * 共通側に置く**（docs/dev/04_デモUI.md D-5）。
 */
import type { Bundle, FeatureProps, SegmentProps } from '../types'

/** 点と線分の距離。度のまま、経度だけ cos(lat) で補正した平面近似で足りる */
export function distToSeg(px: number, py: number, a: number[], b: number[], kx: number): number {
  const ax = a[0] * kx,
    ay = a[1],
    bx = b[0] * kx,
    by = b[1]
  const x = px * kx,
    y = py
  const dx = bx - ax,
    dy = by - ay
  const L2 = dx * dx + dy * dy
  let t = L2 === 0 ? 0 : ((x - ax) * dx + (y - ay) * dy) / L2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy))
}

/** その経路の区間のうち、クリック地点に最も近いもの */
export function nearestSegment(
  bundle: Bundle,
  routeId: string,
  [lng, lat]: [number, number],
): SegmentProps | null {
  let best: SegmentProps | null = null
  let bestD = Infinity
  const kx = Math.cos((lat * Math.PI) / 180) || 1e-6
  for (const f of bundle.geojson.features) {
    const p = f.properties as FeatureProps
    if (p.kind !== 'segment' || p.route !== routeId) continue
    const c = f.geometry.coordinates
    for (let i = 0; i < c.length - 1; i++) {
      const d = distToSeg(lng, lat, c[i], c[i + 1], kx)
      if (d < bestD) {
        bestD = d
        best = p
      }
    }
  }
  return best
}

/** 表示中の経路を囲む bbox。minimax は出していないときは含めない */
export function routeBounds(
  bundle: Bundle,
  shown: Record<string, boolean>,
): [[number, number], [number, number]] | null {
  let w = Infinity,
    s = Infinity,
    e = -Infinity,
    n = -Infinity
  for (const f of bundle.geojson.features) {
    const p = f.properties as FeatureProps
    if (p.kind !== 'route') continue
    if (p.route === 'minimax' && !shown.minimax) continue
    for (const [lng, lat] of f.geometry.coordinates) {
      if (lng < w) w = lng
      if (lng > e) e = lng
      if (lat < s) s = lat
      if (lat > n) n = lat
    }
  }
  return Number.isFinite(w)
    ? [
        [w, s],
        [e, n],
      ]
    : null
}
