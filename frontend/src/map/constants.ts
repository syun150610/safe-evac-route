/** 経路の色・太さ・描画順。docs/dev/04_デモUI.md D-2 の推奨に合わせる。
 *
 * ⚠️ 番号 ①②④⑤ は docs/findings/検証記録.md 10章と対応させてある。
 * ③（Google徒歩）は規約上出さないので**欠番のまま**。詰めると資料と食い違う。
 */
import type { RouteId } from './types'

export interface RouteStyle {
  color: string
  width: number
  /** 画面px基準の横オフセット（Google側アダプタが m に換算する） */
  offset: number
  dash: [number, number] | null
  casing: boolean
}

export const STYLE: Record<RouteId, RouteStyle> = {
  baseline: { color: '#6b7280', width: 3.5, offset: 5, dash: [2, 1.6], casing: false },
  flood: { color: '#1f6fd0', width: 4.0, offset: 0, dash: null, casing: true },
  combined: { color: '#0b8a3d', width: 5.5, offset: -5, dash: null, casing: true },
  quake: { color: '#d81e1e', width: 4.0, offset: 10, dash: [0.9, 1.1], casing: false },
  minimax: { color: '#7c3aed', width: 3.5, offset: -10, dash: [1.8, 1.5], casing: false },
  // ⚠️ **行き先が違う線。** 避難先の種類を両方選んだときの「もう一方」。
  //    既存の5本と取り違えないよう、色も破線の刻みも変えてある
  shelter_alt: { color: '#b45309', width: 4.0, offset: 15, dash: [3, 2.2], casing: true },
  // もう一方の避難先への最短。⚠️ 灰の破線は `baseline` と同じ意味なので色を揃え、
  // 行き先の違いはオフセットで分ける
  shelter_alt_baseline: {
    color: '#6b7280',
    width: 3.5,
    offset: 20,
    dash: [2, 1.6],
    casing: false,
  },
}

/** 下から上への描画順。④（推奨経路）を最前面にする */
export const DRAW_ORDER: RouteId[] = [
  'minimax',
  'shelter_alt_baseline',
  'shelter_alt',
  'quake',
  'baseline',
  'flood',
  'combined',
]

/** 初期表示。⑤とminimaxは既定OFF（D-2） */
export const INITIAL_ON: Record<RouteId, boolean> = {
  baseline: true,
  // もう一方の種類の経路。比較のために描くので既定ON
  shelter_alt: true,
  shelter_alt_baseline: true,
  flood: true,
  combined: true,
  quake: false,
  minimax: false,
}

/** ⑤は「これが提案経路」と誤解されるのが最悪なので必ず添える */
export const SUFFIX: Partial<Record<RouteId, string>> = {
  quake: '比較用・推奨経路ではない',
  minimax: '距離を無視した下限',
}
