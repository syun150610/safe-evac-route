/** 避難先の種類の選択と、違いの説明。
 *
 * ⚠️ 押さえるのは3点。**片方だけで探せること**、**両方OFFにできないこと**、
 * **違いの説明が出せること**。2種類の役割の違いは利用者がいちばん誤解する
 * ところで、ここが崩れると「逃げ込む先」を探しているのに滞在用の施設を
 * 推してしまう。
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type ShelterKind, ShelterTypePicker, toParam } from './ShelterTypePicker'

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

function render(selected: ShelterKind[], onChange = vi.fn(), busy = false) {
  act(() => {
    root.render(<ShelterTypePicker busy={busy} onChange={onChange} selected={selected} />)
  })
  return onChange
}

function button(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(text))
  if (!found) throw new Error(`ボタンが見つからない: ${text}`)
  return found as HTMLButtonElement
}

describe('toParam', () => {
  it('片方だけならその種類、両方なら all', () => {
    expect(toParam(['urgent'])).toBe('urgent')
    expect(toParam(['designated'])).toBe('designated')
    expect(toParam(['urgent', 'designated'])).toBe('all')
  })
})

describe('ShelterTypePicker', () => {
  it('もう片方を足すと両方になる', () => {
    const onChange = render(['urgent'])
    act(() => button('避難所').click())
    expect(onChange).toHaveBeenCalledWith(['urgent', 'designated'])
  })

  it('両方から片方を外すと、その片方だけになる', () => {
    const onChange = render(['urgent', 'designated'])
    act(() => button('緊急避難場所').click())
    expect(onChange).toHaveBeenCalledWith(['designated'])
  })

  it('⚠️ 最後のひとつは外せない（探す対象が無くなる）', () => {
    const onChange = render(['urgent'])
    act(() => button('緊急避難場所').click())
    expect(onChange).not.toHaveBeenCalled()
  })

  it('選択状態を aria-pressed で示す', () => {
    render(['designated'])
    expect(button('緊急避難場所').getAttribute('aria-pressed')).toBe('false')
    expect(button('避難所').getAttribute('aria-pressed')).toBe('true')
  })

  it('ヘルプを開くと2種類の役割の違いが出る', () => {
    render(['urgent'])
    expect(container.textContent).not.toContain('まず逃げ込む先')

    act(() => button('?').click())

    expect(container.textContent).toContain('指定緊急避難場所')
    expect(container.textContent).toContain('まず逃げ込む先')
    expect(container.textContent).toContain('指定避難所')
    expect(container.textContent).toContain('そのあと生活する先')
    // ⚠️ 指定避難所に災害種別の指定が無いことも書く
    expect(container.textContent).toContain('災害の種類の指定はありません')
  })

  it('ヘルプは閉じられる', () => {
    render(['urgent'])
    act(() => button('?').click())
    act(() => button('?').click())
    expect(container.textContent).not.toContain('まず逃げ込む先')
  })

  it('再検索中は切り替えを受け付けない', () => {
    const onChange = render(['urgent'], vi.fn(), true)
    act(() => button('避難所').click())
    expect(onChange).not.toHaveBeenCalled()
    expect(container.querySelector('section')?.getAttribute('aria-busy')).toBe('true')
  })
})
