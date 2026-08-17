/** 対象エリア（bbox）。**この外の地点では経路を引けない。**
 *
 * 送信してから 422 で返されるより、入力の時点で分かる方がよいので、
 * フロントでも同じ判定を持つ（最終的な判定はAPI側。二重に持っているのは意図的）。
 */
import { useEffect, useState } from 'react'

import { getArea } from '../../api/client'
import type { Area } from '../types'

export function useArea() {
  const [area, setArea] = useState<Area | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    getArea()
      .then(setArea)
      .catch((e: Error) => setError(e.message))
  }, [])
  return { area, error }
}

/** bbox の中か。area がまだ来ていないときは通す（APIが最終判定する） */
export function inArea(area: Area | null, lat: number, lon: number): boolean {
  if (!area) return true
  const [left, bottom, right, top] = area.bbox
  return left <= lon && lon <= right && bottom <= lat && lat <= top
}
