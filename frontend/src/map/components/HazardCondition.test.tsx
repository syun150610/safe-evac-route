/** 条件の切り替えが「そろった形」で伝わることの確認。
 *
 * ⚠️ ここが壊れると、**新しい種別 ＋ 古い浸水想定**で再検索する。
 * Reactのstateは同じイベント内では更新前の値なので、呼び出し側が
 * state を読み直す作りにすると静かにこうなる。押さえるのはその1点。
 *
 * 新しい依存を足さないため、jsdom + react-dom/client で直接描いて押す
 * （`@testing-library` は入れない）。
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { HazardScenario } from '../types'
import { type Condition, HazardCondition } from './HazardCondition'

const SCENARIOS: HazardScenario[] = [
  { id: 'envelope', label: '全河川（想定最大）', kind: 'envelope', note: '' },
  { id: 'kandagawa', label: '神田川', kind: 'single_basin', note: '' },
  { id: 'sumidagawa', label: '隅田川', kind: 'single_basin', note: '' },
]

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
    root.render(
      <HazardCondition
        busy={busy}
        hazard={condition.hazard}
        onChange={onChange}
        scenario={condition.scenario}
        scenarios={SCENARIOS}
      />,
    )
  })
}

function button(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((b) => b.textContent === text)
  if (!found) throw new Error(`ボタンが見つからない: ${text}`)
  return found as HTMLButtonElement
}

describe('HazardCondition', () => {
  it('種別を切り替えても、選んでいる浸水想定を落とさない', () => {
    const onChange = vi.fn()
    render({ hazard: 'flood', scenario: 'kandagawa' }, onChange)

    act(() => button('地震').click())

    // ⚠️ scenario を落とすと、浸水へ戻したとき既定へ巻き戻る
    expect(onChange).toHaveBeenCalledWith({ hazard: 'quake', scenario: 'kandagawa' })
  })

  it('浸水想定を変えても、選んでいる種別を落とさない', () => {
    const onChange = vi.fn()
    render({ hazard: 'flood', scenario: 'envelope' }, onChange)

    const select = container.querySelector('select') as HTMLSelectElement
    act(() => {
      select.value = 'sumidagawa'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(onChange).toHaveBeenCalledWith({ hazard: 'flood', scenario: 'sumidagawa' })
  })

  it('浸水想定は浸水を選んでいるときだけ出す', () => {
    const onChange = vi.fn()
    render({ hazard: 'quake', scenario: 'envelope' }, onChange)
    expect(container.querySelector('select')).toBeNull()

    render({ hazard: 'flood', scenario: 'envelope' }, onChange)
    expect(container.querySelector('select')).not.toBeNull()
  })

  it('浸水想定の選択肢はAPIが配るものをそのまま出す', () => {
    render({ hazard: 'flood', scenario: 'envelope' }, vi.fn())
    const options = [...container.querySelectorAll('option')].map((o) => o.value)
    expect(options).toEqual(SCENARIOS.map((s) => s.id))
  })

  it('再検索中は切り替えを受け付けない（二重に投げさせない）', () => {
    const onChange = vi.fn()
    render({ hazard: 'flood', scenario: 'envelope' }, onChange, true)

    act(() => button('地震').click())

    expect(onChange).not.toHaveBeenCalled()
    expect((container.querySelector('select') as HTMLSelectElement).disabled).toBe(true)
    expect(container.querySelector('section')?.getAttribute('aria-busy')).toBe('true')
  })

  it('同じ種別を押し直しても、条件は崩れない', () => {
    const onChange = vi.fn()
    render({ hazard: 'flood', scenario: 'kandagawa' }, onChange)

    act(() => button('浸水').click())

    expect(onChange).toHaveBeenCalledWith({ hazard: 'flood', scenario: 'kandagawa' })
  })
})
