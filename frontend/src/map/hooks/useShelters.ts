/** 避難所・避難場所データの取得。enabled=false のときはAPIを叩かない。 */
import { useEffect, useState } from 'react'

import { getShelters } from '../../api/client'
import type { ShelterCollection } from '../types'

export function useShelters(enabled: boolean, bbox?: [number, number, number, number]) {
  const [data, setData] = useState<ShelterCollection | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!enabled) {
      setData(null)
      return
    }
    setLoading(true)
    const bboxStr = bbox ? bbox.join(',') : undefined
    getShelters({ bbox: bboxStr })
      .then((d) => {
        setData(d)
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [enabled, bbox?.join(',')])

  return { data, error, loading }
}
