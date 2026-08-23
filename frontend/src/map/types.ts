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
  /** 地域危険度4以上の町丁目を通る割合 */
  quake_r4plus_ratio: number
  /** 同 実距離(m)。**静的プリセットには無い**（POST /search のみ） */
  quake_r4plus_m?: number
  /** **大きいほど「安全」ではなく「評価できていない」**（浸水） */
  out_of_coverage_ratio: number
  /** 同（地震）。`hazards[].risk.coverage_key` が指す */
  quake_out_of_coverage_ratio?: number
  /** 危険区間の実距離(m)。`hazards[].risk.length_key` が指す */
  length_over_03_m?: number
  quake_max_rank?: number
  quake_weighted_avg_rank?: number
  n_edges?: number
  n_impassable_edges?: number
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

/** 4条件の判定。
 *
 * avoided=回避成功 / already_safe=最短が既に安全 / partial=部分回避 /
 * unavoidable=回避不可
 */
export type RationaleVerdict = 'avoided' | 'already_safe' | 'partial' | 'unavoidable'

/** 詳細表示（タップ後）の4行。**行数も順番も固定。** */
export interface RationaleDetail {
  route: string
  risk: string
  compare: string
  condition: string
}

/** 種別1つぶんの根拠。
 *
 * ⚠️ **文言(`text` / `detail`)はAPIが単一の出所。** フロントにテンプレートを
 * 持たせないこと（2026-08-21にユーザーと確認）。種別が増えても、増えるのは
 * `backend/prep/hazard_sources/registry.py` の `risk` ブロックだけで、
 * ここは無変更で済む。数値を強調表示したいときのために数値も来る。
 */
export interface RationaleHazard {
  id: string
  /** 種別名（"浸水"） */
  label: string
  /** 危険区間の呼び名（"浸水30cm超" / "危険度4以上"） */
  risk_label: string
  /** 経路の重みに掛けた種別か。false でも数値は来る */
  considered: boolean
  verdict: RationaleVerdict
  /** 最短経路の危険区間(m) */
  before_m: number
  /** 選ばれた経路の危険区間(m) */
  after_m: number
  before_ratio: number
  after_ratio: number
  /** ⚠️ **大きいほど「安全」ではなく「評価できていない」。** 必ず出す */
  unevaluated_ratio: number
  baseline_unevaluated_ratio: number
  /** none=全区間が整備範囲の中 / some=一部が外 / warn=閾値超。
   *
   * ⚠️ **フロントで割合と閾値を比べ直さないこと。** 閾値はAPI側にあり、
   * ここは強調の出し分けにだけ使う */
  unevaluated_stage: 'none' | 'some' | 'warn'
  /** 未評価の伝え方。**3段階とも必ず入る（nullにならない）。**
   * 整備範囲の名前（「想定区域図の整備対象流域」等）が差し込んである */
  unevaluated_note: string
  text: string
  detail: RationaleDetail
}

export interface RationaleDistance {
  baseline_m: number
  selected_m: number
  /** 遠回りぶん。baseline は距離最小なので 0 以上 */
  delta_m: number
  delta_ratio: number
  baseline_min_80: number
  selected_min_80: number
  baseline_min_60: number
  selected_min_60: number
}

/** 「なぜこの経路なのか」。
 *
 * ⚠️ **POST /search のときだけ来る。** プリセットには付かない（静的JSONを
 * バイト列のまま返す契約のため）。種別を1つも選んでいないときも null。
 */
export interface Rationale {
  baseline_route: RouteId
  selected_route: RouteId
  distance: RationaleDistance
  /** 登録済み種別ぶん。`considered` で経路に掛けたかを区別する。
   *
   * ⚠️ **並び替えないこと。** 「全区間評価済みの種別が先、未評価のある種別が後」
   * にAPI側で並べてある（確かなことから先に述べるため） */
  hazards: RationaleHazard[]
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
    // ⚠️ `snap_m` は POST /search のときだけ。指定した地点から**実際に経路が
    // 始まる道路まで**の距離(m)。プリセットには無い
    origin: { name: string; display: string; latlon: [number, number]; snap_m?: number }
    dest: { name: string; display: string; latlon: [number, number]; snap_m?: number }
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
  /** POST /search のときだけ。比較対象が無ければ null（→ 根拠を出さない） */
  rationale?: Rationale | null
  /** POST /search/shelter のときだけ。推奨した避難先。
   * ⚠️ 中身は `shelter_candidates` の該当行から `stats` を抜いたもので、
   * `basis` / `cost` / `rank` も付いてくる。同じ避難所は `id` で突き合わせる */
  shelter?: Omit<ShelterCandidate, 'stats'>
  /** 同。比較材料。**通し番号の順位として見せないこと**（下記） */
  shelter_candidates?: ShelterCandidate[]
  /** 同。どう絞って何で足切りしたか */
  shelter_query?: ShelterQuery
}

/** POST /search/shelter が推奨した避難先。 */
export interface ShelterInfo {
  id: string
  name: string
  type: 'urgent' | 'designated'
  type_label: string
  address: string
  municipality: string
  /** ⚠️ 空でも「対応していない」ではなく「元データに情報が無い」 */
  hazard_types: string[]
  /** この災害への対応が**データ上言えるか**。
   * ⚠️ false は「対応していない」ではなく「登録が無い」。指定避難所は
   * 元データに災害種別の欄そのものが無く、必ず false になる */
  hazard_match: boolean
  /** [lat, lon] */
  latlon: [number, number]
  /** 出発地からの直線距離(m)。歩く距離ではない */
  straight_m: number
  node: number
  /** 施設から最寄りの道までの距離(m) */
  snap_m: number
}

/** 避難先の候補1件。
 *
 * ⚠️ **`cost` を候補どうしで比べないこと。** `basis` が違うと単位が違う。
 * `length` はメートル、`hazard` は `距離 × ハザード係数` で、
 * APIは同じ探索から出たものどうしでしか比べていない
 * （`backend/app/services/evac_routes/shelter_search.py`）。
 *
 * ⚠️ **`rank` は「APIが返した表示順」であって順位ではない。**
 * 並びは 推奨 → 危険が小さい順（`basis: 'hazard'`）→ 近い順（`basis: 'length'`）の
 * 連結で、**全体を貫く一つのものさしが無い**。1位2位…と振ると、
 * 別々のものさしで並べたものを一列の優劣として見せることになる。
 * 画面では `basis` で群を分けて出す。
 */
export interface ShelterCandidate extends ShelterInfo {
  rank: number
  /** その候補へ実際に引いた経路の統計（距離・危険区間・未評価区間） */
  stats: RouteStats
  /** `length`=最短で引いた / `hazard`=ハザード重みで引いた */
  basis: 'length' | 'hazard'
  cost: number
  /** 最短で引いたときの距離(m)。ハザード側だけに出た候補では null */
  baseline_distance_m: number | null
  /** 迂回の上限（`shelter_query.detour_limit_m`）の内側か */
  within_limit: boolean
  /** 経路のうち危険区間の割合（0〜1）。種別ごとの定義はAPIが決める */
  danger_ratio: number
}

export interface ShelterQuery {
  limit: number
  type: string
  hazard_types: string[]
  /** 直線距離で絞ったあとの候補数 */
  pool: number
  /** そのうち経路が引けた数 */
  reachable: number
  radius_m: number
  /** 最短で行ける避難所までの距離(m)。迂回上限の基準 */
  nearest_distance_m: number
  detour_limit_m: number
  detour_ratio: number
  detour_slack_m: number
  /** ⚠️ true = 上限の内側に危険の小さい候補が無く、最短の避難先へ戻した。
   * 「近所に安全な避難先がある」と読ませないため、画面でも触れること */
  fell_back_to_nearest: boolean
  /** 出発地と同じ地点に乗っていた避難場所（すでにその場にいる） */
  at_origin: string[]
  /** ⚠️ true = 上限内の候補がどれも危険区間だらけだった。
   * **推奨は出しているが「ここが安全だ」とは言っていない。** 画面で伝えること */
  all_candidates_dangerous: boolean
  /** 推奨から外す危険区間の割合（0〜1） */
  danger_ratio_limit: number
  /** その災害への登録が無い候補の数（指定避難所） */
  without_hazard_match: number
}

/** GET /api/evac-routes/area
 *
 * ⚠️ **経路は事前に焼いたグラフの中でしか引けない。** 外の地点は弾く。
 * 焼いてある範囲は `bbox`、その**呼び名は `note`** が持つ。
 * ⚠️ 範囲名をフロントへ書き写さないこと。範囲は変わる（2026-08-21に
 * 北千住↔上野 26.7km² → 23区＋多摩の市街化区域 1,324.85km²）。
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

/** POST /api/evac-routes/search/shelter。通常検索から目的地だけを除いた形。
 *
 * ⚠️ **バックの `ShelterSearchRequest` と対になっている**
 * （あちらは `SearchRequest` がこれを継承する）。片方だけ増やさないこと。
 */
export type ShelterSearchRequest = Omit<SearchRequest, 'dest'>

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

/** 危険区間の呼び名と、`routes[].stats` のどのキーを読むか。
 *
 * ⚠️ **キー名をフロントで対応表にしない。** 種別ごとに違い（浸水 `ratio_over_03` /
 * 地震 `quake_r4plus_ratio`）、対応表を持つと種別追加のたびに修正が要る。
 * 出所は `backend/prep/hazard_sources/registry.py` の `risk` ブロック。
 *
 * ⚠️ **`coverage_key` を無視しない。** 危険区間が0%でも、その経路の大半が整備範囲の
 * 外なら「安全」ではなく「判断材料が無い」。実測で経路の74.9%が範囲外のODがある。
 */
export interface HazardRisk {
  /** 危険区間の呼び名（"浸水30cm超" / "危険度4以上"） */
  label: string
  /** 危険区間の距離(m) が入っている stats のキー */
  length_key: string
  /** 同 割合(0〜1) */
  ratio_key: string
  /** 未評価区間の割合(0〜1) */
  coverage_key: string
}

export interface Hazard {
  id: string
  label: string
  display_kind: 'raster' | 'vector'
  note: string
  scenarios: HazardScenario[]
  risk?: HazardRisk
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
