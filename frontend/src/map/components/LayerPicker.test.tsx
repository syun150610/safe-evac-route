/** 地図に重ねるものの設定。
 *
 * ⚠️ ここで押さえるのは**消せること**だけ。吹き出しはピンや経路と重なる場所が
 * どうしても出るので、利用者が自分で消せる導線が無いと逃げ場が無くなる。
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { LayerPicker } from './LayerPicker'

function render(callouts: boolean) {
  return renderToStaticMarkup(
    <LayerPicker
      callouts={callouts}
      onCalloutsChange={() => undefined}
      onChange={() => undefined}
      value="none"
    />,
  )
}

describe('LayerPicker', () => {
  it('経路の要約を消す導線を出す', () => {
    expect(render(true)).toContain('経路の要約を地図に出す')
  })

  // ⚠️ `checked=""` だけを見ない。レイヤーのラジオ（既定は「表示しない」）にも付く
  it('いまの状態をチェックボックスに映す', () => {
    expect(render(true)).toContain('type="checkbox" checked=""')
    expect(render(false)).not.toContain('type="checkbox" checked=""')
  })
})
