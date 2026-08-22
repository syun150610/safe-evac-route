import type { Place } from './lib/gsi'
import type { RouteId } from './types'

export type Screen = 'home' | 'search' | 'route' | 'layers'
export type PlaceField = 'origin' | 'destination'
export type HazardChoice = 'quake' | 'flood'
export type MapLayerChoice = 'none' | HazardChoice

export interface FieldState {
  query: string
  place: Place | null
}

export interface SafeState {
  screen: Screen
  returnScreen: Exclude<Screen, 'layers'>
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
  | { type: 'open'; screen: Exclude<Screen, 'layers'> }
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
      return { ...state, screen: action.screen }
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
        shownRoutes: Object.fromEntries(action.routes.map((id) => [id, true])),
      }
    case 'end_route':
      return {
        ...state,
        screen: 'home',
        destination: { query: '', place: null },
        activeField: 'destination',
        shownRoutes: { baseline: true },
      }
  }
}
