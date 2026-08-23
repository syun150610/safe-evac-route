/** 条件の切り替えが「そろった形」で伝わることの確認。
 *
 * ⚠️ 浸水想定（envelope / 神田川 / 隅田川）の選択は**画面から外した**
 * （2026-08-23の判断。理由は `HazardCondition.tsx` の冒頭）。ここでも
 * 「選択UIが出ないこと」を押さえて、うっかり戻さないようにする。
 *
 * 新しい依存を足さないため、jsdom + react-dom/client で直接描いて押す
 * （`@testing-library` は入れない）。
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type Condition, HazardCondition } from './HazardCondition'

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

function render(condition: Condition, onChange: (next: Condition) => void, busy = false) {
  act(() => {
    root.render(<HazardCondition busy={busy} hazard={condition.hazard} onChange={onChange} />)
  })
}

function button(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((b) => b.textContent === text)
  if (!found) throw new Error(`ボタンが見つからない: ${text}`)
  return found as HTMLButtonElement
}

describe('HazardCondition', () => {
  it('種別を切り替えると、次の条件をそろえて渡す', () => {
    const onChange = vi.fn()
    render({ hazard: 'flood' }, onChange)

    act(() => button('地震').click())

    expect(onChange).toHaveBeenCalledWith({ hazard: 'quake' })
  })

  it('⚠️ 浸水想定は選ばせない（全河川固定）', () => {
    render({ hazard: 'flood' }, vi.fn())
    expect(container.querySelector('select')).toBeNull()
  })

  it('地震でも選択UIは増えない', () => {
    render({ hazard: 'quake' }, vi.fn())
    expect(container.querySelector('select')).toBeNull()
  })

  it('再検索中は切り替えを受け付けない（二重に投げさせない）', () => {
    const onChange = vi.fn()
    render({ hazard: 'flood' }, onChange, true)

    act(() => button('地震').click())

    expect(onChange).not.toHaveBeenCalled()
    expect(container.querySelector('section')?.getAttribute('aria-busy')).toBe('true')
  })

  it('同じ種別を押し直しても壊れない', () => {
    const onChange = vi.fn()
    render({ hazard: 'flood' }, onChange)

    act(() => button('浸水').click())

    expect(onChange).toHaveBeenCalledWith({ hazard: 'flood' })
  })
})
