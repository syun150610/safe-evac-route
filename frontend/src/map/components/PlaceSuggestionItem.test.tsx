import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { PlaceSuggestion } from '../lib/place-search'
import type { Area } from '../types'
import { PlaceSuggestionItem } from './PlaceSuggestionItem'

const area = {
  label: '23区＋多摩の市街化区域',
  bbox: [138.9, 35.5, 140.0, 35.9],
} as Area

function suggestion(overrides: Partial<PlaceSuggestion>): PlaceSuggestion {
  return {
    id: 'place',
    title: '調布駅',
    address: '東京都調布市',
    resolve: async () => ({ title: '調布駅', lat: 35.65, lon: 139.54 }),
    ...overrides,
  }
}

describe('PlaceSuggestionItem', () => {
  it('東京都外と分かる候補は赤字で検索対象外と示し、選べなくする', () => {
    const html = renderToStaticMarkup(
      <PlaceSuggestionItem
        area={area}
        suggestion={suggestion({ title: '大宮駅', address: '埼玉県さいたま市' })}
        onChoose={() => {}}
      />,
    )
    expect(html).toContain('disabled=""')
    expect(html).toContain('検索対象外')
    expect(html).toContain('23区＋多摩の市街化区域以外は未対応です')
    expect(html).toContain('text-red-700')
  })

  it('住所だけでは判定できない候補は、座標確定後の判定のため選べる', () => {
    const html = renderToStaticMarkup(
      <PlaceSuggestionItem
        area={area}
        suggestion={suggestion({ address: '調布市' })}
        onChoose={() => {}}
      />,
    )
    expect(html).not.toContain('disabled=""')
    expect(html).toContain('選択')
  })
})
