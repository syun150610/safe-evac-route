/** 地点サジェスト。提供元の選択は `lib/place-search.ts` が持つ。
 *
 * ⚠️ **入力ごとに叩かない。** 250ms 止まってから1回だけ投げ、古いリクエストは
 * AbortController で捨てる。国土地理院は公共の無料APIで打鍵ごとは行儀が悪く、
 * Google Places は**1回ごとに課金**される。どちらにせよ投げすぎない。
 *
 * ⚠️ **候補は座標を持たないことがある。** Places は選択時に初めて座標を引く
 * （`PlaceSuggestion.resolve()`）。呼び出し側は `place` の有無で
 * 「エリア内かどうかを事前に言えるか」を出し分けること。
 */
import { useEffect, useRef, useState } from 'react'

import type { Bbox, PlaceSource, PlaceSuggestion } from '../lib/place-search'
import { searchPlaces } from '../lib/place-search'

const DEBOUNCE_MS = 250
const MIN_CHARS = 2
// ⚠️ ここでは**絞りすぎない。** 呼び出し側が「対象エリア内を先に」並べ替えてから
//    表示件数に切る。ここで8件に切ると、エリア内の候補が全国の同名地点に
//    押し出されて消える（「上野駅」で実際に起きた）。
//    Places 側は `locationRestriction` で範囲外をそもそも返させないので、
//    この上限に当たるのは国土地理院を使っているときだけになる
const MAX_ITEMS = 40

export function useGeocode(query: string, enabled = true, bbox?: Bbox | null) {
  const [places, setPlaces] = useState<PlaceSuggestion[]>([])
  const [source, setSource] = useState<PlaceSource>('google')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const abort = useRef<AbortController | null>(null)

  useEffect(() => {
    const q = query.trim()
    abort.current?.abort()
    if (!enabled || q.length < MIN_CHARS) {
      setPlaces([])
      setError(null)
      setLoading(false)
      return
    }
    const ac = new AbortController()
    abort.current = ac
    setLoading(true)
    const t = setTimeout(() => {
      searchPlaces(q, { bbox, signal: ac.signal })
        .then((r) => {
          if (ac.signal.aborted) return
          setPlaces(r.items.slice(0, MAX_ITEMS))
          setSource(r.source)
          setError(null)
        })
        .catch((e: Error) => {
          if (e.name !== 'AbortError') setError(e.message)
        })
        .finally(() => {
          if (!ac.signal.aborted) setLoading(false)
        })
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(t)
      ac.abort()
    }
  }, [query, enabled, bbox])

  return { places, source, error, loading }
}
