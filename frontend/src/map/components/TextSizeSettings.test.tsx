import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TextSizeSettings } from './TextSizeSettings'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('TextSizeSettings', () => {
  it('ヘッダーの表示設定から文字サイズを変更できる', () => {
    const onChange = vi.fn()
    act(() => root.render(<TextSizeSettings value="small" onChange={onChange} />))

    const settingsButton = container.querySelector('[aria-label="表示設定"]') as HTMLButtonElement
    act(() => settingsButton.click())
    const medium = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('読みやすく'),
    )
    act(() => medium?.click())

    expect(onChange).toHaveBeenCalledWith('medium')
  })

  it('現在のサイズを押下状態として伝える', () => {
    act(() => root.render(<TextSizeSettings value="large" onChange={() => {}} />))
    const settingsButton = container.querySelector('[aria-label="表示設定"]') as HTMLButtonElement
    act(() => settingsButton.click())
    const large = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('より大きく'),
    )
    expect(large?.getAttribute('aria-pressed')).toBe('true')
  })
})
