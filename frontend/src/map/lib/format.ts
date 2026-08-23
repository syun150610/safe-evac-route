export const pct = (v: number) => `${(v * 100).toFixed(1)}%`
export const km = (v: number) => `${(v / 1000).toFixed(2)}km`

/** もう一方の避難先（`alt_shelter`）への経路の呼び名。
 *
 * ⚠️ **`routes[].label` が無い経路。** `alt_shelter` は `routes[]` に入らない
 * ので、APIから経路名が来ない。掛け合わせた種別の呼び名（`/api/hazards` 由来）
 * から組み立てる。**この1箇所だけが持つ**（比較表と地図の吹き出しで揃える）。
 */
export const altRouteLabel = (hazardLabel?: string) =>
  hazardLabel ? `${hazardLabel}を考慮` : 'この災害を考慮'
