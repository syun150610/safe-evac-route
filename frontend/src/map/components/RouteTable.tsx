import type { Bundle, RouteId } from '../types'
import type { HazardChoice } from './HazardPicker'

interface Props {
  bundle: Bundle
  shown: Partial<Record<RouteId, boolean>>
  hazard: HazardChoice
  onToggle: (id: RouteId, shown: boolean) => void
}

/** 経路の表示切替と主要指標を、モック準拠の比較カードで表示する。 */
export function RouteTable({ bundle, shown, hazard, onToggle }: Props) {
  const selected = bundle.routes.find((route) => route.id === bundle.selected_route)
  const baseline = bundle.routes.find((route) => route.id === 'baseline')

  return (
    <>
      <h3 className="mt-5 mb-2 text-[13px]">経路を比較</h3>
      {bundle.routes.map((route) => (
        <label
          className={`mb-2 grid grid-cols-[auto_18px_1fr] items-center gap-2 rounded-lg border p-3 transition-opacity [&_span>em]:block [&_span>em]:text-[9px] [&_span>em]:font-bold [&_span>em]:text-[#07156f] [&_span>em]:not-italic [&_span>small]:my-1 [&_span>small]:block [&_span>small]:text-[9px] [&_span>small]:text-slate-500 [&_span>strong]:block [&_span>strong]:text-[11px] ${route.id === bundle.selected_route ? 'border-indigo-300 bg-indigo-50/60' : 'border-slate-200'} ${shown[route.id] === false ? 'opacity-45' : ''}`}
          key={route.id}
        >
          <input
            type="checkbox"
            checked={shown[route.id] !== false}
            onChange={(event) => onToggle(route.id, event.target.checked)}
          />
          <span
            className={`h-1 rounded-full ${route.id === 'baseline' ? '[background:repeating-linear-gradient(90deg,#64748b_0_5px,transparent_5px_8px)]' : 'bg-[#07156f]'}`}
          />
          <span>
            <strong>
              {route.no} {route.label}
            </strong>
            <small>
              徒歩約{Math.round(route.stats.duration_min_60)}分・
              {(route.stats.distance_m / 1000).toFixed(2)} km
            </small>
            <em>
              {hazard === 'quake'
                ? `地震R4以上 ${(route.stats.quake_r4plus_ratio * 100).toFixed(1)}%`
                : `0.3m超区間 ${(route.stats.ratio_over_03 * 100).toFixed(1)}%`}
            </em>
          </span>
        </label>
      ))}
      {selected && baseline && (
        <div className="mt-3 grid grid-cols-3 gap-1.5 [&>span]:rounded-lg [&>span]:bg-slate-100 [&>span]:px-1 [&>span]:py-2.5 [&>span]:text-center [&>span]:text-[8px] [&>span]:text-slate-500 [&_strong]:mt-1 [&_strong]:block [&_strong]:text-[11px] [&_strong]:text-slate-800">
          <span>
            最大浸水深<strong>{selected.stats.max_depth_m.toFixed(2)} m</strong>
          </span>
          <span>
            地震R4以上<strong>{(selected.stats.quake_r4plus_ratio * 100).toFixed(1)}%</strong>
          </span>
          <span>
            最短との差
            <strong>
              {Math.round(selected.stats.duration_min_60 - baseline.stats.duration_min_60)}分
            </strong>
          </span>
        </div>
      )}
    </>
  )
}
