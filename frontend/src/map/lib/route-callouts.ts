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
import type { CalloutSpec } from '../adapters/types'
import { STYLE } from '../constants'
import type { Bundle, HazardRisk, RouteId, RouteStats } from '../types'
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
      ? `<div style="font-size:8px;color:#64748b;line-height:1.3">${escapeHtml(typeLabel)}</div>`
      : '',
    `<div style="font-size:11px;font-weight:700;color:#0f172a;line-height:1.3">${escapeHtml(name)}</div>`,
  ].join('')
  const body = rows
    .map(
      (row) =>
        `<div style="margin-top:4px">` +
        `<div style="display:flex;align-items:center;gap:4px;font-size:9px;font-weight:700;color:#07156f;line-height:1.3">${swatch(row)}<span>${escapeHtml(row.label)}</span></div>` +
        `<div style="font-size:9px;color:#475569;line-height:1.35">${escapeHtml(row.detail)}${row.risk ? `・${escapeHtml(row.risk)}` : ''}</div>` +
        (row.unevaluated
          ? `<div style="font-size:8px;color:#b45309;line-height:1.3">${escapeHtml(row.unevaluated)}</div>`
          : '') +
        `</div>`,
    )
    .join('')
  return `<div style="min-width:118px;max-width:186px">${head}${body}</div>`
}

interface Options {
  /** 表示中の災害の危険区間定義。カタログ未取得のあいだは undefined */
  risk?: HazardRisk
  /** 消している経路は吹き出しにも出さない（チェックを外した数字が残らないように） */
  shown: Partial<Record<RouteId, boolean>>
  /** 掛け合わせた種別の呼び名。`alt_shelter` の行に使う（API由来） */
  hazardLabel?: string
}

export function routeCallouts(bundle: Bundle | null, options: Options): CalloutSpec[] {
  if (!bundle) return []
  const { risk, shown, hazardLabel } = options
  const list: CalloutSpec[] = []

  // ⚠️ **選ばれた経路を先頭にする。** APIの並びは最短が先だが、吹き出しは
  //    上から読まれるので、提案しているほうを先に置く
  const routes = [...bundle.routes]
    .filter((route) => shown[route.id] !== false)
    .sort((a, b) => Number(b.id === bundle.selected_route) - Number(a.id === bundle.selected_route))
    .slice(0, MAX_ROWS)

  if (routes.length > 0) {
    const shelter = bundle.shelter
    list.push({
      id: 'dest',
      // ⚠️ API の latlon は [lat, lon]。地図側は [lon, lat]
      lngLat: [bundle.od.dest.latlon[1], bundle.od.dest.latlon[0]],
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
  if (alt && shown.shelter_alt !== false) {
    list.push({
      id: 'alt',
      lngLat: [alt.latlon[1], alt.latlon[0]],
      html: render(alt.type_label, alt.name, [
        rowOf('shelter_alt', altRouteLabel(hazardLabel), alt.stats, risk),
      ]),
    })
  }

  return list
}
