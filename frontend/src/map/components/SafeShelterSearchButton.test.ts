import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SafeShelterSearchButton } from './SafeShelterSearchButton'

const hosts: HTMLElement[] = []

afterEach(() => {
  for (const host of hosts) host.remove()
  hosts.length = 0
})

async function renderButton(loading: boolean, onSearch: () => void | Promise<void>) {
  const host = document.createElement('div')
  document.body.append(host)
  hosts.push(host)
  const root = createRoot(host)
  await act(async () => root.render(createElement(SafeShelterSearchButton, { loading, onSearch })))
  return { host, root }
}

describe('SafeShelterSearchButton', () => {
  it('クリックすると避難先検索を開始する', async () => {
    const onSearch = vi.fn()
    const { host, root } = await renderButton(false, onSearch)

    await act(async () => host.querySelector('button')?.click())

    expect(onSearch).toHaveBeenCalledOnce()
    await act(async () => root.unmount())
  })

  it('検索中は無効化して二重クリックを防ぐ', async () => {
    const onSearch = vi.fn()
    const { host, root } = await renderButton(true, onSearch)
    const button = host.querySelector('button')

    expect(button?.disabled).toBe(true)
    expect(button?.getAttribute('aria-busy')).toBe('true')
    expect(button?.textContent).toContain('安全な避難先を検索中')
    await act(async () => button?.click())
    expect(onSearch).not.toHaveBeenCalled()
    await act(async () => root.unmount())
  })
})
