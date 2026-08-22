import type { MapViewport } from './types'

/** 地図ライブラリ由来の微小な浮動小数差を丸め、同じviewportの重複通知を抑止する。 */
export function viewportKey({ bbox, zoom }: MapViewport): string {
  const [[west, south], [east, north]] = bbox
  return [west, south, east, north]
    .map((value) => value.toFixed(7))
    .concat(zoom.toFixed(6))
    .join(',')
}
