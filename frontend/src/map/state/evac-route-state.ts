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
    case 'show_route':
      return { ...state, shownRoutes: { ...state.shownRoutes, [action.route]: action.shown } }
    case 'route_ready':
      return {
        ...state,
        screen: 'route',
        searchPurpose: 'route',
        shownRoutes: Object.fromEntries(action.routes.map((id) => [id, true])),
      }
    case 'end_route':
      // ⚠️ **出発地も消す。** 経路と目的地だけ消していた頃は、A地点で検索したあと
      // B地点から調べ直そうとしても出発地がAのまま残り、ホーム画面には
      // 出発地が出ないので気づけず、**ページを再読み込みするしかなかった**
      // （チームからの指摘、2026-08-23）。「終了」は最初の状態に戻すこと
      return {
        ...state,
        screen: 'home',
        searchPurpose: 'route',
        origin: { query: '', place: null },
        destination: { query: '', place: null },
        // 次に開いたとき最初に埋めるのは出発地
        activeField: 'origin',
        shownRoutes: { baseline: true },
      }
  }
}
