import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface FakeMapHandle {
  listeners: Record<string, () => void>
  zoom: number
  bounds: { west: number; south: number; east: number; north: number }
  canvas: HTMLCanvasElement
}

const stub = vi.hoisted(() => ({ map: null as FakeMapHandle | null }))

vi.mock('maplibre-gl', () => {
  class FakeMap {
    listeners: Record<string, () => void> = {}
    zoom: number
    bounds = { west: 139.72, south: 35.68, east: 139.86, north: 35.78 }
    canvas = document.createElement('canvas')

    constructor(options: { zoom: number }) {
      this.zoom = options.zoom
      stub.map = this
    }

    addControl() {}
    getCanvas() {
      return this.canvas
    }
    unproject([x, y]: [number, number]) {
      return { lng: 139 + x / 10_000, lat: 35 + y / 10_000 }
    }
    isStyleLoaded() {
      return true
    }
    on(event: string, callback: () => void) {
      this.listeners[event] = callback
    }
    getZoom() {
      return this.zoom
    }
    getBounds() {
      return {
        getWest: () => this.bounds.west,
        getSouth: () => this.bounds.south,
        getEast: () => this.bounds.east,
        getNorth: () => this.bounds.north,
      }
    }
  }

  class FakePopup {
    setText() {
      return this
    }
  }

  return {
    Map: FakeMap,
    Marker: class {},
    NavigationControl: class {},
    Popup: FakePopup,
    ScaleControl: class {},
    setWorkerUrl: vi.fn(),
  }
})

import { createMapLibreAdapter } from './maplibre'

function fakeMap(): FakeMapHandle {
  if (!stub.map) throw new Error('MapLibreスタブが初期化されていません')
  return stub.map
}

describe('MapLibre viewport通知', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="map"></div>'
    stub.map = null
  })

  afterEach(() => vi.useRealTimers())

  it('登録時とmoveend後に現在のbbox・ズームを通知する', async () => {
    const adapter = createMapLibreAdapter()
    await adapter.init('map', { center: [139.792, 35.733], zoom: 13 })
    const callback = vi.fn()

    adapter.onViewportChange(callback)
    expect(callback).toHaveBeenLastCalledWith({
      bbox: [
        [139.72, 35.68],
        [139.86, 35.78],
      ],
      zoom: 13,
    })

    callback.mockClear()
    fakeMap().listeners.moveend()
    expect(callback).not.toHaveBeenCalled()

    const map = fakeMap()
    map.bounds = { west: 139.74, south: 35.7, east: 139.88, north: 35.8 }
    map.zoom = 12
    map.listeners.moveend()
    expect(callback).toHaveBeenLastCalledWith({
      bbox: [
        [139.74, 35.7],
        [139.88, 35.8],
      ],
      zoom: 12,
    })
  })

  it('購読解除後はmoveendを通知しない', async () => {
    const adapter = createMapLibreAdapter()
    await adapter.init('map', { center: [139.792, 35.733], zoom: 13 })
    const callback = vi.fn()
    const unsubscribe = adapter.onViewportChange(callback)
    callback.mockClear()

    unsubscribe()
    fakeMap().listeners.moveend()
    expect(callback).not.toHaveBeenCalled()
  })

  it('PointerEventの長押しを地図座標へ変換して通知する', async () => {
    vi.useFakeTimers()
    const adapter = createMapLibreAdapter()
    await adapter.init('map', { center: [139.792, 35.733], zoom: 13 })
    const callback = vi.fn()
    adapter.onLongPress(callback)
    const event = new MouseEvent('pointerdown', {
      bubbles: true,
      button: 0,
      clientX: 70,
      clientY: 140,
    })
    Object.defineProperties(event, {
      isPrimary: { value: true },
      pointerId: { value: 1 },
    })

    fakeMap().canvas.dispatchEvent(event)
    await vi.advanceTimersByTimeAsync(650)

    expect(callback).toHaveBeenCalledWith([139.007, 35.014])
  })
})
