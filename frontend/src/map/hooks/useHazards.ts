/** ハザードのカタログ（種別・シナリオ・凡例・タイルURL）。
 *
 * ⚠️ **バンドルJSONの `tiles` フィールドは使わない。**
 * あれは素のHTML版（frontend/viewer_demo.html）からの相対パス（`../var/tiles/...`）で、
 * React版（Viteのルート直下）からは解決できない。実際にタイルが全部404になった。
 * URLはAPIが配るものを使う（docs/dev/05_チーム移行案.md §5-3 の「tiles フィールドは廃止」）。
 */
import { useEffect, useState } from 'react'

import { getHazards } from '../../api/client'
import type { HazardCatalog } from '../types'

export function useHazards() {
  const [catalog, setCatalog] = useState<HazardCatalog | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    getHazards()
      .then((next) => {
        setCatalog(next)
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])
  return { catalog, error, loading }
}

/** 種別＋シナリオ → タイルURLテンプレ */
export function tileUrlOf(
  catalog: HazardCatalog | null,
  hazard: string,
  scenario: string,
): string | null {
  return scenarioOf(catalog, hazard, scenario)?.tile_url ?? null
}

/** 種別＋シナリオ → ベクタ（GeoJSON）のURL。地震は町丁目ポリゴンで描く */
export function vectorUrlOf(
  catalog: HazardCatalog | null,
  hazard: string,
  scenario: string,
): string | null {
  return scenarioOf(catalog, hazard, scenario)?.vector_url ?? null
}

function scenarioOf(catalog: HazardCatalog | null, hazard: string, scenario: string) {
  const h = catalog?.hazards.find((x) => x.id === hazard)
  return h?.scenarios.find((x) => x.id === scenario) ?? null
}
