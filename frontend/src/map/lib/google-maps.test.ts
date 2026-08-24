import { describe, expect, it, vi } from 'vitest'

import { GOOGLE_MAPS_UNAVAILABLE_EVENT, reportGoogleMapsUnavailable } from './google-maps'

describe('Google Mapsの利用不能通知', () => {
  it('認証失敗の理由をAppへ通知する', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const listener = vi.fn()
    window.addEventListener(GOOGLE_MAPS_UNAVAILABLE_EVENT, listener)

    reportGoogleMapsUnavailable('auth')

    expect(listener).toHaveBeenCalledOnce()
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toBe('auth')
    window.removeEventListener(GOOGLE_MAPS_UNAVAILABLE_EVENT, listener)
  })
})
