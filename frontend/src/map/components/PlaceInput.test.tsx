/** 地点入力のクリアボタン。
 *
 * ⚠️ 確かめるのは1点だけ。**一度決めた地点を、文字を消さずに選び直せること。**
 * これが無かったせいで「ページを再読み込みするしかない」という指摘が出た。
 *
 * 新しい依存を足さないため、jsdom + react-dom/client で直接描いて押す。
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PlaceInput } from './PlaceInput'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(props: Partial<Parameters<typeof PlaceInput>[0]> = {}) {
  act(() => {
    root.render(
      <PlaceInput
        active={false}
        id="test"
        label="出発地"
        onActivate={() => {}}
        onQueryChange={() => {}}
        placeholder="現在地・住所"
        query=""
        {...props}
      />,
    )
  })
}

const clearButton = () => container.querySelector('button')

describe('PlaceInput', () => {
  it('入力があってクリアできるときだけ×を出す', () => {
    render({ query: '上野駅', onClear: () => {} })
    expect(clearButton()).not.toBeNull()
  })

  it('空のときは×を出さない（押せるものが増えるだけ）', () => {
    render({ query: '', onClear: () => {} })
    expect(clearButton()).toBeNull()
  })

  it('onClear が無ければ×を出さない', () => {
    render({ query: '上野駅' })
    expect(clearButton()).toBeNull()
  })

  it('×で onClear を呼ぶ', () => {
    const onClear = vi.fn()
    render({ query: '上野駅', onClear })
    act(() => clearButton()?.click())
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('×はラベル付き（何を消すのか分かるようにする）', () => {
    render({ query: '上野駅', label: '目的地', onClear: () => {} })
    expect(clearButton()?.getAttribute('aria-label')).toBe('目的地を消す')
  })
})
