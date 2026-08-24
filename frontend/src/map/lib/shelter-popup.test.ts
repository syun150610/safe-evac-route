/** 避難先ピンの詳細。
 *
 * ⚠️ ここで押さえるのは**誤読と事故につながる作り**だけ:
 * 「ここへ行く」の目印があるか / 種別の呼び名がAPI由来か / エスケープしているか。
 */
import { describe, expect, it } from 'vitest'

import type { ShelterProperties } from '../types'
import { GO_ACTION, shelterPopupHtml } from './shelter-popup'

function shelter(over: Partial<ShelterProperties> = {}): ShelterProperties {
  return {
    id: 'urgent-1',
    name: '第一小学校',
    type: 'designated',
    type_label: '指定避難所',
    address: '小島町1-8-1',
    municipality: '調布市',
    hazard_types: [],
    ...over,
  }
}

describe('shelterPopupHtml', () => {
  it('施設名と種別を出す', () => {
    const html = shelterPopupHtml(shelter())
    expect(html).toContain('第一小学校')
    expect(html).toContain('指定避難所')
  })

  it('地図画面の文字サイズ設定を吹き出しにも反映できる', () => {
    const html = shelterPopupHtml(shelter())
    expect(html).toContain('class="map-text-13"')
    expect(html).toContain('class="map-text-10"')
  })

  // ⚠️ アダプタはこの目印でボタンを見つけて `onGo` を繋ぐ。変えると押しても動かない
  it('「ここへ行く」に目印を付ける', () => {
    expect(shelterPopupHtml(shelter())).toContain(`data-action="${GO_ACTION}"`)
  })

  it('自治体名と住所を並べる', () => {
    expect(shelterPopupHtml(shelter())).toContain('調布市 小島町1-8-1')
  })

  // 元データは自治体名込みの住所と、そうでないものが混ざっている
  it('住所が自治体名で始まるなら重ねない', () => {
    const html = shelterPopupHtml(shelter({ address: '調布市小島町1-8-1' }))
    expect(html).toContain('調布市小島町1-8-1')
    expect(html).not.toContain('調布市 調布市')
  })

  // ⚠️ 指定避難所は元データに災害種別の欄が無く、出すと「対応していない」と読める
  it('対応災害は出さない', () => {
    const html = shelterPopupHtml(shelter({ hazard_types: ['quake', 'fire'] }))
    expect(html).not.toContain('quake')
    expect(html).not.toContain('fire')
  })

  it('施設名をエスケープする', () => {
    const html = shelterPopupHtml(shelter({ name: '<img src=x onerror=alert(1)>' }))
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })
})
