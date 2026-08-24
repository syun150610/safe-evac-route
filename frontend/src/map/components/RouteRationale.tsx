/** 「なぜこの経路なのか」の根拠。短文＋タップで詳細4行。
 *
 * ## UI改修時の引き継ぎ
 *
 * **この部品は props が `rationale` 1つだけの自己完結型。** 画面定義書に沿って
 * レイアウトを作り直すときは、置き場所を変えるだけでそのまま動く。
 * 分解して EvacRouteMap 側へ散らさないこと。
 *
 * ⚠️ **数値入りの説明と詳細4行をここで組み立てない。** APIが完成した文字列で返す
 * （`backend/app/services/evac_routes/rationale.py` が単一の出所）。一覧用の短い評価だけは
 * API契約を変えず、安定した判定値を `lib/rationale-summary.ts` で言い換える。
 * 数値を強調したくなったら `h.before_m` などを使う（文言は組み直さない）。
 *
 * ⚠️ **災害種別をここに書かない。** 「浸水30cm超」「危険度4以上」は
 * `backend/prep/hazard_sources/registry.py` の `risk` ブロック由来。
 * **種別が増えてもこのファイルは無変更。**
 *
 * ⚠️ **未評価区間を落とさない。** カバー外は「安全」ではなく「判断材料が無い」。
 * `unevaluated_note` は3段階とも必ず来るので、条件を付けて隠さないこと。
 * 強さの出し分けは `unevaluated_stage` だけを見る。**割合と閾値をここで
 * 比べ直さない**（閾値はAPI側にあり、詳細4行の「条件」にも出ている）。
 *
 * ⚠️ **並び順を変えない。** 「全区間評価済みの種別が先、未評価のある種別が後」に
 * API側で並べてある。確かなことから先に述べるため。
 */
import { useState } from 'react'

import { rationaleSummary } from '../lib/rationale-summary'
import type { Rationale, RationaleHazard } from '../types'

/** 回避できたことが伝わる状態か。色分けにだけ使う */
const GOOD = new Set(['avoided', 'already_safe'])

/** 未評価の伝え方の強さ。**閾値はAPI側にあり、ここでは割合を比べ直さない。**
 * none は「数値をそのまま信じてよい」ことの説明なので、警告色にしない */
const UNEVALUATED_TONE = {
  none: 'text-slate-500',
  some: 'text-slate-600',
  warn: 'text-amber-700',
} as const

function HazardRow({ h }: { h: RationaleHazard }) {
  const [open, setOpen] = useState(false)
  const id = `rationale-detail-${h.id}`
  return (
    <li className="border-slate-200 border-t first:border-t-0">
      <button
        type="button"
        className="flex min-h-11 w-full items-start gap-1.5 py-1.5 text-left"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        <span
          aria-hidden="true"
          className={`mt-0.5 shrink-0 text-[10px] ${GOOD.has(h.verdict) ? 'text-green-700' : 'text-slate-500'}`}
        >
          {open ? '▼' : '▶'}
        </span>
        <span className="flex-1">
          <span className={GOOD.has(h.verdict) ? 'text-green-800' : 'text-slate-800'}>
            {rationaleSummary(h)}
          </span>
          {!h.considered && (
            <span className="ml-1 text-[10.5px] text-slate-500">
              （経路の重みには入れていません）
            </span>
          )}
          <span className={`mt-0.5 block text-[10.5px] ${UNEVALUATED_TONE[h.unevaluated_stage]}`}>
            {h.unevaluated_note}
          </span>
          {/* ⚠️ **開けることを文字で示す。** 三角だけだと押せると気づかれない
              （実機確認で指摘された）。開閉の状態も同じ場所で伝える */}
          <span className="mt-1 inline-flex items-center gap-1 text-[10.5px] text-[#07156f] underline underline-offset-2">
            {open ? '詳細を閉じる' : 'タップして詳細を見る'}
          </span>
        </span>
      </button>
      {open && (
        <dl id={id} className="mb-1.5 ml-4 text-[11px] text-slate-600 leading-relaxed">
          {(
            [
              ['経路', h.detail.route],
              ['リスク', h.detail.risk],
              ['比較', h.detail.compare],
              ['条件', h.detail.condition],
            ] as const
          ).map(([term, value]) => (
            <div key={term} className="flex gap-1.5">
              <dt className="w-9 shrink-0 text-slate-500">{term}</dt>
              <dd className="flex-1">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  )
}

export function RouteRationale({ rationale }: { rationale: Rationale }) {
  if (!rationale.hazards.length) return null
  return (
    <section className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1">
      <h2 className="sr-only">この経路を選んだ根拠</h2>
      <ul className="text-[12px] leading-snug">
        {rationale.hazards.map((h) => (
          <HazardRow key={h.id} h={h} />
        ))}
      </ul>
    </section>
  )
}
