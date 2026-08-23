import type { Condition } from '../components/HazardCondition'
import type { ShelterTypeParam } from '../components/ShelterTypePicker'
import type { SearchRequest, ShelterSearchRequest } from '../types'
import type { Place } from './gsi'

/** 浸水の想定図。**「全河川（想定最大）」固定で、利用者には選ばせない**
 * （2026-08-23の判断。理由は `components/HazardCondition.tsx` の冒頭）。
 *
 * ⚠️ **APIからは無くさない。** `/search` は浸水を選んでいないときも
 * 「どの想定図で指標を測るか」にこの値を使う
 * （`backend/app/services/evac_routes/search.py` の DEFAULT_SCENARIO）。
 * フロントから概念ごと消すと、その既定値が暗黙になる。
 */
export const FLOOD_SCENARIO = 'envelope'

/** 選んだ条件 → APIの `hazards`（種別ID -> variant）。
 *
 * ⚠️ **画面の状態からではなく、渡された条件から作ること。** 条件を切り替えた
 * 直後にReactのstateを読むと更新前の値なので、古い条件で投げてしまう。
 * 切り替え時は `HazardCondition` が渡す条件をそのまま使う。
 *
 * 地震は焼いてあるのが総合ランクだけなので variant は "total" 固定
 * （`backend/app/services/evac_routes/search.py` の QUAKE_VARIANTS）。
 */
export function buildHazards({ hazard }: Condition): Record<string, string> {
  return { [hazard]: hazard === 'quake' ? 'total' : FLOOD_SCENARIO }
}

export function buildShelterSearchRequest(
  origin: Place,
  hazards: Record<string, string>,
  scenario: string,
  shelterType: ShelterTypeParam = 'urgent',
): ShelterSearchRequest {
  return {
    origin: { lat: origin.lat, lon: origin.lon, label: origin.title },
    hazards,
    include: ['baseline', 'selected'],
    scenario,
    shelter_type: shelterType,
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
