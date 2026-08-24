/** ⚠️ 目的地を自分で指定した経路の要約に、避難先の種類が混ざらないことの回帰テスト。
 *  種類を変えても結果が変わらないのに書いてあると、関係のある設定に見える。 */
import { describe, expect, it } from 'vitest'
import { conditionSummary } from './condition-summary'

describe('conditionSummary', () => {
  it('避難先を探すときは災害と種類を並べる', () => {
    expect(conditionSummary('地震', ['urgent', 'designated'], true)).toBe(
      '地震を考慮 ・ 緊急避難場所・避難所',
    )
    expect(conditionSummary('浸水', ['urgent'], true)).toBe('浸水を考慮 ・ 緊急避難場所')
  })

  it('目的地を指定した経路では災害だけを書く', () => {
    expect(conditionSummary('地震', ['urgent', 'designated'], false)).toBe('地震を考慮')
    expect(conditionSummary('地震', ['urgent', 'designated'], false)).not.toContain('避難所')
  })
})
