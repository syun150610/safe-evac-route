import { describe, expect, it } from 'vitest'
import { distanceKm } from './lib/distance'
import { initialSafeState, safeReducer } from './state'

const ueno = { title: '上野駅', lat: 35.7138, lon: 139.7773 }
const asakusa = { title: '浅草駅', lat: 35.7119, lon: 139.7982 }

describe('safeReducer', () => {
  it('入力と確定地点を同じ操作で更新する', () => {
    const editing = safeReducer(initialSafeState, {
      type: 'edit_field',
      field: 'destination',
      query: '上野',
    })
    expect(editing.destination).toEqual({ query: '上野', place: null })

    const selected = safeReducer(editing, {
      type: 'select_place',
      field: 'destination',
      place: ueno,
    })
    expect(selected.destination).toEqual({ query: '上野駅', place: ueno })
  })

  it('レイヤーを閉じると元の画面へ戻る', () => {
    const route = safeReducer(initialSafeState, { type: 'open', screen: 'route' })
    const layers = safeReducer(route, { type: 'open_layers' })
    expect(layers.screen).toBe('layers')
    expect(safeReducer(layers, { type: 'close_layers' }).screen).toBe('route')
  })

  it('経路終了時は出発地と条件を保ち、目的地だけ解除する', () => {
    let state = safeReducer(initialSafeState, {
      type: 'select_place',
      field: 'origin',
      place: ueno,
    })
    state = safeReducer(state, { type: 'select_place', field: 'destination', place: asakusa })
    state = safeReducer(state, { type: 'set_hazard', hazard: 'flood' })
    const ended = safeReducer(state, { type: 'end_route' })
    expect(ended.origin.place).toBe(ueno)
    expect(ended.destination.place).toBeNull()
    expect(ended.hazard).toBe('flood')
  })
})

describe('distanceKm', () => {
  it('2地点の概算距離をkmで返す', () => {
    expect(distanceKm(ueno, asakusa)).toBeGreaterThan(1)
    expect(distanceKm(ueno, asakusa)).toBeLessThan(3)
  })
})
