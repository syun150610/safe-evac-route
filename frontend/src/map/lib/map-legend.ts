/** 地図に重ねている情報の凡例を選ぶ。
 *
 * ⚠️ **「考慮する災害」ではなく「地図に重ねている情報」で選ぶ。** 経路の条件
 * （`state.hazard`）と地図のレイヤー（`state.mapLayer`）は別々に切り替わる。
 * 経路の条件で選ぶと、地図に浸水を出しているのに地震の凡例が出る。
 *
 * ⚠️ **色もラベルもAPI（`/api/hazards` の `hazards[].legend`）が持つ。**
 * ここで書き写さない（`HazardLegend` と同じ規則）。
 */
import type { MapLayerChoice } from '../state/evac-route-state'
import type { HazardCatalog, LegendItem } from '../types'

export interface MapLegend {
  /** 種別名（"地震"）。見出しに使う */
  label: string
  items: LegendItem[]
}

export function legendFor(
  catalog: HazardCatalog | null | undefined,
  layer: MapLayerChoice,
): MapLegend | null {
  if (layer === 'none') return null
  const hazard = catalog?.hazards.find((item) => item.id === layer)
  if (!hazard?.legend?.length) return null
  return { label: hazard.label, items: hazard.legend }
}
