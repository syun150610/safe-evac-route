/** 対象エリア（bbox）。**この外の地点では経路を引けない。**
 *
 * 送信してから 422 で返されるより、入力の時点で分かる方がよいので、
 * フロントでも同じ判定を持つ（最終的な判定はAPI側。二重に持っているのは意図的）。
 */
import { useEffect, useState } from 'react'

import { getArea } from '../../api/client'
import type { PlaceSuggestion } from '../lib/place-search'
import type { Area } from '../types'

const PREFECTURE =
  /北海道|東京都|(?:京都|大阪)府|(?:青森|岩手|宮城|秋田|山形|福島|茨城|栃木|群馬|埼玉|千葉|神奈川|新潟|富山|石川|福井|山梨|長野|岐阜|静岡|愛知|三重|滋賀|兵庫|奈良|和歌山|鳥取|島根|岡山|広島|山口|徳島|香川|愛媛|高知|福岡|佐賀|長崎|熊本|大分|宮崎|鹿児島|沖縄)県/

export function useArea() {
  const [area, setArea] = useState<Area | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    getArea()
      .then((next) => {
        setArea(next)
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])
  return { area, error, loading }
}

/** bbox の中か。area がまだ来ていないときは通す（APIが最終判定する） */
export function inArea(area: Area | null, lat: number, lon: number): boolean {
  if (!area) return true
  const [left, bottom, right, top] = area.bbox
  return left <= lon && lon <= right && bottom <= lat && lat <= top
}

/** 候補を選ぶ前に分かる範囲での対応地域判定。
 *
 * Google候補は座標を選択時まで持たないため、所在地に都道府県があれば先に判定する。
 * 東京都内でも市街化区域外など、この段階で確定できないものは null としてAPIの
 * 最終判定へ委ねる。国土地理院候補は座標を持つのでbboxでも判定できる。
 */
export function suggestionAreaStatus(
  area: Area | null,
  suggestion: Pick<PlaceSuggestion, 'title' | 'address' | 'place'>,
): boolean | null {
  const prefecture = `${suggestion.address ?? ''} ${suggestion.title}`.match(PREFECTURE)?.[0]
  if (prefecture && prefecture !== '東京都') return false
  if (!suggestion.place) return null
  return inArea(area, suggestion.place.lat, suggestion.place.lon)
}

/** 対応地域名はAPI由来。範囲を拡張してもフロントの文言変更を不要にする。 */
export function outOfAreaMessage(area: Area | null, subject?: string): string {
  const prefix = subject ? `${subject}が` : ''
  return `${prefix}検索対象外です。${area?.label ?? '現在の対応地域'}以外は未対応です。`
}
