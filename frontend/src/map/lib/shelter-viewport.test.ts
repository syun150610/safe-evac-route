import { describe, expect, it } from 'vitest'
import type { BBox, MapViewport } from '../adapters/types'
import type { Area, ShelterFeature } from '../types'
import { MIN_SHELTER_ZOOM, pointInBbox, shelterIsVisible } from './shelter-viewport'

const area = {
  bbox: [139.7, 35.6, 139.9, 35.8],
} as Area

function shelter(lon: number, lat: number): ShelterFeature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: {
      id: `${lon},${lat}`,
      name: 'テスト避難所',
      type: 'designated',
      type_label: '指定避難所',
      address: '',
      municipality: '',
      hazard_types: [],
    },
  }
}

const viewport: MapViewport = {
  bbox: [
    [139.75, 35.65],
    [139.85, 35.75],
  ],
  zoom: MIN_SHELTER_ZOOM,
}

describe('pointInBbox', () => {
  it('境界を含め、範囲外を除外する', () => {
    expect(pointInBbox([139.75, 35.65], viewport.bbox)).toBe(true)
    expect(pointInBbox([139.8, 35.7], viewport.bbox)).toBe(true)
    expect(pointInBbox([139.86, 35.7], viewport.bbox)).toBe(false)
  })

  it('日付変更線をまたぐbboxを扱う', () => {
    const wrapped: BBox = [
      [170, -10],
      [-170, 10],
    ]
    expect(pointInBbox([175, 0], wrapped)).toBe(true)
    expect(pointInBbox([-175, 0], wrapped)).toBe(true)
    expect(pointInBbox([0, 0], wrapped)).toBe(false)
  })
})

describe('shelterIsVisible', () => {
  it('z12以上かつ画面内・探索可能エリア内だけを表示する', () => {
    expect(shelterIsVisible(shelter(139.8, 35.7), viewport, area)).toBe(true)
    expect(
      shelterIsVisible(shelter(139.8, 35.7), { ...viewport, zoom: MIN_SHELTER_ZOOM - 0.01 }, area),
    ).toBe(false)
    expect(shelterIsVisible(shelter(139.86, 35.7), viewport, area)).toBe(false)
    expect(shelterIsVisible(shelter(139.8, 35.7), viewport, null)).toBe(false)
  })

  it('画面内でも探索可能エリア外なら表示しない', () => {
    const wideViewport: MapViewport = {
      bbox: [
        [139.0, 35.0],
        [140.0, 36.0],
      ],
      zoom: MIN_SHELTER_ZOOM,
    }
    expect(shelterIsVisible(shelter(139.95, 35.7), wideViewport, area)).toBe(false)
  })
})
