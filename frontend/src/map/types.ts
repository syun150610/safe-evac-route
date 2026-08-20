import type { FeatureCollection, LineString } from 'geojson'

/** API から受け取るものの型。
 *
 * ⚠️ **形は backend/prep/route_search/bundles.py の出力そのまま。**
 * 表示・指標・判定文がこの形に直結しているので、勝手に整形しない
 * （docs/dev/05_チーム移行案.md §3-1「守るもの」）。
 */

/** 経路の識別子。番号 ①②④⑤ は docs/findings/検証記録.md 10章と対応 */
export type RouteId = 'baseline' | 'flood' | 'combined' | 'quake' | 'minimax'

export type RouteRole = 'recommended' | 'compare' | 'counterexample' | 'bound'

export interface RouteStats {
  distance_m: number
  duration_min_80: number
  duration_min_60: number
  max_depth_m: number
  mean_depth_m: number
  /** 経路長のうち浸水深0.3m（歩行困難ライン）を超える割合 */
  ratio_over_03: number
  /** 地域危険度ランク4以上の町丁目を通る割合 */
  quake_r4plus_ratio: number
  /** **大きいほど「安全」ではなく「評価できていない」** */
  out_of_coverage_ratio: number
  n_edges?: number
}

export interface RouteInfo {
  id: RouteId
  no: string
  label: string
  role: RouteRole
  desc: string
  weight: string
  stats: RouteStats
  ambiguous_parallel_edges: number
  /** POST /search のときだけ。この経路が掛け合わせた種別 */
  hazards?: string[]
}

export interface SegmentProps {
  kind: 'segment'
  route: RouteId
  seq: number
  name: string | null
  length_m: number
  depth_max: number
  depth_mean: number
  /** 1.0=全部が想定範囲内 / 0.0=全部が範囲外 */
  coverage: number
  /** null = この区間は地震の評価範囲外 */
  quake_rank: number | null
  impassable: boolean
}

export interface RouteProps extends RouteStats {
  kind: 'route'
  route: RouteId
  no: string
  label: string
  role: RouteRole
  desc: string
  weight: string
}

export type FeatureProps = SegmentProps | RouteProps

export interface Bundle {
  scenario: string
  scenario_display: string
  scenario_kind: 'envelope' | 'single_basin'
  /** 包絡の説明文。**「全河川が同時に氾濫」と書き換えないこと**（誤り） */
  scenario_note: string
  graph: string
  tiles: string
  od: {
    origin: { name: string; display: string; latlon: [number, number] }
    dest: { name: string; display: string; latlon: [number, number] }
    note: string
    role: 'main' | 'contrast' | null
  }
  /** 距離を無視して浸水深だけを最小化しても、これより下がらない。
   *
   * ⚠️ POST /search で `include` に minimax を入れなかった場合も null になる。
   * 「下限が無い」ではなく「求めていない」なので、出し分けること */
  minimax_floor_m: number | null
  depth_threshold_m: number
  routes: RouteInfo[]
  geojson: FeatureCollection<LineString, FeatureProps>
  /** POST /search のときだけ。選ばれた種別（プリセットには無い） */
  hazards?: Record<string, string>
  /** POST /search のときだけ。掛け合わせで出した経路のID */
  selected_route?: RouteId
}

/** GET /api/evac-routes/area
 *
 * ⚠️ **経路は事前に焼いたグラフの中でしか引けない。** いま焼いてあるのは
 * 北千住↔上野の範囲だけ。外の地点は弾く（06_次セッションへの指示.md §2 (a)）。
 */
export interface Area {
  scenario: string
  /** [left, bottom, right, top] = [lon0, lat0, lon1, lat1] */
  bbox: [number, number, number, number]
  /** [lat, lon] */
  center: [number, number]
  graph: string
  nodes: number | null
  edges: number | null
  /** 最寄りの道までこれ以上離れていたら弾かれる(m) */
  max_snap_m: number
  note: string
}

/** POST /api/evac-routes/search のリクエスト */
export interface SearchRequest {
  origin: { lat: number; lon: number; label?: string }
  dest: { lat: number; lon: number; label?: string }
  /** 種別ID -> variant。flood は浸水シナリオID、quake は "total"。**空なら単純最短** */
  hazards: Record<string, string>
  /** baseline=単純最短 / selected=選んだ種別を掛けた経路 / minimax=下限 */
  include: ('baseline' | 'selected' | 'minimax')[]
  /** 浸水を選ばなかったときに、指標をどの想定図で測るか */
  scenario?: string
}

export interface PresetIndex {
  default_scenario: string
  default_od: string
  scenarios: { id: string; display: string; kind: string; note: string }[]
  od: { slug: string; display: string; role: 'main' | 'contrast' | null }[]
}

/** GET /api/hazards */
export interface HazardScenario {
  id: string
  label: string
  kind: string
  note: string
  tile_url?: string
  vector_url?: string
  legend?: LegendItem[]
}

export interface LegendItem {
  color?: string
  hatch?: boolean
  label: string
  note?: string
  cost_factor?: number
}

export interface Hazard {
  id: string
  label: string
  display_kind: 'raster' | 'vector'
  note: string
  scenarios: HazardScenario[]
  legend?: LegendItem[]
  zoom?: { min: number; max: number }
}

export interface HazardCatalog {
  hazards: Hazard[]
  /** "one_at_a_time" = 同時に出すのは1つ（単位の違うものを重ねない） */
  display_policy: string
  note: string
}

export interface ShelterProperties {
  id: string
  name: string
  type: 'urgent' | 'designated'
  type_label: string
  address: string
  municipality: string
  hazard_types: string[]
}

export interface ShelterFeature {
  type: 'Feature'
  geometry: { type: 'Point'; coordinates: [number, number] }
  properties: ShelterProperties
}

export interface ShelterCollection {
  type: 'FeatureCollection'
  features: ShelterFeature[]
  meta: { total: number }
}
