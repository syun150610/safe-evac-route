/** 住所サジェスト（国土地理院の住所検索API）。
 *
 * ⚠️ **入力ごとに叩かない。** 250ms 止まってから1回だけ投げ、
 * 古いリクエストは AbortController で捨てる。相手は公共の無料APIなので、
 * 打鍵のたびに投げるのは行儀が悪いし、結果の順序も保証できない。
 */
import { useEffect, useRef, useState } from 'react'

import { type Place, searchAddress } from '../lib/gsi'

const DEBOUNCE_MS = 250
const MIN_CHARS = 2
// ⚠️ ここでは**絞りすぎない。** 呼び出し側が「対象エリア内を先に」並べ替えてから
//    表示件数に切る。ここで8件に切ると、エリア内の候補が全国の同名地点に
//    押し出されて消える（「上野駅」で実際に起きた）
const MAX_ITEMS = 40

export function useGeocode(query: string, enabled = true) {
  const [places, setPlaces] = useState<Place[]>([])
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
      searchAddress(q, ac.signal)
        .then((r) => {
          setPlaces(r.slice(0, MAX_ITEMS))
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
  }, [query, enabled])

  return { places, error, loading }
}
