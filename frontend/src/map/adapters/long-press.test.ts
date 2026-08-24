import { afterEach, describe, expect, it, vi } from 'vitest'

import { installLongPress } from './long-press'

function pointer(type: string, x: number, y: number, pointerId = 1): Event {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y })
  Object.defineProperties(event, {
    isPrimary: { value: true },
    pointerId: { value: pointerId },
  })
  return event
}

describe('installLongPress', () => {
  afterEach(() => vi.useRealTimers())

  it('650ms押し続けた地点を通知する', async () => {
    vi.useFakeTimers()
    const target = document.createElement('div')
    const callback = vi.fn()
    const dispose = installLongPress(target, callback)

    target.dispatchEvent(pointer('pointerdown', 120, 240))
    await vi.advanceTimersByTimeAsync(650)

    expect(callback).toHaveBeenCalledWith({ x: 120, y: 240 })
    dispose()
  })

  it('指の小さな揺れは許容し、地図を動かしたら取り消す', async () => {
    vi.useFakeTimers()
    const target = document.createElement('div')
    const callback = vi.fn()
    const dispose = installLongPress(target, callback)

    target.dispatchEvent(pointer('pointerdown', 100, 100))
    window.dispatchEvent(pointer('pointermove', 112, 108))
    await vi.advanceTimersByTimeAsync(650)
    expect(callback).toHaveBeenCalledOnce()

    target.dispatchEvent(pointer('pointerdown', 100, 100, 2))
    window.dispatchEvent(pointer('pointermove', 130, 100, 2))
    await vi.advanceTimersByTimeAsync(650)
    expect(callback).toHaveBeenCalledOnce()
    dispose()
  })

  it('押し終えたら通知しない', async () => {
    vi.useFakeTimers()
    const target = document.createElement('div')
    const callback = vi.fn()
    const dispose = installLongPress(target, callback)

    target.dispatchEvent(pointer('pointerdown', 100, 100))
    window.dispatchEvent(pointer('pointerup', 100, 100))
    await vi.advanceTimersByTimeAsync(650)

    expect(callback).not.toHaveBeenCalled()
    dispose()
  })

  it('ブラウザ標準のコンテキストメニューを出さない', () => {
    const target = document.createElement('div')
    const dispose = installLongPress(target, vi.fn())
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })

    target.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    dispose()
  })
})
