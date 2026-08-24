import { km } from '../lib/format'
import type { Bundle } from '../types'

const FLING_VELOCITY = 0.45

export interface SheetSummary {
  label: string
  distance: string
  minutes: number
  /** APIが返した評価文。詳細はシートを開いて確認する */
  evaluation: string | null
  /** 最短経路との所要差（分）。最短そのものを見ているときは null */
  baselineDelta: number | null
  /** 最短経路との距離差(m)。**「何分余計か」だけでは遠回りの実感が湧かない**
   * ので併記する（2026-08-23の指摘）。同上、最短のときは null */
  baselineDistanceDelta: number | null
}

export function sheetSummary(bundle: Bundle | null): SheetSummary | null {
  if (!bundle?.routes.length) return null
  const route =
    bundle.routes.find((item) => item.id === bundle.selected_route) ??
    bundle.routes.find((item) => item.role === 'recommended') ??
    bundle.routes[0]
  const baseline = bundle.routes.find((item) => item.id === 'baseline')
  const comparable = baseline && baseline.id !== route.id
  const baselineDelta = comparable
    ? route.stats.duration_min_60 - baseline.stats.duration_min_60
    : null
  const baselineDistanceDelta = comparable
    ? route.stats.distance_m - baseline.stats.distance_m
    : null
  return {
    // ⚠️ **経路の番号（①⑤）を入れない。** 畳んだバーには色の凡例も
    // チェックボックスも並んでいないので、番号だけ見せられても何を指すのか
    // 分からない（2026-08-23の指摘）。言葉だけで完結させる
    label: route.label,
    distance: km(route.stats.distance_m),
    minutes: Math.round(route.stats.duration_min_60),
    evaluation: (() => {
      const hazard = bundle.rationale?.hazards.find((item) => item.considered)
      return hazard?.text ?? null
    })(),
    baselineDelta: baselineDelta == null ? null : Math.round(baselineDelta),
    baselineDistanceDelta: baselineDistanceDelta == null ? null : Math.round(baselineDistanceDelta),
  }
}

/** 最短経路との差の言い回し。
 *
 * ⚠️ **記号で言わない**（「①比 +8分」だった）。何と比べたのかを言葉で書く。
 * ⚠️ **距離と所要の両方を出す。** 「+8分」だけでは、どれだけ遠回りして
 *    いるのか実感が湧かない（2026-08-23の指摘）。
 *
 *   最短経路と比べて +0.34km, +8分
 *   最短経路と同じ            （どちらも差が無い）
 *
 * 距離差と所要差は同じ速度から出しているので符号は必ず一致する。
 * 丸めの結果どちらかだけ0になることはあるので、**両方0のときだけ**「同じ」と言う。
 */
export function compareText({ baselineDelta, baselineDistanceDelta }: SheetSummary): string {
  if (baselineDelta == null) return ''
  const km0 = baselineDistanceDelta == null ? 0 : baselineDistanceDelta
  if (baselineDelta === 0 && Math.abs(km0) < 10) return '最短経路と同じ'
  // ⚠️ 符号は2つの差でそろえる。距離が +0.03km なのに所要が「0分」だと、
  //    片方だけ増えたように読める（丸めで分が0になることがある）。
  //    マイナスの値は数値自体が符号を持つので、ここでは足さない
  const detour = km0 > 0 || baselineDelta > 0
  const plus = detour ? '+' : ''
  const parts: string[] = []
  if (Math.abs(km0) >= 10) parts.push(`${plus}${km(km0)}`)
  parts.push(`${plus}${baselineDelta}分`)
  return `最短経路と比べて ${parts.join(', ')}`
}

export function decideSheet(
  open: boolean,
  shift: number,
  travel: number,
  velocity: number,
): boolean {
  if (velocity > FLING_VELOCITY) return false
  if (velocity < -FLING_VELOCITY) return true
  const threshold = Math.min(120, Math.max(40, travel * 0.25))
  return open ? shift < threshold : shift < travel - threshold
}

/** 検索結果が返ったあと、シートを開いたままにするか。
 *
 * ⚠️ **スマホでは畳む。** 開いたままだと地図が隠れて、引いた経路そのものが
 * 見えない（チーム指摘、2026-08-23）。畳んでも `sheetSummary` の要約は残る。
 *
 * ⚠️ **条件の切り替えによる引き直しでは畳まない**（`collapseOnMobile: false`）。
 * 利用者はシートの中を操作している最中なので、押すたびに消えると条件を比べられない。
 *
 * PCは畳まない。地図と並んで表示されており、隠れないため。
 */
export function sheetOpenAfterSearch(mobile: boolean, collapseOnMobile: boolean): boolean {
  return !(mobile && collapseOnMobile)
}
