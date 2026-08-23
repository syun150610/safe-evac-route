/** 提供元の選び方と、落ちたときの受け皿の確認。
 *
 * ⚠️ ここで確かめたいのは1点だけ。**Placesが使えなくても地点検索が死なないこと。**
 * キー未設定・API未有効化・課金未設定・クォータ切れのどれでも例外になるので、
 * 提出直前にここが落ちると検索機能ごと止まる。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetPlaceSearchForTest, searchPlaces } from './place-search'

vi.mock('./places', () => ({
  placesConfigured: () => mockConfigured,
  suggest: (...args: unknown[]) => mockSuggest(...args),
}))

vi.mock('./gsi', () => ({
  searchAddress: (...args: unknown[]) => mockGsi(...args),
}))

let mockConfigured = true
let mockSuggest: (...args: unknown[]) => Promise<unknown>
let mockGsi: (...args: unknown[]) => Promise<unknown>

beforeEach(() => {
  resetPlaceSearchForTest()
  mockConfigured = true
  mockSuggest = vi.fn(async () => [
    { id: 'a', title: '上野公園', address: '台東区上野公園', resolve: async () => ({}) },
  ])
  mockGsi = vi.fn(async () => [{ title: '東京都台東区上野公園', lat: 35.71, lon: 139.77 }])
})

afterEach(() => {
  vi.restoreAllMocks()
  resetPlaceSearchForTest()
})

describe('searchPlaces', () => {
  it('Placesが使えるならPlacesを使い、所在地も返す', async () => {
    const r = await searchPlaces('上野公園')
    expect(r.source).toBe('google')
    expect(r.items[0].address).toBe('台東区上野公園')
    expect(mockGsi).not.toHaveBeenCalled()
  })

  it('探索範囲のbboxをPlacesへ渡す（範囲外をそもそも返させない）', async () => {
    const bbox = [139.1, 35.4, 139.9, 35.8] as [number, number, number, number]
    await searchPlaces('上野駅', { bbox })
    expect(mockSuggest).toHaveBeenCalledWith('上野駅', expect.objectContaining({ bbox }))
  })

  it('⚠️ Placesが落ちたら国土地理院へ落ちる（検索機能を止めない）', async () => {
    mockSuggest = vi.fn(async () => {
      throw new Error('REQUEST_DENIED')
    })
    const r = await searchPlaces('上野公園')
    expect(r.source).toBe('gsi')
    expect(r.items[0].title).toBe('東京都台東区上野公園')
    // 国土地理院の候補は最初から座標を持つ（選ぶ前にエリア内か言える）
    expect(r.items[0].place).toEqual({
      title: '東京都台東区上野公園',
      lat: 35.71,
      lon: 139.77,
    })
  })

  it('一度落ちたら以降はPlacesを試さない（毎回叩くと遅くなるだけ）', async () => {
    mockSuggest = vi.fn(async () => {
      throw new Error('REQUEST_DENIED')
    })
    await searchPlaces('上野')
    await searchPlaces('浅草')
    expect(mockSuggest).toHaveBeenCalledTimes(1)
    expect(mockGsi).toHaveBeenCalledTimes(2)
  })

  it('キーが無ければ試さずに国土地理院を使う', async () => {
    mockConfigured = false
    const r = await searchPlaces('上野公園')
    expect(r.source).toBe('gsi')
    expect(mockSuggest).not.toHaveBeenCalled()
  })

  it('打鍵で捨てた（AbortError）ときは提供元を切り替えない', async () => {
    const abort = new Error('aborted')
    abort.name = 'AbortError'
    mockSuggest = vi.fn(async () => {
      throw abort
    })
    await expect(searchPlaces('上')).rejects.toThrow('aborted')
    // 次はまた Places を試す（壊れた扱いにしない）
    mockSuggest = vi.fn(async () => [{ id: 'b', title: '浅草寺', resolve: async () => ({}) }])
    const r = await searchPlaces('浅草寺')
    expect(r.source).toBe('google')
  })

  it('空文字では何も叩かない', async () => {
    const r = await searchPlaces('   ')
    expect(r.items).toEqual([])
    expect(mockSuggest).not.toHaveBeenCalled()
    expect(mockGsi).not.toHaveBeenCalled()
  })
})
