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
const list = () => container.querySelector('[role="listbox"]')
const input = () => container.querySelector('input')

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

  // ⚠️ 候補が入力から離れていると「予測が遠い」（2026-08-23の指摘）。
  //    入力の直後（DOM順）に置くことで、Tabでもそのまま候補へ入れる
  describe('候補', () => {
    const suggestions = (
      <>
        <button type="button" role="option" aria-selected="false">
          上野駅
        </button>
        <button type="button" role="option" aria-selected="false">
          上野公園
        </button>
      </>
    )

    it('入力中の欄の下にだけ出す', () => {
      render({ active: true, query: '上野', suggestions })
      expect(list()).not.toBeNull()
    })

    it('選んでいない欄の下には出さない', () => {
      render({ active: false, query: '上野', suggestions })
      expect(list()).toBeNull()
    })

    it('候補が無いときは出さない', () => {
      render({ active: true, query: '上野' })
      expect(list()).toBeNull()
    })

    it('入力の直後に置く（Tabでそのまま候補へ入れる）', () => {
      render({ active: true, query: '上野', suggestions })
      const position = input()?.compareDocumentPosition(list() as Node)
      expect(position && position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('読み上げに候補があることを伝える', () => {
      render({ active: true, query: '上野', suggestions })
      expect(input()?.getAttribute('role')).toBe('combobox')
      expect(input()?.getAttribute('aria-expanded')).toBe('true')
      expect(input()?.getAttribute('aria-controls')).toBe(list()?.id)
    })

    it('↓で先頭の候補へ移る', () => {
      render({ active: true, query: '上野', suggestions })
      act(() => input()?.focus())
      act(() => {
        input()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      })
      expect(document.activeElement?.textContent).toBe('上野駅')
    })

    it('Escで入力へ戻す（打ち直せなくならないように）', () => {
      render({ active: true, query: '上野', suggestions })
      const first = list()?.querySelector('button') as HTMLButtonElement
      act(() => first.focus())
      act(() => {
        first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      })
      expect(document.activeElement?.tagName).toBe('INPUT')
    })
  })

  it('×はラベル付き（何を消すのか分かるようにする）', () => {
    render({ query: '上野駅', label: '目的地', onClear: () => {} })
    expect(clearButton()?.getAttribute('aria-label')).toBe('目的地を消す')
  })
})
