import { describe, expect, it } from 'vitest'

import type { Area } from '../types'
import { outOfAreaMessage, suggestionAreaStatus } from './useArea'

const area = {
  label: '23区＋多摩の市街化区域',
  bbox: [138.9, 35.5, 140.0, 35.9],
} as Area

describe('suggestionAreaStatus', () => {
  it('座標未取得でも埼玉県と分かれば対象外にする', () => {
    expect(
      suggestionAreaStatus(area, {
        title: '大宮駅',
        address: '埼玉県さいたま市大宮区',
      }),
    ).toBe(false)
  })

  it('国土地理院候補は座標でも対象外を判定する', () => {
    expect(
      suggestionAreaStatus(area, {
        title: '神奈川県横浜市',
        place: { title: '神奈川県横浜市', lat: 35.44, lon: 139.64 },
      }),
    ).toBe(false)
  })

  it('都道府県も座標も無い候補は選択後の判定へ回す', () => {
    expect(suggestionAreaStatus(area, { title: '調布駅', address: '調布市' })).toBeNull()
  })
})

it('API由来の対応地域名でエラーを作る', () => {
  expect(outOfAreaMessage(area, '目的地')).toBe(
    '目的地が検索対象外です。23区＋多摩の市街化区域以外は未対応です。',
  )
})
