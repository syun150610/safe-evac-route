import { describe, expect, it } from 'vitest'
import { initialSafeState, safeReducer } from './evac-route-state'

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

  it('避難先検索を開くと出発地入力へ切り替わる', () => {
    const state = safeReducer(initialSafeState, { type: 'open_search', purpose: 'shelter' })
    expect(state.screen).toBe('search')
    expect(state.searchPurpose).toBe('shelter')
    expect(state.activeField).toBe('origin')
  })

  it('経路終了で経路と目的地を解除し、出発地は残す', () => {
    // ⚠️ **一度は出発地も消していたが、戻した**（2026-08-23）。終了のたびに
    // 入力し直しになり、「もう一度探そうとすると発火しない」ように見えた。
    // 「前の出発地が残っていることに気づけない」という元の問題は、
    // ホーム画面に出発地を表示し、入力に×を付けたことで別途解決している
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
    expect(ended.destination.query).toBe('')
    expect(ended.screen).toBe('home')
    // ⚠️ 選んだ災害は残す。地点をやり直すたびに条件まで戻ると使いにくい
    expect(ended.hazard).toBe('flood')
  })

  it('地点を個別に消せる（出発地だけ選び直す）', () => {
    let state = safeReducer(initialSafeState, {
      type: 'select_place',
      field: 'origin',
      place: ueno,
    })
    state = safeReducer(state, { type: 'select_place', field: 'destination', place: asakusa })
    const cleared = safeReducer(state, { type: 'clear_place', field: 'origin' })

    expect(cleared.origin.place).toBeNull()
    expect(cleared.origin.query).toBe('')
    // 目的地は巻き込まない
    expect(cleared.destination.place).toBe(asakusa)
  })
})
