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

import { ApiError, postSearch, postShelterSearch } from '../../api/client'
import type { Bundle, SearchRequest, ShelterSearchRequest } from '../types'

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

  /** 2点探索と避難先探索で**同じ state を使う**。
   *
   * 避難先探索の戻り値は2点探索と同じ形（`routes[]` / `geojson` / `rationale`）に
   * `shelter*` が付いただけなので、表示側は区別しなくてよい。
   * 追い越し対策の通し番号も1本で足りる（両方を同時に走らせない）。
   */
  const call = useCallback(async (fetcher: () => Promise<Bundle>) => {
    const my = ++seq.current
    setState((s) => ({ ...s, error: null, outside: [], loading: true }))
    try {
      const b = await fetcher()
      if (my !== seq.current) return null // 追い越された。捨てる
      setState({ bundle: b, error: null, outside: [], loading: false })
      return b
    } catch (e) {
      if (my !== seq.current) return null
      const err = e as ApiError
      setState({
        bundle: null,
        error: err.message ?? String(e),
        outside: err instanceof ApiError && err.outOfArea ? err.outside : [],
        loading: false,
      })
      return null
    }
  }, [])

  const run = useCallback((req: SearchRequest) => call(() => postSearch(req)), [call])

  /** 目的地を指定せず、近隣で一番安全に着ける避難先まで引く。 */
  const runShelter = useCallback(
    (req: ShelterSearchRequest) => call(() => postShelterSearch(req)),
    [call],
  )

  const clear = useCallback(() => {
    seq.current++ // 進行中のリクエストの結果を捨てる
    setState({ bundle: null, error: null, outside: [], loading: false })
  }, [])

  return { ...state, run, runShelter, clear }
}
