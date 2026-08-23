/** ログインを求める範囲。
 *
 * ⚠️ ここが緩むと、求めるつもりの無かった画面まで会員登録が要る（またはその逆で
 * 投稿が素通しになる）。**範囲そのものをテストで固定する。**
 */
import { describe, expect, it } from 'vitest'

import { screenFor } from './routing'

describe('screenFor', () => {
  // ⚠️ 避難経路を調べるために会員登録を求めない
  it('地図と経路探索は未ログインで使える', () => {
    expect(screenFor('/', 'unauthenticated')).toBe('map')
    expect(screenFor('/', 'authenticated')).toBe('map')
  })

  it('みんなの声の閲覧も未ログインで使える', () => {
    expect(screenFor('/timeline', 'unauthenticated')).toBe('timeline')
  })

  // ⚠️ 自分の名前が残るものだけログインを求める
  it('投稿とマイページはログインが要る', () => {
    expect(screenFor('/posts/new', 'unauthenticated')).toBe('login')
    expect(screenFor('/mypage', 'unauthenticated')).toBe('login')
  })

  it('ログイン済みならそのまま開ける', () => {
    expect(screenFor('/posts/new', 'authenticated')).toBe('new-post')
    expect(screenFor('/mypage', 'authenticated')).toBe('mypage')
  })

  // ⚠️ 確認が終わる前にログイン画面を出すと、ログイン済みの人にも一瞬出る
  it('確認中はログインが要る画面だけ待たせる', () => {
    expect(screenFor('/mypage', 'initializing')).toBe('loading')
    expect(screenFor('/', 'initializing')).toBe('map')
    expect(screenFor('/timeline', 'initializing')).toBe('timeline')
  })

  it('知らないパスは地図にする', () => {
    expect(screenFor('/unknown', 'unauthenticated')).toBe('map')
  })
})
