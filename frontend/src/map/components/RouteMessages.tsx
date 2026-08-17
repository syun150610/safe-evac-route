/** 経路の判定文と、比較用経路を提案と誤解させないための警告。 */
import { pct } from '../lib/format'
import { delta, VERDICT_TEXT, verdictOf } from '../lib/verdict'
import type { Bundle, RouteId, RouteInfo } from '../types'

interface Props {
  bundle: Bundle
  shown: Record<RouteId, boolean>
}

function routeOf(bundle: Bundle, id: RouteId): RouteInfo | undefined {
  return bundle.routes.find((route) => route.id === id)
}

export function RouteMessages({ bundle, shown }: Props) {
  const baseline = routeOf(bundle, 'baseline')
  const flood = routeOf(bundle, 'flood')
  const combined = routeOf(bundle, 'combined')
  const quake = routeOf(bundle, 'quake')

  const distanceDelta =
    baseline && combined ? combined.stats.distance_m - baseline.stats.distance_m : 0
  const distanceDeltaPct =
    baseline && combined && baseline.stats.distance_m > 0
      ? (distanceDelta / baseline.stats.distance_m) * 100
      : 0
  const durationDelta =
    baseline && combined ? combined.stats.duration_min_80 - baseline.stats.duration_min_80 : 0
  const floodDistanceDeltaPct =
    flood && combined && flood.stats.distance_m > 0
      ? ((combined.stats.distance_m - flood.stats.distance_m) / flood.stats.distance_m) * 100
      : null

  return (
    <div className="mt-2 space-y-2 text-[11px] leading-relaxed">
      {baseline && combined && (
        <div className="rounded-md border border-green-200 bg-green-50 px-2 py-1.5 text-green-950">
          <b>推奨は ④（浸水×地震）。</b>①より{' '}
          <b className="text-green-800">
            {distanceDelta >= 0 ? '+' : ''}
            {distanceDelta.toFixed(0)}m（{distanceDeltaPct.toFixed(1)}%・徒歩
            {durationDelta.toFixed(1)}分）
          </b>
          で、0.3m超の通過率が{' '}
          <b>
            {pct(baseline.stats.ratio_over_03)} → {pct(combined.stats.ratio_over_03)}
          </b>
          、地震R4以上が{' '}
          <b>
            {pct(baseline.stats.quake_r4plus_ratio)} → {pct(combined.stats.quake_r4plus_ratio)}
          </b>
          。<b>{VERDICT_TEXT[verdictOf(baseline.stats, combined.stats)]}</b>
          {floodDistanceDeltaPct !== null && (
            <>
              <br />
              ②（浸水のみ）との距離差は{' '}
              <b>
                {floodDistanceDeltaPct >= 0 ? '+' : ''}
                {floodDistanceDeltaPct.toFixed(1)}%
              </b>
              。ほぼ同じ距離で地震リスクも見られるので、②ではなく④を既定にしている。
            </>
          )}
        </div>
      )}

      {quake && shown.quake && (
        <div
          className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-amber-950"
          role="note"
        >
          <b>⑤は提案経路ではない。</b>
          片方のハザードだけを見た場合に何が起きるかを示す比較用。
          {combined && (
            <>
              推奨の④と比べると、地震R4以上は {pct(combined.stats.quake_r4plus_ratio)} →{' '}
              <b>{pct(quake.stats.quake_r4plus_ratio)}</b>
              {delta(quake.stats.quake_r4plus_ratio, combined.stats.quake_r4plus_ratio)}が、0.3m超は{' '}
              {pct(combined.stats.ratio_over_03)} → <b>{pct(quake.stats.ratio_over_03)}</b>
              、最大浸水深は{' '}
              <b>
                {combined.stats.max_depth_m.toFixed(2)}m → {quake.stats.max_depth_m.toFixed(2)}m
              </b>
              {delta(quake.stats.max_depth_m, combined.stats.max_depth_m, true)}。
            </>
          )}
        </div>
      )}
    </div>
  )
}
