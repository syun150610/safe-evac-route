import type { Condition } from '../components/HazardCondition'
import type { SearchRequest, ShelterSearchRequest } from '../types'
import type { Place } from './gsi'

/** 選んだ条件 → APIの `hazards`（種別ID -> variant）。
 *
 * ⚠️ **画面の状態からではなく、渡された条件から作ること。** 条件を切り替えた
 * 直後にReactのstateを読むと更新前の値なので、「新しい種別 ＋ 古い想定」で
 * 投げてしまう。切り替え時は `HazardCondition` が渡す条件をそのまま使う。
 *
 * 地震は焼いてあるのが総合ランクだけなので variant は "total" 固定
 * （`backend/app/services/evac_routes/search.py` の QUAKE_VARIANTS）。
 */
export function buildHazards({ hazard, scenario }: Condition): Record<string, string> {
  return { [hazard]: hazard === 'quake' ? 'total' : scenario }
}

export function buildShelterSearchRequest(
  origin: Place,
  hazards: Record<string, string>,
  scenario: string,
): ShelterSearchRequest {
  return {
    origin: { lat: origin.lat, lon: origin.lon, label: origin.title },
    hazards,
    include: ['baseline', 'selected'],
    scenario,
  }
}

export function buildRouteSearchRequest(
  base: ShelterSearchRequest,
  destination: Place,
): SearchRequest {
  return {
    ...base,
    dest: { lat: destination.lat, lon: destination.lon, label: destination.title },
  }
}
