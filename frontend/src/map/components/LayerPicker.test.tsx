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
      onOpacityChange={() => undefined}
      opacity={0.5}
      value="none"
    />,
  )
}

function renderWithLayer() {
  return renderToStaticMarkup(
    <LayerPicker
      callouts
      onCalloutsChange={() => undefined}
      onChange={() => undefined}
      onOpacityChange={() => undefined}
      opacity={0.5}
      value="flood"
    />,
  )
}

describe('LayerPicker', () => {
  // ⚠️ 濃さは種別ごと。何も重ねていないときに出しても動かす先が無い
  it('重ねているときだけ濃さのつまみを出す', () => {
    expect(renderWithLayer()).toContain('濃さ')
    expect(render(true)).not.toContain('濃さ')
  })

  it('いまの濃さを％で見せる', () => {
    expect(renderWithLayer()).toContain('50%')
  })

  it('経路の要約を消す導線を出す', () => {
    expect(render(true)).toContain('経路の要約を地図に出す')
  })

  // ⚠️ `checked=""` だけを見ない。レイヤーのラジオ（既定は「表示しない」）にも付く
  it('いまの状態をチェックボックスに映す', () => {
    expect(render(true)).toContain('type="checkbox" checked=""')
    expect(render(false)).not.toContain('type="checkbox" checked=""')
  })
})
