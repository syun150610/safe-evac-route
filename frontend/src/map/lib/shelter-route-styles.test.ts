import { describe, expect, it } from 'vitest'

import { SHELTER_KIND_STYLE, STYLE } from '../constants'
import type { Bundle } from '../types'
import { shelterRouteStyles } from './shelter-route-styles'

function bundle(over: Partial<Bundle> = {}): Bundle {
  return {
    selected_route: 'quake',
    shelter: { type: 'designated' },
    alt_shelter: { type: 'urgent' },
    ...over,
  } as Bundle
}

describe('shelterRouteStyles', () => {
  it('それぞれの回避経路を行き先のピンと同じ色にする', () => {
    const styles = shelterRouteStyles(bundle())
    expect(styles.quake.color).toBe(SHELTER_KIND_STYLE.designated.color)
    expect(styles.shelter_alt.color).toBe(SHELTER_KIND_STYLE.urgent.color)
  })

  it('最短経路は比較基準の灰色を維持する', () => {
    const styles = shelterRouteStyles(bundle({ selected_route: 'baseline' }))
    expect(styles.baseline).toEqual(STYLE.baseline)
    expect(styles.shelter_alt_baseline).toEqual(STYLE.shelter_alt_baseline)
  })

  it('避難先探索でなければ従来の経路色を使う', () => {
    expect(shelterRouteStyles(null)).toBe(STYLE)
    expect(shelterRouteStyles(bundle({ shelter: undefined }))).toBe(STYLE)
  })
})
