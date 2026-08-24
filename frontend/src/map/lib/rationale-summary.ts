import type { RationaleHazard } from '../types'

/**
 * 一覧で見せる短い評価。
 *
 * APIの数値・詳細文・判定契約は変えず、安定した `verdict` を画面向けに言い換える。
 * 未評価区間を含む場合は「安全」と言い切らない。
 */
export function rationaleSummary(hazard: RationaleHazard): string {
  if (hazard.verdict === 'already_safe') {
    return hazard.unevaluated_stage === 'none' ? '安全でした' : '評価範囲内では安全でした'
  }
  if (hazard.verdict === 'avoided') return '危険を回避できました'
  if (hazard.verdict === 'partial') return '危険を減らしました'
  return '危険を避けきれませんでした'
}
