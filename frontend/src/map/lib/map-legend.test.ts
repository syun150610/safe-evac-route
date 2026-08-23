/** 地図の凡例をどれにするか。
 *
 * ⚠️ **経路の条件ではなく、地図に重ねているもので選ぶ。** 混同すると、浸水を
 * 重ねているのに地震の凡例が出る。
 */
import { describe, expect, it } from 'vitest'

import type { HazardCatalog } from '../types'
import { legendFor } from './map-legend'

const catalog = {
  hazards: [
    {
      id: 'flood',
      label: '浸水',
      legend: [{ label: '0 〜 0.5m', color: '#cfe8ff' }],
    },
    {
      id: 'quake',
      label: '地震',
      legend: [{ label: '危険度1（相対的に低い）', color: '#2e7d32' }],
    },
    { id: 'fire', label: '火災', legend: [] },
  ],
  display_policy: 'one_at_a_time',
  note: '',
} as unknown as HazardCatalog

describe('legendFor', () => {
  it('重ねている災害の凡例を返す', () => {
    expect(legendFor(catalog, 'quake')).toEqual({
      label: '地震',
      items: [{ label: '危険度1（相対的に低い）', color: '#2e7d32' }],
    })
    expect(legendFor(catalog, 'flood')?.label).toBe('浸水')
  })

  it('何も重ねていなければ無い', () => {
    expect(legendFor(catalog, 'none')).toBeNull()
  })

  // カタログ未取得のあいだに空の箱を出さない
  it('カタログが無ければ無い', () => {
    expect(legendFor(null, 'quake')).toBeNull()
    expect(legendFor(undefined, 'quake')).toBeNull()
  })

  it('凡例を持たない災害では無い', () => {
    expect(legendFor(catalog, 'fire' as 'quake')).toBeNull()
  })
})
