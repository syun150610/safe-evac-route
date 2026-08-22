import { describe, expect, it } from 'vitest'
import { buildRouteSearchRequest, buildShelterSearchRequest } from './search-request'

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
