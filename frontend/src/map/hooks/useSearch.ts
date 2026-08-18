/** 任意の2点の経路探索（POST /api/evac-routes/search）。
 *
 * 戻り値は**プリセットと同じ形**なので、表示側は `useBundle` と区別しなくてよい
 * （docs/dev/06_次セッションへの指示.md §2）。
 *
 * ⚠️ 探索は 1〜1.5 秒かかる（グラフの初回読み込みを含む）。押しっぱなしを防ぐため
 * `loading` を返し、**古い結果で新しい結果を上書きしない**ようにリクエストに
 * 通し番号を付ける（速いリクエストが遅いリクエストを追い越す）。
 */
import { useCallback, useRef, useState } from 'react'

import { ApiError, postSearch } from '../../api/client'
import type { Bundle, SearchRequest } from '../types'

export interface SearchState {
  bundle: Bundle | null
  error: string | null
  /** 対象エリア外だったときに、どちらの地点が外か */
  outside: ('origin' | 'dest')[]
  loading: boolean
}

export function useSearch() {
  const [state, setState] = useState<SearchState>({
    bundle: null,
    error: null,
    outside: [],
    loading: false,
  })
  const seq = useRef(0)

  const run = useCallback(async (req: SearchRequest) => {
    const my = ++seq.current
    setState((s) => ({ ...s, error: null, outside: [], loading: true }))
    try {
      const b = await postSearch(req)
      if (my !== seq.current) return // 追い越された。捨てる
      setState({ bundle: b, error: null, outside: [], loading: false })
    } catch (e) {
      if (my !== seq.current) return
      const err = e as ApiError
      setState({
        bundle: null,
        error: err.message ?? String(e),
        outside: err instanceof ApiError && err.outOfArea ? err.outside : [],
        loading: false,
      })
    }
  }, [])

  const clear = useCallback(() => {
    seq.current++ // 進行中のリクエストの結果を捨てる
    setState({ bundle: null, error: null, outside: [], loading: false })
  }, [])

  return { ...state, run, clear }
}
