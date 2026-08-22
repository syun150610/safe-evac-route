/** 地点検索の入口。**どちらの提供元を使うかはここだけが知っている。**
 *
 *   Google Places（New）… 施設名・所在地が付き、探索範囲の外を返さない
 *   国土地理院           … キー不要・無料。Placesが使えないときの受け皿
 *
 * ⚠️ **Placesが落ちても検索機能ごと落とさない。** キー未設定、API未有効化、
 * 課金未設定、クォータ切れのどれでも例外になる。**その場で国土地理院へ落とす。**
 * 提出直前に地点検索が死ぬ方が、候補の情報が薄いことより重い。
 *
 * ⚠️ **落ちたことを黙らない。** 一度落ちたら以降はPlacesを試さず（毎回叩くと
 * 遅くなるだけ）、`source` で「いまどちらを使っているか」を返す。
 */
import type { Place } from './gsi'
import { searchAddress } from './gsi'
import { type Bbox, type PlaceSuggestion, placesConfigured, suggest } from './places'

export type { Bbox, PlaceSuggestion }

export type PlaceSource = 'google' | 'gsi'

export interface SearchResult {
  items: PlaceSuggestion[]
  source: PlaceSource
}

// Placesが使えないと分かったら、以降は試さない
let placesBroken = false

/** 国土地理院の結果を、選択済みの座標を持った候補として包む */
function fromGsi(places: Place[]): PlaceSuggestion[] {
  return places.map((p, i) => ({
    id: `gsi-${i}-${p.lat},${p.lon}`,
    title: p.title,
    place: p,
    resolve: async () => p,
  }))
}

export async function searchPlaces(
  q: string,
  { bbox, signal }: { bbox?: Bbox | null; signal?: AbortSignal } = {},
): Promise<SearchResult> {
  const s = q.trim()
  if (!s) return { items: [], source: placesBroken ? 'gsi' : 'google' }

  if (placesConfigured() && !placesBroken) {
    try {
      return { items: await suggest(s, { bbox, signal }), source: 'google' }
    } catch (e) {
      // 打鍵で捨てただけなら、提供元を切り替えない
      if ((e as Error).name === 'AbortError') throw e
      placesBroken = true
      console.warn('Places が使えないため国土地理院へ切り替えます', e)
    }
  }
  return { items: fromGsi(await searchAddress(s, signal)), source: 'gsi' }
}

/** テスト用。「Placesが壊れている」の記憶を捨てる */
export function resetPlaceSearchForTest(): void {
  placesBroken = false
}
