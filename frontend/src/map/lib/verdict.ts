/** 指標から出す判定文。
 *
 * ⚠️ **どちらか一方だけを見せないこと**（docs/findings/検証記録.md 9-5）。
 * ODによって「両方改善できる」場合と「トレードオフになる」場合の両方が実在する。
 */
import type { RouteStats } from '../types'

const EPS = 1e-9

/** 「下がる」と書いたのに同値、という文にならないようにする */
export function delta(v: number, base: number, last = false): string {
  if (v < base - EPS) return '下がる'
  if (v > base + EPS) return last ? '悪化する' : '上がる'
  return '変わらない'
}

export type Verdict = 'both_ok' | 'tradeoff_flood_ok' | 'tradeoff_quake_ok' | 'both_worse'

/** ④が①に対して両方改善なのか、片方を犠牲にしているのか */
export function verdictOf(baseline: RouteStats, combined: RouteStats): Verdict {
  const okf = combined.ratio_over_03 <= baseline.ratio_over_03 + EPS
  const okq = combined.quake_r4plus_ratio <= baseline.quake_r4plus_ratio + EPS
  if (okf && okq) return 'both_ok'
  if (okf) return 'tradeoff_flood_ok'
  if (okq) return 'tradeoff_quake_ok'
  return 'both_worse'
}

export const VERDICT_TEXT: Record<Verdict, string> = {
  both_ok: '★①より浸水・地震のどちらも悪化していない。',
  tradeoff_flood_ok:
    'ただしトレードオフ。浸水は下がるが、地震R4以上は①より上がる。このODでは両立しない。',
  tradeoff_quake_ok: 'ただしトレードオフ。地震は下がるが、浸水は①より悪化する。',
  both_worse: 'このODでは①より両方が悪化する。',
}
