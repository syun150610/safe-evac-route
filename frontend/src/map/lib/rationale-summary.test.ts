import { describe, expect, it } from 'vitest'

import type { RationaleHazard } from '../types'
import { rationaleSummary } from './rationale-summary'

const hazard = {
  verdict: 'already_safe',
  unevaluated_stage: 'none',
} as RationaleHazard

describe('rationaleSummary', () => {
  it.each([
    ['avoided', '評価対象の危険区間を回避しました'],
    ['partial', '評価対象の危険区間を減らしました'],
    ['unavoidable', '評価対象の危険区間が残ります'],
  ] as const)('%sを短い評価へ言い換える', (verdict, expected) => {
    expect(rationaleSummary({ ...hazard, verdict })).toBe(expected)
  })

  it('危険区間が無くても安全とは言い切らない', () => {
    expect(rationaleSummary(hazard)).toBe('評価対象の危険区間はありません')
    expect(rationaleSummary({ ...hazard, unevaluated_stage: 'warn' })).toBe(
      '評価対象の危険区間はありません',
    )
  })
})
