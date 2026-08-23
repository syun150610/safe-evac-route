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

  it('経路終了で検索状態をリセットする（出発地も消す）', () => {
    // ⚠️ **以前は出発地を残していた。** そのせいで、A地点で検索したあと
    // B地点から調べ直そうとしても出発地がAのまま残り、ホーム画面には
    // 出発地が出ないので気づけず、ページ再読み込みが要った
    // （チームからの指摘、2026-08-23）。「終了」は最初の状態に戻す
    let state = safeReducer(initialSafeState, {
      type: 'select_place',
      field: 'origin',
      place: ueno,
    })
    state = safeReducer(state, { type: 'select_place', field: 'destination', place: asakusa })
    state = safeReducer(state, { type: 'set_hazard', hazard: 'flood' })
    const ended = safeReducer(state, { type: 'end_route' })

    expect(ended.origin.place).toBeNull()
    expect(ended.origin.query).toBe('')
    expect(ended.destination.place).toBeNull()
    expect(ended.destination.query).toBe('')
    expect(ended.screen).toBe('home')
    // 次に開いたとき最初に埋めるのは出発地
    expect(ended.activeField).toBe('origin')
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
