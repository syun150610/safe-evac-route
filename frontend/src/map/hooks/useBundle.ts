/** OD・シナリオからバンドルを取る。 */
import { useEffect, useState } from 'react'

import { getBundle, getPresets } from '../../api/client'
import type { Bundle, PresetIndex } from '../types'

export function usePresets() {
  const [index, setIndex] = useState<PresetIndex | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    getPresets()
      .then(setIndex)
      .catch((e: Error) => setError(e.message))
  }, [])
  return { index, error }
}

export function useBundle(od: string | null, scenario: string | null) {
  const [bundle, setBundle] = useState<Bundle | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!od || !scenario) return
    let cancelled = false
    getBundle(od, scenario)
      .then((b) => {
        if (!cancelled) setBundle(b)
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message)
      })
    return () => {
      cancelled = true
    }
  }, [od, scenario])
  return { bundle, error }
}
