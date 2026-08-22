/** 地図に重ねている災害の凡例。
 *
 * ⚠️ **色もラベルもここで持たない。** API（`/api/hazards` の `hazards[].legend`）が
 * そのまま描ける形で返す。出所は
 * `backend/prep/hazard_sources/quake/source.py` と `app/services/hazards/catalog.py`。
 * ここに書き写すと「凡例の色と地図の色が違う」が起きる。
 *
 * ⚠️ **ハッチ項目（`hatch: true`）を落とさない。** 調査・整備の範囲外は
 * 「危険度が低い」ではなく「評価されていない」。消すと、データが無いだけの場所が
 * 安全に見える（`backend/prep/hazard_sources/base.py` が禁じている読み違え）。
 * `note` も一緒に出す。
 */
import type { LegendItem } from '../types'

/** 斜線チップ。ハッチは色を持たないので、CSSで描く */
const HATCH = 'repeating-linear-gradient(45deg,#94a3b8 0 2px,transparent 2px 5px)'

function Chip({ item }: { item: LegendItem }) {
  return (
    <span
      aria-hidden="true"
      className="mt-0.5 size-3 shrink-0 rounded-[3px] border border-slate-300"
      style={item.hatch ? { backgroundImage: HATCH } : { background: item.color }}
    />
  )
}

interface Props {
  /** 種別名（"地震"）。見出しに使う */
  hazardLabel: string
  items: LegendItem[]
}

export function HazardLegend({ hazardLabel, items }: Props) {
  if (!items.length) return null
  return (
    <section className="mt-4 rounded-[10px] border border-slate-200 bg-slate-50 p-2.5">
      <h3 className="m-0 mb-1.5 text-[10px] text-slate-600">{hazardLabel}の凡例</h3>
      <ul className="grid gap-1">
        {items.map((item) => (
          <li className="flex items-start gap-1.5 text-[10px] leading-snug" key={item.label}>
            <Chip item={item} />
            <span className="flex-1">
              <span className="text-slate-700">{item.label}</span>
              {item.note && (
                <span className="mt-0.5 block text-[9px] text-slate-500">{item.note}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
