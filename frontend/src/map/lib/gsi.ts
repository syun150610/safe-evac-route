/** 国土地理院の住所検索API。
 *
 * なぜここか: 出発地・目的地のサジェストに使う。**キー不要・無料・規約が明快**で、
 * 締切前に課金と規約確認が要る Google Places を避けられる
 * （docs/dev/06_次セッションへの指示.md §2 ①）。
 *
 *   https://msearch.gsi.go.jp/address-search/AddressSearch?q=北千住駅
 *   → [{ geometry: {coordinates: [lon, lat]}, properties: {title, addressCode} }, ...]
 *
 * ⚠️ **バックエンドを経由しない。** `Access-Control-Allow-Origin: *` が付いているので
 * ブラウザから直接叩ける。中継すると API に外部依存とレート制限が持ち込まれる。
 * ⚠️ 返るのは住所・施設名の**代表点**であって、道路上の点とは限らない。
 * 探索側は最寄りノードへスナップし、遠すぎれば弾く（search.py の MAX_SNAP_M）。
 */
const ENDPOINT = 'https://msearch.gsi.go.jp/address-search/AddressSearch'

export interface Place {
  /** 表示名（住所または施設名） */
  title: string
  lat: number
  lon: number
}

interface GsiFeature {
  geometry?: { coordinates?: [number, number] }
  properties?: { title?: string }
}

/** 住所・施設名の候補。`signal` で古い入力の検索を捨てられる */
export async function searchAddress(q: string, signal?: AbortSignal): Promise<Place[]> {
  const s = q.trim()
  if (!s) return []
  const r = await fetch(`${ENDPOINT}?q=${encodeURIComponent(s)}`, { signal })
  if (!r.ok) throw new Error(`住所検索に失敗しました（${r.status}）`)
  const raw = (await r.json()) as GsiFeature[]
  if (!Array.isArray(raw)) return []
  const out: Place[] = []
  for (const f of raw) {
    const c = f.geometry?.coordinates
    const title = f.properties?.title
    // 座標か名前が欠けた候補がまれに混ざる。落とす
    if (!c || c.length < 2 || !title) continue
    out.push({ title, lon: Number(c[0]), lat: Number(c[1]) })
  }
  return out
}

/** 現在地。**HTTPS か localhost でしか動かない**ので、失敗理由を日本語で返す */
export function currentPosition(): Promise<Place> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('この端末では現在地を取得できません'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ title: '現在地', lat: p.coords.latitude, lon: p.coords.longitude }),
      (e) =>
        reject(
          new Error(
            e.code === e.PERMISSION_DENIED
              ? '現在地の利用が許可されていません'
              : e.code === e.POSITION_UNAVAILABLE
                ? '現在地を取得できませんでした'
                : '現在地の取得がタイムアウトしました',
          ),
        ),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    )
  })
}
