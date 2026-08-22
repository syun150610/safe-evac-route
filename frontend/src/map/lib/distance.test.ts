import { describe, expect, it } from 'vitest'
import { distanceKm } from './distance'

const ueno = { lat: 35.7138, lon: 139.7773 }
const asakusa = { lat: 35.7119, lon: 139.7982 }

describe('distanceKm', () => {
  it('2地点の概算距離をkmで返す', () => {
    expect(distanceKm(ueno, asakusa)).toBeGreaterThan(1)
    expect(distanceKm(ueno, asakusa)).toBeLessThan(3)
  })
})
