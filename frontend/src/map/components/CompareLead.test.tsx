/** 「経路を比較」の要約1行。
 *
 * ⚠️ 押さえるのは**誤読につながる作り**だけ:
 * どちらの避難先の数字か / 最短との比較が両方出るか。
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CompareLead } from './CompareLead'

const base = {
  riskLabel: '危険度4以上',
  afterM: 0,
  beforeM: 4458,
  compare: '最短経路と比べて +0.87km, +8分',
}

describe('CompareLead', () => {
  it('選んだ経路と最短経路の危険区間を並べる', () => {
    const html = renderToStaticMarkup(<CompareLead {...base} />)
    expect(html).toContain('危険度4以上 0m')
    expect(html).toContain('最短経路は4,458m')
  })

  it('最短との差も同じ箱に出す（別のタイルに分けない）', () => {
    expect(renderToStaticMarkup(<CompareLead {...base} />)).toContain(
      '最短経路と比べて +0.87km, +8分',
    )
  })

  it('差が無いときは何も足さない', () => {
    const html = renderToStaticMarkup(<CompareLead {...base} compare="" />)
    expect(html).not.toContain('最短経路と比べて')
  })

  // ⚠️ 避難先が2つ出るとき、この数字はおすすめの避難先についてのもの
  it('避難先が2つのときはどちらの数字か書く', () => {
    const html = renderToStaticMarkup(<CompareLead {...base} shelterName="第一小学校" />)
    expect(html).toContain('第一小学校への経路について')
  })

  it('避難先が1つのときは書かない（読む量を増やさない）', () => {
    expect(renderToStaticMarkup(<CompareLead {...base} />)).not.toContain('への経路について')
  })
})
