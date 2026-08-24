import { describe, expect, it } from 'vitest'

import type { RationaleHazard } from '../types'
import { rationaleSummary } from './rationale-summary'

const hazard = {
  verdict: 'already_safe',
  unevaluated_stage: 'none',
} as RationaleHazard

describe('rationaleSummary', () => {
  it.each([
    ['avoided', '危険を回避できました'],
    ['partial', '危険を減らしました'],
    ['unavoidable', '危険を避けきれませんでした'],
  ] as const)('%sを短い評価へ言い換える', (verdict, expected) => {
    expect(rationaleSummary({ ...hazard, verdict })).toBe(expected)
  })

  it('全区間を評価できた場合だけ安全と言い切る', () => {
    expect(rationaleSummary(hazard)).toBe('安全でした')
    expect(rationaleSummary({ ...hazard, unevaluated_stage: 'warn' })).toBe(
      '評価範囲内では安全でした',
    )
  })
})
