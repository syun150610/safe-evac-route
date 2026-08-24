/** 地図の上に出す経路の要約（吹き出し）。
 *
 * ## なぜ地図にも出すのか
 *
 * 検索結果の数字はシートの中にある。**スマホでは結果が出るとシートが畳まれる**ので、
 * 地図だけを見ている時間ができる。線の色と行き先の対応、どれくらい歩くのかが
 * その場で分からないと、経路を見比べられない（2026-08-23の指摘）。
 *
 * ## 決めごと
 *
 * ⚠️ **行き先ごとに1つ。経路ごとには出さない。** 避難先探索では最短経路と
 * 考慮した経路が**同じ避難先へ向かう**（調布・地震では両方0.37km）。
 * 経路ごとに吹き出しを出すと、同じ場所で重なって両方読めなくなる。
 *
 * ⚠️ **文言はAPI由来のものだけを並べる。** 経路名は `routes[].label`、
 * 危険区間の呼び名は `/api/hazards` の `hazards[].risk.label`。
 * ここで新しい言い回しを作らない（`RouteTable` と同じ規則）。
 *
 * ⚠️ **未評価区間を落とさない。** 危険区間0%でも整備範囲の外なら「安全」ではなく
 * 「判断材料が無い」。地図の上は場所が狭いが、ここを削ると**0%だけが残って
 * 安全に見える**ので必ず添える。
 *
 * ⚠️ **施設名はエスケープしてから埋める。** アダプタへは HTML を文字列で渡す。
 */
import type { CalloutAnchor, CalloutSpec } from '../adapters/types'
import { STYLE } from '../constants'
import type { Bundle, FeatureProps, HazardRisk, RouteId, RouteStats } from '../types'
import { altRouteLabel, km, pct } from './format'

/** 1つの吹き出しに並べる経路の上限。
 *
 * ⚠️ 地図を覆わないための上限であって、経路の本数の上限ではない。
 * ⑤やminimaxまで出すと吹き出しが縦に伸びて、肝心の線が見えなくなる。 */
const MAX_ROWS = 3

interface CalloutRow {
  color: string
  dashed: boolean
  label: string
  /** 距離と所要 */
  detail: string
  /** 危険区間。カタログ未取得のあいだは null */
  risk: string | null
  /** 未評価区間の但し書き。0のときは null */
  unevaluated: string | null
}

/** APIが配るキー名で `stats` を引く（`RouteTable` の `num` と同じ理由）。 */
function num(stats: RouteStats, key: string): number {
  const v = (stats as unknown as Record<string, unknown>)[key]
  return typeof v === 'number' ? v : 0
}

function rowOf(id: RouteId, label: string, stats: RouteStats, risk?: HazardRisk): CalloutRow {
  const style = STYLE[id]
  const unevaluated = risk ? num(stats, risk.coverage_key) : 0
  return {
    color: style.color,
    dashed: style.dash !== null,
    label,
    detail: `${km(stats.distance_m)}・徒歩${Math.round(stats.duration_min_60)}分`,
    risk: risk ? `${risk.label} ${pct(num(stats, risk.ratio_key))}` : null,
    unevaluated: unevaluated > 0 ? `※${pct(unevaluated)}は評価範囲外` : null,
  }
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 線の見本。破線は経路の見た目に合わせる（色だけだと最短と区別できない） */
function swatch({ color, dashed }: CalloutRow): string {
  const background = dashed
    ? `repeating-linear-gradient(90deg,${color} 0 4px,transparent 4px 7px)`
    : color
  return `<span style="display:inline-block;width:14px;height:3px;flex:none;border-radius:2px;background:${background}"></span>`
}

function render(typeLabel: string | null, name: string, rows: CalloutRow[]): string {
  const head = [
    typeLabel
      ? `<div class="map-text-8" style="color:#64748b;line-height:1.3">${escapeHtml(typeLabel)}</div>`
      : '',
    `<div class="map-text-11" style="font-weight:700;color:#0f172a;line-height:1.3">${escapeHtml(name)}</div>`,
  ].join('')
  const body = rows
    .map(
      (row) =>
        `<div style="margin-top:4px">` +
        `<div class="map-text-9" style="display:flex;align-items:center;gap:4px;font-weight:700;color:#07156f;line-height:1.3">${swatch(row)}<span>${escapeHtml(row.label)}</span></div>` +
        `<div class="map-text-9" style="color:#475569;line-height:1.35">${escapeHtml(row.detail)}${row.risk ? `・${escapeHtml(row.risk)}` : ''}</div>` +
        (row.unevaluated
          ? `<div class="map-text-8" style="color:#b45309;line-height:1.3">${escapeHtml(row.unevaluated)}</div>`
          : '') +
        `</div>`,
    )
    .join('')
  // 移動・閉じる操作は表示側のReact部品が付ける。HTMLは内容だけを持つ。
  return `<div style="min-width:118px;max-width:186px">${head}${body}</div>`
}

/** 吹き出しの向きを決めるとき、経路の終端から何点さかのぼって見るか。
 *
 * ⚠️ **最後の1本の線分だけ見ない。** 避難先の直前は敷地内の短い枝道で、
 * 全体の向きと逆を向いていることがある。数点ぶんの平均で「どちらから来たか」を見る。 */
const TAIL_POINTS = 8

/** 置ける向きと、その向きの単位ベクトル（x=東, y=北）。
 *
 * ⚠️ **8方位ある。** 4方位だと経路が斜めから入るときに逃げ場が無く、経路に
 * かぶるか画面の外に出るかのどちらかになった（ユーザー指摘、2026-08-23）。
 *
 * ⚠️ **並び順が優先順位。** 同点なら先にあるものを選ぶ。上が空いていれば上に
 * 出すのが読みやすく、ピンの逃がし方（`CALLOUT_LIFT`）も上向きで作ってある。 */
const D = Math.SQRT1_2
const DIRECTIONS: [CalloutAnchor, number, number][] = [
  ['top', 0, 1],
  ['top-right', D, D],
  ['top-left', -D, D],
  ['bottom', 0, -1],
  ['bottom-right', D, -D],
  ['bottom-left', -D, -D],
  ['right', 1, 0],
  ['left', -1, 0],
]

/** 経路を避けることを、出発地の側へ寄せることより**どれだけ重く見るか**。
 *
 * ⚠️ 経路にかぶると数字も線も読めないので、こちらが先。出発地の向きは
 * 同じくらい空いている向きが複数あるときの決め手にだけ使う。 */
const ROUTE_WEIGHT = 4

/** 地点の近くで経路が伸びている向き。**その向きは避けて吹き出しを出す。** */
function tailVectors(
  bundle: Bundle,
  routes: RouteId[],
  [lon, lat]: [number, number],
): [number, number][] {
  const kx = Math.cos((lat * Math.PI) / 180) || 1e-6
  const out: [number, number][] = []
  for (const feature of bundle.geojson.features) {
    const props = feature.properties as FeatureProps
    if (props.kind !== 'route' || !routes.includes(props.route)) continue
    const coords = feature.geometry.coordinates
    if (coords.length < 2) continue
    // ⚠️ **経路の向き（始点→終点）を決め打ちしない。** もう一方の避難先への線は
    //    行き先が違うので、この地点に近いほうの端から数える
    const head = coords[0]
    const tail = coords[coords.length - 1]
    const dHead = (head[0] - lon) ** 2 + (head[1] - lat) ** 2
    const dTail = (tail[0] - lon) ** 2 + (tail[1] - lat) ** 2
    const near = dHead < dTail ? coords : [...coords].reverse()
    for (const [px, py] of near.slice(0, TAIL_POINTS)) {
      const x = (px - lon) * kx
      const y = py - lat
      const len = Math.hypot(x, y)
      if (len > 0) out.push([x / len, y / len])
    }
  }
  return out
}

/** 経路がいちばん伸びていない向きを選ぶ。
 *
 * ⚠️ **経路の反対側へ出すだけでは足りない。** 2本の経路が別の方向から
 * 入ってくることがある（避難先の種類を両方選んだとき）。向きごとに
 * 「経路がどれだけそちらに寄っているか」を足し合わせ、**いちばん小さい向き**を選ぶ。
 */
export function pickAnchor(
  vectors: [number, number][],
  /** 地点から見た出発地の向き（単位ベクトル）。**画面はここを含むように
   * 収めるので、この側は必ず余地がある**（ユーザー指摘、2026-08-23）。 */
  toOrigin?: [number, number] | null,
): CalloutAnchor {
  let best: CalloutAnchor = 'top'
  let bestScore = Number.POSITIVE_INFINITY
  for (const [anchor, cx, cy] of DIRECTIONS) {
    // 反対向きの経路は 0 として数える（マイナスで打ち消し合わせない）
    const route = vectors.reduce((sum, [x, y]) => sum + Math.max(0, x * cx + y * cy), 0)
    // 出発地の側なら差し引く（小さいほど良い）
    const origin = toOrigin ? toOrigin[0] * cx + toOrigin[1] * cy : 0
    const score = route * ROUTE_WEIGHT - origin
    if (score < bestScore - 1e-9) {
      bestScore = score
      best = anchor
    }
  }
  return best
}

/** 地点から見た出発地の向き。経路が無い・同じ地点なら null */
function towardOrigin(bundle: Bundle, [lon, lat]: [number, number]): [number, number] | null {
  const [oLat, oLon] = bundle.od.origin.latlon
  const kx = Math.cos((lat * Math.PI) / 180) || 1e-6
  const x = (oLon - lon) * kx
  const y = oLat - lat
  const len = Math.hypot(x, y)
  return len > 0 ? [x / len, y / len] : null
}

/** 吹き出し1つの見込みの大きさ(px)。
 *
 * ⚠️ 実測値ではなく上限の見積り。`render` の `max-width` が186px、行数は最大3経路
 * ぶん。中身によって上下するが、**余白は多めに取るほうが安全**（足りないと
 * 画面の外に出て読めない）。 */
const CALLOUT_SIZE = { w: 200, h: 130 }

export interface Padding {
  top: number
  right: number
  bottom: number
  left: number
}

/** 吹き出しが画面からはみ出さないように、地図を収めるときの余白へ足す量。
 *
 * ⚠️ **経路の端＝吹き出しの位置**なので、経路だけを基準に収めると必ずはみ出す
 * （ユーザー指摘、2026-08-23）。
 *
 * ⚠️ **出ている向きだけを見ない。** 上に出すときの箱は**左右中央**なので、
 * 幅の半分ずつ左右にもはみ出す（実機で左端が切れた）。向きごとに、どの辺へ
 * どれだけ広がるかを持つ。
 *
 * ⚠️ **画面の一定割合で頭打ちにする。** スマホの幅で200px足すと、収める余地が
 * 無くなって地図が極端に引きの絵になる。
 */
export function calloutPadding(callouts: CalloutSpec[], size: { w: number; h: number }): Padding {
  const { w, h } = CALLOUT_SIZE
  const half = { w: w / 2, h: h / 2 }
  // 向き -> [上, 右, 下, 左] へ広がる量
  const extent: Record<CalloutAnchor, [number, number, number, number]> = {
    top: [h, half.w, 0, half.w],
    'top-right': [h, w, 0, 0],
    'top-left': [h, 0, 0, w],
    bottom: [0, half.w, h, half.w],
    'bottom-right': [0, w, h, 0],
    'bottom-left': [0, 0, h, w],
    right: [half.h, w, half.h, 0],
    left: [half.h, 0, half.h, w],
  }
  const need = [0, 0, 0, 0]
  for (const callout of callouts) {
    const e = extent[callout.anchor]
    for (let i = 0; i < 4; i++) need[i] = Math.max(need[i], e[i])
  }
  const capW = Math.max(0, size.w * 0.3)
  const capH = Math.max(0, size.h * 0.25)
  return {
    top: Math.min(need[0], capH),
    right: Math.min(need[1], capW),
    bottom: Math.min(need[2], capH),
    left: Math.min(need[3], capW),
  }
}

/** 2つの余白の大きいほうを取る（どちらの理由でも足りるようにする） */
export function mergePadding(base: Padding, extra: Padding): Padding {
  return {
    top: Math.max(base.top, extra.top),
    right: Math.max(base.right, extra.right),
    bottom: Math.max(base.bottom, extra.bottom),
    left: Math.max(base.left, extra.left),
  }
}

interface Options {
  /** 表示中の災害の危険区間定義。カタログ未取得のあいだは undefined */
  risk?: HazardRisk
  /** 消している経路は吹き出しにも出さない（チェックを外した数字が残らないように） */
  shown: Partial<Record<RouteId, boolean>>
  /** 掛け合わせた種別の呼び名。`alt_shelter` の行に使う（API由来） */
  hazardLabel?: string
  /** 吹き出しの×を押したとき。**押された吹き出しのIDを受ける**
   * （2つ出ているときに片方だけ閉じるため） */
  onDismiss?: (id: string) => void
  /** 閉じられている吹き出しのID。ここにあるものは出さない */
  hidden?: string[]
}

export function routeCallouts(bundle: Bundle | null, options: Options): CalloutSpec[] {
  if (!bundle) return []
  const { risk, shown, hazardLabel, onDismiss, hidden = [] } = options
  const list: CalloutSpec[] = []

  // ⚠️ **選ばれた経路を先頭にする。** APIの並びは最短が先だが、吹き出しは
  //    上から読まれるので、提案しているほうを先に置く
  const routes = [...bundle.routes]
    .filter((route) => shown[route.id] !== false)
    .sort((a, b) => Number(b.id === bundle.selected_route) - Number(a.id === bundle.selected_route))
    .slice(0, MAX_ROWS)

  if (routes.length > 0 && !hidden.includes('dest')) {
    const shelter = bundle.shelter
    // ⚠️ API の latlon は [lat, lon]。地図側は [lon, lat]
    const dest: [number, number] = [bundle.od.dest.latlon[1], bundle.od.dest.latlon[0]]
    list.push({
      id: 'dest',
      lngLat: dest,
      onDismiss: onDismiss && (() => onDismiss('dest')),
      anchor: pickAnchor(
        tailVectors(
          bundle,
          routes.map((route) => route.id),
          dest,
        ),
        towardOrigin(bundle, dest),
      ),
      html: render(
        shelter?.type_label ?? null,
        shelter?.name ?? bundle.od.dest.display,
        routes.map((route) => rowOf(route.id, route.label, route.stats, risk)),
      ),
    })
  }

  // ⚠️ もう一方の種類の避難先。**行き先が違うので別の吹き出し**にする。
  //    経路は1本しかなく、最短を引いていないので比較の数字は出せない
  const alt = bundle.alt_shelter
  // ⚠️ **もう一方の避難先にも最短経路が出るようになった**（2026-08-24）。
  //    おすすめ側と同じように、出ている経路をぜんぶ並べる
  const altRoutes = (bundle.alt_routes ?? [])
    .filter((route) => shown[route.id] !== false)
    // おすすめ側と同じく、選ばれた回避経路を最短経路より先に見せる。
    .sort((a, b) => Number(b.id === 'shelter_alt') - Number(a.id === 'shelter_alt'))
    .slice(0, MAX_ROWS)
  const altRows = altRoutes.length
    ? altRoutes.map((route) => rowOf(route.id, route.label, route.stats, risk))
    : shown.shelter_alt !== false && alt
      ? [rowOf('shelter_alt', altRouteLabel(hazardLabel), alt.stats, risk)]
      : []
  if (alt && altRows.length && !hidden.includes('alt')) {
    const at: [number, number] = [alt.latlon[1], alt.latlon[0]]
    list.push({
      id: 'alt',
      lngLat: at,
      onDismiss: onDismiss && (() => onDismiss('alt')),
      anchor: pickAnchor(
        tailVectors(
          bundle,
          altRoutes.length ? altRoutes.map((route) => route.id) : ['shelter_alt'],
          at,
        ),
        towardOrigin(bundle, at),
      ),
      html: render(alt.type_label, alt.name, altRows),
    })
  }

  return list
}
