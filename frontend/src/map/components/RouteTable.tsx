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
import { STYLE } from '../constants'
import type { Bundle, HazardRisk, Rationale, RouteId, RouteInfo, RouteStats } from '../types'

interface Props {
  bundle: Bundle
  shown: Partial<Record<RouteId, boolean>>
  /** 種類を両方選んだときの「もう一方の避難先」。列を分けて並べる */
  alt?: Bundle['alt_shelter']
  /** もう一方の避難先への経路（最短＋掛け合わせ）。⚠️ `bundle.routes` とは別物 */
  altRoutes?: Bundle['alt_routes']
  /** 表示中の災害の危険区間定義。カタログ未取得のあいだは undefined */
  risk?: HazardRisk
  /** 選ばれた種別の根拠。数値の出所はここ（フロントで引き算しない） */
  /** 掛け合わせた種別。⚠️ **数値の要約はここでは出さない**（`RouteRationale` の
   * `lead` に1つへまとめた。2026-08-24）。もう一方の経路名と未評価の強調に使う */
  hazard: Rationale['hazards'][number] | null
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
        {/* ⚠️ **丸ではなくピンの形にする。** 丸だと下の行に並ぶ「線の色見本」と
            同じ種類の印に見えるが、こちらが表すのは**地図のピンの色**（避難先の
            種類）で、線の色（経路の色）とは別物。同時に2種類出したときに
            「凡例と色が違う」と読まれた（ユーザー指摘、2026-08-24） */}
        <svg
          aria-hidden="true"
          className={`shrink-0 ${dot}`}
          viewBox="0 0 24 36"
          width="8"
          height="12"
        >
          <path
            d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z"
            fill="currentColor"
          />
          <circle cx="12" cy="12" r="5" fill="#fff" />
        </svg>
        <em className="text-[8px] text-slate-500 not-italic">{typeLabel}</em>
      </span>
      <strong className="truncate text-[11px]" title={name}>
        {name}
      </strong>
    </div>
  )
}

/** 経路1本ぶんの行。**おすすめ側ともう一方の避難先で同じ形にする。**
 *
 * ⚠️ もう一方にも最短経路が出るようになった（2026-08-24）。片方だけ形が違うと、
 * 同じものを比べているように見えない。 */
function RouteRow({
  route,
  shown,
  risk,
  selected,
  warnUnevaluated,
  onToggle,
}: {
  route: RouteInfo
  shown: Partial<Record<RouteId, boolean>>
  risk?: HazardRisk
  selected: boolean
  warnUnevaluated: boolean
  onToggle: (id: RouteId, shown: boolean) => void
}) {
  const unevaluated = risk ? num(route.stats, risk.coverage_key) : 0
  // 破線かどうかも `STYLE` に従う（地図の線と同じ見え方にする）
  const dashed = STYLE[route.id].dash !== null
  return (
    <label
      className={`grid min-w-[150px] flex-1 grid-cols-[auto_18px_1fr] items-center gap-2 rounded-lg border p-3 transition-opacity [&_span>em]:block [&_span>em]:text-[9px] [&_span>em]:font-bold [&_span>em]:text-[#07156f] [&_span>em]:not-italic [&_span>small]:my-1 [&_span>small]:block [&_span>small]:text-[9px] [&_span>small]:text-slate-500 [&_span>strong]:block [&_span>strong]:text-[11px] ${selected ? 'border-indigo-300 bg-indigo-50/60' : 'border-slate-200'} ${shown[route.id] === false ? 'opacity-45' : ''}`}
    >
      <input
        type="checkbox"
        checked={shown[route.id] !== false}
        onChange={(event) => onToggle(route.id, event.target.checked)}
      />
      {/* ⚠️ **色は `STYLE` から引く**（2026-08-24）。ここで色名を書くと、
          地図の線・吹き出しと食い違う */}
      <span
        aria-hidden="true"
        className="h-1 rounded-full"
        style={
          dashed
            ? {
                backgroundImage: `repeating-linear-gradient(90deg,${STYLE[route.id].color} 0 5px,transparent 5px 8px)`,
              }
            : { background: STYLE[route.id].color }
        }
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
}

export function RouteTable({ bundle, shown, alt, altRoutes, risk, hazard, onToggle }: Props) {
  // ⚠️ 閾値はAPI側。ここで unevaluated_ratio を閾値と比べ直さない
  const warnUnevaluated = hazard?.unevaluated_stage === 'warn'
  const shelter = bundle.shelter
  // ⚠️ **並びは「まず逃げ込む先」が先。** 推奨がどちらでも順番は変えない
  const primaryFirst = !alt || shelter?.type === 'urgent'

  const primaryColumn = (
    <div className="min-w-0" data-shelter-kind={shelter?.type}>
      {alt && shelter && (
        <ColumnHead
          dot={shelter.type === 'urgent' ? 'text-green-600' : 'text-amber-500'}
          name={shelter.name}
          typeLabel={shelter.type_label}
        />
      )}
      <div className={alt ? 'grid gap-2' : 'flex flex-wrap gap-2'}>
        {bundle.routes.map((route) => (
          <RouteRow
            key={route.id}
            onToggle={onToggle}
            risk={risk}
            route={route}
            selected={route.id === bundle.selected_route}
            shown={shown}
            warnUnevaluated={warnUnevaluated}
          />
        ))}
      </div>
    </div>
  )

  // ⚠️ **もう一方の避難先も、おすすめと同じ形で並べる。** 以前は掛け合わせた
  //    経路1本だけで、遠回りなのかどうかを言えなかった（2026-08-24の指摘）
  const altColumn =
    alt && altRoutes?.length ? (
      <div className="min-w-0" data-shelter-kind={alt.type}>
        <ColumnHead
          dot={alt.type === 'urgent' ? 'text-green-600' : 'text-amber-500'}
          name={alt.name}
          typeLabel={alt.type_label}
        />
        <div className="grid gap-2">
          {altRoutes.map((route) => (
            <RouteRow
              key={route.id}
              onToggle={onToggle}
              risk={risk}
              route={route}
              selected={route.id === 'shelter_alt'}
              shown={shown}
              warnUnevaluated={warnUnevaluated}
            />
          ))}
        </div>
      </div>
    ) : null

  return (
    <>
      <h3 className="mt-5 mb-2 text-[13px]">経路を比較</h3>
      {/* ⚠️ **2種類を両方選んでいるときは、避難先ごとに列を分ける。**
          1つの表に混ぜると、どの数字がどちらの避難先のものか分からない */}
      <div className={`mb-2 grid items-start gap-2 ${altColumn ? 'grid-cols-2' : ''}`}>
        {primaryFirst ? primaryColumn : altColumn}
        {primaryFirst ? altColumn : primaryColumn}
      </div>
    </>
  )
}
