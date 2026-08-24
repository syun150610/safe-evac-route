import type { Place } from '../lib/gsi'
import type { RouteId } from '../types'

export type Screen = 'home' | 'search' | 'route' | 'layers'
export type PlaceField = 'origin' | 'destination'
export type SearchPurpose = 'route' | 'shelter'
export type HazardChoice = 'quake' | 'flood'
export type MapLayerChoice = 'none' | HazardChoice

export interface FieldState {
  query: string
  place: Place | null
}

export interface SafeState {
  screen: Screen
  returnScreen: Exclude<Screen, 'layers'>
  searchPurpose: SearchPurpose
  activeField: PlaceField
  origin: FieldState
  destination: FieldState
  hazard: HazardChoice
  scenario: string
  mapLayer: MapLayerChoice
  opacity: number
  shownRoutes: Partial<Record<RouteId, boolean>>
  /** 閉じた吹き出しのID（`dest` / `alt`）。
   *
   * ⚠️ **1つずつ閉じる。** 以前は×で全部消していたが、2つ出ているとき片方だけ
   * 見たい場合に困る（ユーザー指摘、2026-08-24）。
   * ⚠️ **戻す道は行先のピン。** 消したままにしないよう、その避難先のピンを
   * 押せば出し直せる。 */
  hiddenCallouts: string[]
  /** 地図の上に経路の要約（吹き出し）を出すか。
   *
   * ⚠️ **消せるようにしておく。** 吹き出しは避難先のピンの近くに出るので、
   * ピンや経路と重なる場所がどうしても出る（ユーザー指摘、2026-08-23）。
   * 既定はON（要約が見えることが目的の機能なので、既定で隠さない）。 */
  showCallouts: boolean
}

export const initialSafeState: SafeState = {
  screen: 'home',
  returnScreen: 'home',
  searchPurpose: 'route',
  activeField: 'destination',
  origin: { query: '', place: null },
  destination: { query: '', place: null },
  hazard: 'quake',
  scenario: 'envelope',
  mapLayer: 'none',
  opacity: 0.65,
  shownRoutes: { baseline: true },
  showCallouts: true,
  hiddenCallouts: [],
}

export type SafeAction =
  | { type: 'open'; screen: Exclude<Screen, 'layers' | 'search'> }
  | { type: 'open_search'; purpose: SearchPurpose }
  | { type: 'open_layers' }
  | { type: 'close_layers' }
  | { type: 'activate_field'; field: PlaceField }
  | { type: 'edit_field'; field: PlaceField; query: string }
  | { type: 'select_place'; field: PlaceField; place: Place }
  | { type: 'clear_place'; field: PlaceField }
  | { type: 'set_hazard'; hazard: HazardChoice }
  | { type: 'set_scenario'; scenario: string }
  | { type: 'set_layer'; layer: MapLayerChoice }
  | { type: 'set_opacity'; opacity: number }
  | { type: 'show_callouts'; shown: boolean }
  | { type: 'hide_callout'; id: string }
  | { type: 'reveal_callout'; id: string }
  | { type: 'show_route'; route: RouteId; shown: boolean }
  | { type: 'route_ready'; routes: RouteId[] }
  | { type: 'end_route' }

export function safeReducer(state: SafeState, action: SafeAction): SafeState {
  switch (action.type) {
    case 'open':
      return {
        ...state,
        screen: action.screen,
        searchPurpose: 'route',
      }
    case 'open_search':
      return {
        ...state,
        screen: 'search',
        searchPurpose: action.purpose,
        activeField: action.purpose === 'shelter' ? 'origin' : state.activeField,
      }
    case 'open_layers':
      return {
        ...state,
        returnScreen: state.screen === 'layers' ? state.returnScreen : state.screen,
        screen: 'layers',
      }
    case 'close_layers':
      return { ...state, screen: state.returnScreen }
    case 'activate_field':
      return { ...state, activeField: action.field }
    case 'edit_field':
      return {
        ...state,
        activeField: action.field,
        [action.field]: { query: action.query, place: null },
      }
    case 'select_place':
      return {
        ...state,
        activeField: action.field,
        [action.field]: { query: action.place.title, place: action.place },
      }
    case 'clear_place':
      return { ...state, [action.field]: { query: '', place: null } }
    case 'set_hazard':
      return { ...state, hazard: action.hazard }
    case 'set_scenario':
      return { ...state, scenario: action.scenario }
    case 'set_layer':
      return { ...state, mapLayer: action.layer }
    case 'set_opacity':
      return { ...state, opacity: action.opacity }
    case 'show_callouts':
      // ⚠️ まとめて出し直すときは、1つずつ閉じたぶんも戻す
      return { ...state, showCallouts: action.shown, hiddenCallouts: [] }
    case 'hide_callout':
      return state.hiddenCallouts.includes(action.id)
        ? state
        : { ...state, hiddenCallouts: [...state.hiddenCallouts, action.id] }
    case 'reveal_callout':
      return { ...state, hiddenCallouts: state.hiddenCallouts.filter((id) => id !== action.id) }
    case 'show_route':
      return { ...state, shownRoutes: { ...state.shownRoutes, [action.route]: action.shown } }
    case 'route_ready':
      return {
        ...state,
        screen: 'route',
        searchPurpose: 'route',
        shownRoutes: Object.fromEntries(action.routes.map((id) => [id, true])),
        // ⚠️ 新しい結果では吹き出しを出し直す（前の検索で閉じたぶんを引きずらない）
        hiddenCallouts: [],
      }
    case 'end_route':
      // ⚠️ **出発地は残す。** 一度は消していたが、経路を終了するたびに入力し直しに
      // なり、「もう一度探そうとすると発火しない」ように見えた（2026-08-23）。
      // 「前の出発地が残っていることに気づけない」という元の問題は、
      // ホーム画面に出発地を表示し、入力に×を付けたことで別途解決している。
      return {
        ...state,
        screen: 'home',
        searchPurpose: 'route',
        destination: { query: '', place: null },
        activeField: 'destination',
        shownRoutes: { baseline: true },
      }
  }
}
