/** Google Places（New）の地点サジェスト。
 *
 * 国土地理院の住所検索（`lib/gsi.ts`）は無料・キー不要で規約も明快だが、
 * 返るのが**住所文字列と代表点だけ**で、施設名・所在地・種別が分からない。
 * 「上野駅」で全国の同名地点が混ざる問題もある。ここではその2点を直す。
 *
 * ## 呼び方
 *
 * Maps JavaScript API の上で `places` ライブラリを読み、
 * **Autocomplete（候補）→ 選んだ1件だけ Place Details（座標）** の順で叩く。
 *
 * ⚠️ **候補全部の座標を先に取らない。** Place Details は1件ずつ課金される。
 *    候補10件ぶん先読みすると、打鍵のたびに10件ぶん課金される。
 * ⚠️ **セッショントークンを通すこと。** 候補取得〜選択までを1セッションとして
 *    まとめないと、候補取得ぶんが個別課金になる。選択後は捨てて次を作る。
 * ⚠️ **`locationRestriction` に探索範囲の bbox を渡す。** これが「上野駅で
 *    全国が出る」の直接の対策で、`useGeocode` 側の並べ替えより確実。
 *
 * ## 使えないときは黙って諦める
 *
 * キーが無い・APIが有効化されていない・課金が未設定・クォータ切れのいずれでも
 * 例外になる。**呼び出し側（`lib/place-search.ts`）が国土地理院へ落とす。**
 * 提出直前に地点検索ごと死ぬ事態を避けるため、ここでは復旧を試みない。
 *
 * google.maps の型は入れていない（`adapters/google.ts` と同じ方針）。
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { loadMapsScript, mapsApiKey } from './google-maps'
import type { Place } from './gsi'

declare const google: any

/** [left, bottom, right, top] = [lon0, lat0, lon1, lat1] */
export type Bbox = [number, number, number, number]

export interface PlaceSuggestion {
  /** React の key と重複排除に使う */
  id: string
  /** 施設名・地名（太字で出す側） */
  title: string
  /** 所在地など。**Placesを使う理由がここ。** 無い場合もある */
  address?: string
  /** 分かっていれば座標。**Googleの候補は選ぶまで座標を持たない** */
  place?: Place
  /** 座標を確定する。Googleでは Place Details を1回だけ叩く */
  resolve: () => Promise<Place>
}

let placesLib: Promise<any> | null = null

function loadPlaces(): Promise<any> {
  if (placesLib) return placesLib
  const key = mapsApiKey()
  if (!key) return Promise.reject(new Error('Google Maps APIキーが未設定です'))
  placesLib = loadMapsScript(key).then(() => google.maps.importLibrary('places'))
  return placesLib
}

/** キーが無ければ試すだけ無駄。呼び出し側が国土地理院を直接使う */
export function placesConfigured(): boolean {
  return mapsApiKey() !== ''
}

// 候補取得〜選択までを1セッションにまとめるトークン。選択したら捨てる
let sessionToken: any = null

function bounds(bbox: Bbox) {
  const [west, south, east, north] = bbox
  return { west, south, east, north }
}

/** 候補を引く。**座標はまだ取らない。**
 *
 * `signal` は打鍵で捨てるためのもの。Places のクラスは AbortSignal を
 * 受け取らないので、**戻ってきてから捨てる**（課金は発生済み。だから
 * 呼び出し側で250msデバウンスしている）。
 */
export async function suggest(
  q: string,
  { bbox, signal }: { bbox?: Bbox | null; signal?: AbortSignal } = {},
): Promise<PlaceSuggestion[]> {
  const input = q.trim()
  if (!input) return []
  const lib = await loadPlaces()
  const { AutocompleteSuggestion, AutocompleteSessionToken } = lib
  if (!sessionToken) sessionToken = new AutocompleteSessionToken()

  const request: any = {
    input,
    sessionToken,
    language: 'ja',
    region: 'jp',
    includedRegionCodes: ['jp'],
  }
  // 探索範囲の外を出さない。**候補の並べ替えではなく、そもそも返させない**
  if (bbox) request.locationRestriction = bounds(bbox)

  const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions(request)
  if (signal?.aborted) return []

  const out: PlaceSuggestion[] = []
  for (const s of suggestions ?? []) {
    const p = s.placePrediction
    if (!p) continue
    const title = p.mainText?.text ?? p.text?.text
    if (!title) continue
    out.push({
      id: p.placeId ?? title,
      title,
      address: p.secondaryText?.text,
      resolve: async () => {
        const place = p.toPlace()
        await place.fetchFields({ fields: ['location', 'formattedAddress', 'displayName'] })
        const loc = place.location
        if (!loc) throw new Error('この地点の座標を取得できませんでした')
        // 選び終わったのでセッションを閉じる。次の検索は新しいトークンで
        sessionToken = null
        return {
          title: place.displayName ?? title,
          lat: typeof loc.lat === 'function' ? loc.lat() : loc.lat,
          lon: typeof loc.lng === 'function' ? loc.lng() : loc.lng,
        }
      },
    })
  }
  return out
}

/** テスト用。読み込み済みライブラリとセッションを捨てる */
export function resetPlacesForTest(): void {
  placesLib = null
  sessionToken = null
}
