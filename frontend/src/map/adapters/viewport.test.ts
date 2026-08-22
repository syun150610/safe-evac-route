import { describe, expect, it } from 'vitest'
import type { MapViewport } from './types'
import { viewportKey } from './viewport'

describe('viewportKey', () => {
  it('描画に影響しない微小差を同じviewportとして扱う', () => {
    const base: MapViewport = {
      bbox: [
        [139.72, 35.68],
        [139.86, 35.78],
      ],
      zoom: 12,
    }
    const tinyDifference: MapViewport = {
      bbox: [
        [139.720000001, 35.68],
        [139.86, 35.78],
      ],
      zoom: 12.0000001,
    }
    expect(viewportKey(base)).toBe(viewportKey(tinyDifference))
  })

  it('実際に移動したviewportは区別する', () => {
    const base: MapViewport = {
      bbox: [
        [139.72, 35.68],
        [139.86, 35.78],
      ],
      zoom: 12,
    }
    const moved: MapViewport = {
      ...base,
      bbox: [
        [139.73, 35.68],
        [139.87, 35.78],
      ],
    }
    expect(viewportKey(moved)).not.toBe(viewportKey(base))
  })
})
