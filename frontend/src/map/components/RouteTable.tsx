/** 経路の指標表。表示のON/OFFも兼ねる。
 *
 * ⚠️ **数値の意味を変えない。** `R4以上` は地域危険度ランク4以上を通る割合、
 * `0.3m超` は浸水深0.3m（歩行困難ライン）を超える区間の割合。
 * docs/findings/検証記録.md 10章と同じ定義（05_チーム移行案 §3-1「守るもの」）。
 */
import { STYLE, SUFFIX } from '../constants'
import { km, pct } from '../lib/format'
import type { Bundle, RouteId } from '../types'

interface Props {
  bundle: Bundle
  shown: Record<RouteId, boolean>
  onToggle: (id: RouteId, on: boolean) => void
}

export function RouteTable({ bundle, shown, onToggle }: Props) {
  return (
    <table className="mt-2 w-full border-collapse text-[11px]">
      <thead>
        <tr className="[&>th]:border-b [&>th]:border-slate-200 [&>th]:px-0.5 [&>th]:py-1 [&>th]:text-right [&>th:first-child]:text-left">
          <th />
          <th>距離</th>
          <th>0.3m超</th>
          <th>最大深</th>
          <th>R4以上</th>
        </tr>
      </thead>
      <tbody>
        {bundle.routes.map((r) => (
          <tr
            key={r.id}
            className={`[&>td]:border-b [&>td]:border-slate-100 [&>td]:px-0.5 [&>td]:py-1 [&>td]:text-right [&>td:first-child]:text-left ${shown[r.id] ? '' : 'opacity-40'}`}
          >
            <td>
              <label
                className="flex min-h-8 cursor-pointer items-center gap-1.5 max-[700px]:min-h-11"
                title={SUFFIX[r.id] ? `${r.desc}（${SUFFIX[r.id]}）` : r.desc}
              >
                <input
                  type="checkbox"
                  className="size-4"
                  checked={shown[r.id]}
                  onChange={(e) => onToggle(r.id, e.target.checked)}
                />
                <span style={{ color: STYLE[r.id].color }}>{r.no}</span> {r.label}
              </label>
            </td>
            <td>{km(r.stats.distance_m)}</td>
            <td>{pct(r.stats.ratio_over_03)}</td>
            <td>{r.stats.max_depth_m.toFixed(2)}m</td>
            <td>{pct(r.stats.quake_r4plus_ratio)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
