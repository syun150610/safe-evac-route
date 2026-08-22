import type { BBox, MapViewport } from '../adapters/types'
import type { Area, ShelterFeature } from '../types'

export const MIN_SHELTER_ZOOM = 13

/** bbox内か。経度が日付変更線をまたぐ場合（west > east）にも対応する。 */
export function pointInBbox([lon, lat]: [number, number], [[west, south], [east, north]]: BBox) {
  const inLongitude = west <= east ? west <= lon && lon <= east : west <= lon || lon <= east
  return inLongitude && south <= lat && lat <= north
}

/** 経路探索可能エリア内か。area未取得中は安全側に倒して表示しない。 */
function pointInArea([lon, lat]: [number, number], area: Area | null) {
  if (!area) return false
  const [left, bottom, right, top] = area.bbox
  return left <= lon && lon <= right && bottom <= lat && lat <= top
}

/** 現在のviewportに避難所ピンを表示するか。 */
export function shelterIsVisible(
  feature: ShelterFeature,
  viewport: MapViewport,
  area: Area | null,
): boolean {
  if (viewport.zoom < MIN_SHELTER_ZOOM) return false
  return (
    pointInArea(feature.geometry.coordinates, area) &&
    pointInBbox(feature.geometry.coordinates, viewport.bbox)
  )
}
