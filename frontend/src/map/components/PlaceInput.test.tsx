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

import { editingSuggestionLayout, PlaceInput, suggestionLayout } from './PlaceInput'

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
const currentButton = () =>
  container.querySelector<HTMLButtonElement>(
    '[aria-label="現在地を出発地にする"], [aria-label="現在地を取得中"]',
  )

describe('PlaceInput', () => {
  it('スマホの入力中は上部固定にし、iOSの自動拡大を防ぐ文字サイズにする', () => {
    render()
    act(() => input()?.focus())
    expect(container.querySelector('[data-editing="true"]')?.className).toContain(
      'max-[899px]:fixed',
    )
    expect(input()?.className).toContain('text-[16px]')
  })

  describe('候補の表示位置', () => {
    it('上部固定中はキーボード直前までを候補領域にする', () => {
      expect(editingSuggestionLayout(68, 0, 560)).toEqual({ above: false, maxHeight: 480 })
    })

    it('キーボードで下側が狭ければ入力欄の上へ出す', () => {
      expect(suggestionLayout(360, 420, 0, 560)).toEqual({ above: true, maxHeight: 248 })
    })

    it('下側に十分な空きがあれば従来どおり下へ出す', () => {
      expect(suggestionLayout(120, 180, 0, 700)).toEqual({ above: false, maxHeight: 248 })
    })

    it('候補の高さを見えている領域に収める', () => {
      expect(suggestionLayout(80, 140, 0, 260)).toEqual({ above: false, maxHeight: 116 })
    })
  })

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

  describe('現在地', () => {
    it('出発地入力のそばにボタンとして置き、押すと取得を始める', () => {
      const onSelect = vi.fn()
      render({ currentLocation: { loading: false, selected: false, onSelect } })
      expect(currentButton()?.textContent).toContain('現在地を使う')
      act(() => currentButton()?.click())
      expect(onSelect).toHaveBeenCalledTimes(1)
    })

    it('取得中は二重に押せない', () => {
      render({ currentLocation: { loading: true, selected: false, onSelect: () => {} } })
      expect(currentButton()?.textContent).toContain('取得中')
      expect(currentButton()?.disabled).toBe(true)
    })

    it('取得後は文字入力ではなく、端末の位置情報を使っている選択表示にする', () => {
      render({
        currentLocation: { loading: false, selected: true, onSelect: () => {} },
        onClear: () => {},
        query: '現在地',
      })
      expect(input()).toBeNull()
      expect(container.textContent).toContain('端末の位置情報を使用中')
      expect(container.querySelector('[aria-label="端末の現在地を選択中"]')).not.toBeNull()
      expect(container.querySelector('[aria-label="出発地を消す"]')).not.toBeNull()
    })

    it('同じ文字列でも端末から取得していなければ通常の入力として扱う', () => {
      render({
        currentLocation: { loading: false, selected: false, onSelect: () => {} },
        query: '現在地',
      })
      expect(input()).not.toBeNull()
      expect(container.textContent).not.toContain('端末の位置情報を使用中')
    })
  })
})
