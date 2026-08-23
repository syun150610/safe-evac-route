import { describe, expect, it } from 'vitest'
import {
  buildHazards,
  buildRouteSearchRequest,
  buildShelterSearchRequest,
  FLOOD_SCENARIO,
} from './search-request'

const origin = { title: '上野駅', lat: 35.7138, lon: 139.7773 }
const destination = { title: '浅草駅', lat: 35.7119, lon: 139.7982 }

describe('search request builders', () => {
  it('避難先検索は通常検索と同じ条件から目的地だけを除く', () => {
    const request = buildShelterSearchRequest(origin, { quake: 'total' }, 'envelope')
    expect(request).toEqual({
      origin: { lat: 35.7138, lon: 139.7773, label: '上野駅' },
      hazards: { quake: 'total' },
      include: ['baseline', 'selected'],
      scenario: 'envelope',
    })
    expect(request).not.toHaveProperty('dest')
  })

  it('通常検索は共通条件へ目的地を追加する', () => {
    const base = buildShelterSearchRequest(origin, { flood: 'envelope' }, 'envelope')
    expect(buildRouteSearchRequest(base, destination).dest).toEqual({
      lat: 35.7119,
      lon: 139.7982,
      label: '浅草駅',
    })
  })
})

describe('buildHazards', () => {
  it('地震は variant が total 固定（焼いてあるのが総合ランクだけ）', () => {
    expect(buildHazards({ hazard: 'quake' })).toEqual({ quake: 'total' })
  })

  it('⚠️ 浸水は全河川（想定最大）固定。単一河川は選ばせない', () => {
    // 単一河川の想定図は流域の外を評価していないので、流域外を出発地に
    // すると「経路の100%が評価範囲外」になり、危険が無いのか判断材料が
    // 無いのかを読み分けられない（江戸川区平井×神田川で実際にそうなった）
    expect(buildHazards({ hazard: 'flood' })).toEqual({ flood: FLOOD_SCENARIO })
    expect(FLOOD_SCENARIO).toBe('envelope')
  })
})
