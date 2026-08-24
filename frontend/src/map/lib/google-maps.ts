/** Maps JavaScript API のブートストラップ。**ページに1枚だけ。**
 *
 * ⚠️ **読み込みの見張りをモジュール単位で持つこと。** 呼び出し側（アダプタ）の
 * 変数で見張ると、アダプタが2つできたとき（StrictMode で実際に起きた。
 * `hooks/useMapAdapter.ts` 参照）それぞれが「まだ読んでいない」と判断して
 * `<script>` を2枚入れ、`window.__initGoogleMap` を後から来た方が上書きする。
 * 結果、**地図のDOMが空の div だけになる**。
 *
 * 地図アダプタ（`adapters/google.ts`）と地点検索（`lib/places.ts`）の**両方**が
 * ここを通る。地点検索だけを使う場合（MapLibre表示）もスクリプトは1枚で足りる。
 *
 * google.maps の型は入れていない（@types/google.maps を足すと Map ID など
 * 使っていない機能まで型が要求される）。境界だけ any にしてある。
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

let mapsScript: Promise<void> | null = null

export const GOOGLE_MAPS_UNAVAILABLE_EVENT = 'safe:google-maps-unavailable'

export type GoogleMapsUnavailableReason = 'auth' | 'initialization' | 'missing-key' | 'script'

/** Google地図を継続利用できないことをアプリへ通知する。
 * アダプタ自身は画面遷移を決めず、AppがMapLibreへ切り替える。 */
export function reportGoogleMapsUnavailable(
  reason: GoogleMapsUnavailableReason,
  error?: unknown,
): void {
  console.warn(`[map] Google Mapsを利用できません (${reason})`, error)
  window.dispatchEvent(
    new CustomEvent<GoogleMapsUnavailableReason>(GOOGLE_MAPS_UNAVAILABLE_EVENT, {
      detail: reason,
    }),
  )
}

/** ビルド時に埋め込まれるキー。無ければ空文字 */
export function mapsApiKey(): string {
  return ((import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string) || '').trim()
}

export function loadMapsScript(key: string): Promise<void> {
  if (mapsScript) return mapsScript
  // 既にページに載っているなら読み直さない（素のHTML版と同居する場合・テストのスタブ）。
  // ⚠️ **`window.google` ではなくグローバル識別子で見る。** 参照側が
  //    `declare const google` 経由で見るのと同じ経路にしないと、
  //    jsdom（globalThis と window が別物になる）で判定だけ外れて init が永久に待つ
  if ((globalThis as any).google?.maps?.Map) {
    mapsScript = Promise.resolve()
    return mapsScript
  }
  mapsScript = new Promise<void>((resolve, reject) => {
    ;(window as any).__initGoogleMap = () => resolve()
    const s = document.createElement('script')
    s.async = true
    s.src =
      'https://maps.googleapis.com/maps/api/js' +
      `?key=${encodeURIComponent(key)}&v=weekly&loading=async&callback=__initGoogleMap`
    s.onerror = () => reject(new Error('script'))
    document.head.appendChild(s)
  })
  return mapsScript
}

/** テスト用。読み込み済みの記憶を捨てる（本番コードからは呼ばない） */
export function resetMapsScriptForTest(): void {
  mapsScript = null
}
