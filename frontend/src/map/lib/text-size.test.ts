import { describe, expect, it } from 'vitest'
import { parseMapTextSize } from './text-size'

describe('parseMapTextSize', () => {
  it('保存済みの中・大を復元する', () => {
    expect(parseMapTextSize('medium')).toBe('medium')
    expect(parseMapTextSize('large')).toBe('large')
  })

  it('未設定や未知の値は、現在の表示と同じ小へ戻す', () => {
    expect(parseMapTextSize(null)).toBe('small')
    expect(parseMapTextSize('huge')).toBe('small')
  })
})
