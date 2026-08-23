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
import { altRouteLabel } from '../lib/format'
import type { Bundle, HazardRisk, Rationale, RouteId, RouteStats } from '../types'

interface Props {
  bundle: Bundle
  shown: Partial<Record<RouteId, boolean>>
  /** 種類を両方選んだときの「もう一方の避難先」。列を分けて並べる */
  alt?: Bundle['alt_shelter']
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

/** 列の見出し。**どの避難先の数字なのかを必ず書く。**
 *
 * ⚠️ これが無いと、2種類を両方選んだときに「経路を比較」の数字がどちらの
 * 避難先のものか分からない（2026-08-23の指摘）。
 */
function ColumnHead({ typeLabel, name, dot }: { typeLabel: string; name: string; dot: string }) {
  return (
    <div className="mb-1.5 grid gap-0.5">
      <span className="flex items-center gap-1.5">
        <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${dot}`} />
        <em className="text-[8px] text-slate-500 not-italic">{typeLabel}</em>
      </span>
      <strong className="truncate text-[11px]" title={name}>
        {name}
      </strong>
    </div>
  )
}

export function RouteTable({ bundle, shown, alt, risk, hazard, distance, onToggle }: Props) {
  // ⚠️ 閾値はAPI側。ここで unevaluated_ratio を閾値と比べ直さない
  const warnUnevaluated = hazard?.unevaluated_stage === 'warn'
  const shelter = bundle.shelter
  // ⚠️ **並びは「まず逃げ込む先」が先。** 推奨がどちらでも順番は変えない
  const primaryFirst = !alt || shelter?.type === 'urgent'

  const primaryColumn = (
    <div className="min-w-[150px] flex-1">
      {alt && shelter && (
        <ColumnHead
          dot={shelter.type === 'urgent' ? 'bg-green-600' : 'bg-amber-500'}
          name={shelter.name}
          typeLabel={shelter.type_label}
        />
      )}
      <div className={alt ? 'grid gap-2' : 'flex flex-wrap gap-2'}>
        {bundle.routes.map((route) => {
          const unevaluated = risk ? num(route.stats, risk.coverage_key) : 0
          return (
            <label
              className={`grid min-w-[150px] flex-1 grid-cols-[auto_18px_1fr] items-center gap-2 rounded-lg border p-3 transition-opacity [&_span>em]:block [&_span>em]:text-[9px] [&_span>em]:font-bold [&_span>em]:text-[#07156f] [&_span>em]:not-italic [&_span>small]:my-1 [&_span>small]:block [&_span>small]:text-[9px] [&_span>small]:text-slate-500 [&_span>strong]:block [&_span>strong]:text-[11px] ${route.id === bundle.selected_route ? 'border-indigo-300 bg-indigo-50/60' : 'border-slate-200'} ${shown[route.id] === false ? 'opacity-45' : ''}`}
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
                {/* ⚠️ **経路番号（①⑤）を出さない。** 色の見本が隣にあるので
                  地図の線とは対応づけられる。番号は語彙が増えるだけ */}
                <strong>{route.label}</strong>
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
      </div>
    </div>
  )

  // ⚠️ もう一方は経路が1本だけ（掛け合わせを掛けた経路）。**無い数字は出さない。**
  const altColumn = alt ? (
    <div className="min-w-[150px] flex-1">
      <ColumnHead
        dot={alt.type === 'urgent' ? 'bg-green-600' : 'bg-amber-500'}
        name={alt.name}
        typeLabel={alt.type_label}
      />
      <label
        className={`grid grid-cols-[auto_18px_1fr] items-center gap-2 rounded-lg border border-slate-200 p-3 transition-opacity [&_span>em]:block [&_span>em]:text-[9px] [&_span>em]:font-bold [&_span>em]:text-[#07156f] [&_span>em]:not-italic [&_span>small]:my-1 [&_span>small]:block [&_span>small]:text-[9px] [&_span>small]:text-slate-500 [&_span>strong]:block [&_span>strong]:text-[11px] ${
          shown.shelter_alt === false ? 'opacity-45' : ''
        }`}
      >
        <input
          type="checkbox"
          checked={shown.shelter_alt !== false}
          onChange={(event) => onToggle('shelter_alt', event.target.checked)}
        />
        <span className="h-1 rounded-full [background:repeating-linear-gradient(90deg,#b45309_0_5px,transparent_5px_8px)]" />
        <span>
          <strong>{altRouteLabel(hazard?.label)}</strong>
          <small>
            徒歩約{Math.round(alt.stats.duration_min_60)}分・{km(alt.stats.distance_m)}
          </small>
          {risk && (
            <em>
              {risk.label} {pct(num(alt.stats, risk.ratio_key))}
            </em>
          )}
        </span>
      </label>
    </div>
  ) : null

  return (
    <>
      <h3 className="mt-5 mb-2 text-[13px]">経路を比較</h3>
      {/* ⚠️ **2種類を両方選んでいるときは、避難先ごとに列を分ける。**
          1つの表に混ぜると、どの数字がどちらの避難先のものか分からない */}
      <div className="mb-2 flex flex-wrap items-start gap-3">
        {primaryFirst ? primaryColumn : altColumn}
        {primaryFirst ? altColumn : primaryColumn}
      </div>
      {hazard && distance && (
        <>
          {/* ⚠️ この2つは**おすすめの避難先についての数字**。もう一方には
            最短経路を引いていないので、同じ比較はできない */}
          {alt && shelter && (
            <p className="mt-3 text-[9px] text-slate-500">{`${shelter.name}への経路について`}</p>
          )}
          <div className="mt-1 grid grid-cols-2 gap-1.5 [&>span]:rounded-lg [&>span]:bg-slate-100 [&>span]:px-1 [&>span]:py-2.5 [&>span]:text-center [&>span]:text-[8px] [&>span]:text-slate-500 [&_strong]:mt-1 [&_strong]:block [&_strong]:text-[11px] [&_strong]:text-slate-800">
            <span>
              {hazard.risk_label}
              <strong>{Math.round(hazard.after_m).toLocaleString()} m</strong>
            </span>
            <span>
              最短との差
              <strong>{Math.round(distance.selected_min_60 - distance.baseline_min_60)}分</strong>
            </span>
          </div>
        </>
      )}
    </>
  )
}
