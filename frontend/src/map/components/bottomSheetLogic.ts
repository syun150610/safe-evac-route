import { km } from '../lib/format'
import type { Bundle } from '../types'

const FLING_VELOCITY = 0.45

export interface SheetSummary {
  label: string
  distance: string
  minutes: number
  baselineDelta: number | null
}

export function sheetSummary(bundle: Bundle | null): SheetSummary | null {
  if (!bundle?.routes.length) return null
  const route =
    bundle.routes.find((item) => item.id === bundle.selected_route) ??
    bundle.routes.find((item) => item.role === 'recommended') ??
    bundle.routes[0]
  const baseline = bundle.routes.find((item) => item.id === 'baseline')
  const baselineDelta =
    baseline && baseline.id !== route.id
      ? route.stats.duration_min_60 - baseline.stats.duration_min_60
      : null
  return {
    // ⚠️ **経路の番号（①⑤）を入れない。** 畳んだバーには色の凡例も
    // チェックボックスも並んでいないので、番号だけ見せられても何を指すのか
    // 分からない（2026-08-23の指摘）。言葉だけで完結させる
    label: route.label,
    distance: km(route.stats.distance_m),
    minutes: Math.round(route.stats.duration_min_60),
    baselineDelta: baselineDelta == null ? null : Math.round(baselineDelta),
  }
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
