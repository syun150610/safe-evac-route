/** ベクタのハザード（地震の町丁目ポリゴン）を読む。
 *
 * ⚠️ **1ファイル 4.6MB ある。** 切替のたびに取り直すと目に見えて待たされるので、
 * 一度読んだものはモジュール内に持つ（ページを開いている間だけ）。
 * ブラウザのキャッシュに任せないのは、パース済みのオブジェクトを使い回したいため。
 */
import { useEffect, useState } from 'react'

const cache = new Map<string, unknown>()

export function useVector(url: string | null) {
  const [data, setData] = useState<unknown>(url ? (cache.get(url) ?? null) : null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!url) {
      setData(null)
      setError(null)
      setLoading(false)
      return
    }
    const hit = cache.get(url)
    if (hit) {
      setData(hit)
      setError(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`${url}: ${r.status} ${r.statusText}`)
        return r.json()
      })
      .then((j: unknown) => {
        cache.set(url, j)
        if (!cancelled) {
          setData(j)
          setError(null)
        }
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [url])

  return { data, error, loading }
}
