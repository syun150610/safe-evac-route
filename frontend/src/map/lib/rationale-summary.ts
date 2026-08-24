import type { RationaleHazard } from '../types'

/**
 * 一覧で見せる短い評価。
 *
 * APIの数値・詳細文・判定契約は変えず、安定した `verdict` を画面向けに言い換える。
 * 未評価区間を含む場合は「安全」と言い切らない。
 */
export function rationaleSummary(hazard: RationaleHazard): string {
  if (hazard.verdict === 'already_safe') return '評価対象の危険区間はありません'
  if (hazard.verdict === 'avoided') return '評価対象の危険区間を回避しました'
  if (hazard.verdict === 'partial') return '評価対象の危険区間を減らしました'
  return '評価対象の危険区間が残ります'
}
