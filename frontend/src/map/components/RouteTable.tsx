/** 経路の表示切替と主要指標の比較カード。
 *
 * ⚠️ **危険区間の呼び名と統計キーをここに書かない。** どちらも API が配る
 * （`/api/hazards` の `hazards[].risk`。出所は `backend/prep/hazard_sources/registry.py`）。
 * 種別ごとの分岐を書くと、災害が増えるたびにこのファイルの修正が要る。
 *
 * ⚠️ **未評価区間を隠さない。** 危険区間が0%でも、その経路の大半が整備範囲の外なら
 * 「安全」ではなく「判断材料が無い」。実測で経路の74.9%が想定図の範囲外だったODがある。
 * 閾値の判定はAPI（`rationale.hazards[].unevaluated_stage`）に任せ、
 * **ここで割合と閾値を比べ直さない。**
 */
import type { Bundle, HazardRisk, Rationale, RouteId, RouteStats } from '../types'

interface Props {
  bundle: Bundle
  shown: Partial<Record<RouteId, boolean>>
  /** 表示中の災害の危険区間定義。カタログ未取得のあいだは undefined */
  risk?: HazardRisk
  /** 選ばれた種別の根拠。数値の出所はここ（フロントで引き算しない） */
  hazard: Rationale['hazards'][number] | null
  distance: Rationale['distance'] | null
  onToggle: (id: RouteId, shown: boolean) => void
}

/** APIが配るキー名（`hazards[].risk`）で `stats` を引く。
 *
 * ⚠️ `RouteStats` へ添字シグネチャを足さないこと。`RouteProps` がこれを extends
 * していて、文字列プロパティと衝突する。参照はここ1箇所に閉じる。
 */
function num(stats: RouteStats, key: string): number {
  const v = (stats as unknown as Record<string, unknown>)[key]
  return typeof v === 'number' ? v : 0
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`
const km = (m: number) => `${(m / 1000).toFixed(2)} km`

export function RouteTable({ bundle, shown, risk, hazard, distance, onToggle }: Props) {
  // ⚠️ 閾値はAPI側。ここで unevaluated_ratio を閾値と比べ直さない
  const warnUnevaluated = hazard?.unevaluated_stage === 'warn'

  return (
    <>
      <h3 className="mt-5 mb-2 text-[13px]">経路を比較</h3>
      {bundle.routes.map((route) => {
        const unevaluated = risk ? num(route.stats, risk.coverage_key) : 0
        return (
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
                徒歩約{Math.round(route.stats.duration_min_60)}分・{km(route.stats.distance_m)}
              </small>
              {risk && (
                <em>
                  {risk.label} {pct(num(route.stats, risk.ratio_key))}
                </em>
              )}
              {/* 危険区間0%を「安全」と読ませないための但し書き。API が warn を出したときだけ */}
              {warnUnevaluated && unevaluated > 0 && (
                <span className="mt-0.5 block text-[9px] text-amber-700">
                  ※{pct(unevaluated)}は評価範囲外
                </span>
              )}
            </span>
          </label>
        )
      })}
      {hazard && distance && (
        <div className="mt-3 grid grid-cols-2 gap-1.5 [&>span]:rounded-lg [&>span]:bg-slate-100 [&>span]:px-1 [&>span]:py-2.5 [&>span]:text-center [&>span]:text-[8px] [&>span]:text-slate-500 [&_strong]:mt-1 [&_strong]:block [&_strong]:text-[11px] [&_strong]:text-slate-800">
          <span>
            {hazard.risk_label}
            <strong>{Math.round(hazard.after_m).toLocaleString()} m</strong>
          </span>
          <span>
            最短との差
            <strong>{Math.round(distance.selected_min_60 - distance.baseline_min_60)}分</strong>
          </span>
        </div>
      )}
    </>
  )
}
