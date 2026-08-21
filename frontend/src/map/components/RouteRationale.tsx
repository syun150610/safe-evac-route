/** 「なぜこの経路なのか」の根拠。短文＋タップで詳細4行。
 *
 * ## UI改修時の引き継ぎ
 *
 * **この部品は props が `rationale` 1つだけの自己完結型。** 画面定義書に沿って
 * レイアウトを作り直すときは、置き場所を変えるだけでそのまま動く。
 * 分解して EvacRouteMap 側へ散らさないこと。
 *
 * ⚠️ **文言をここで組み立てない。** 短文も詳細4行もAPIが完成した文字列で返す
 * （`backend/app/services/evac_routes/rationale.py` が単一の出所）。
 * ここにテンプレートを置くと、UI改修と文言仕様が二重管理になる。
 * 数値を強調したくなったら `h.before_m` などを使う（文言は組み直さない）。
 *
 * ⚠️ **災害種別をここに書かない。** 「浸水30cm超」「危険度4以上」は
 * `backend/prep/hazard_sources/registry.py` の `risk` ブロック由来。
 * **種別が増えてもこのファイルは無変更。**
 *
 * ⚠️ **未評価区間を落とさない。** カバー外は「安全」ではなく「判断材料が無い」。
 * 割合が大きいときは短文の下に警告を出す（`detail.risk` にも必ず入っている）。
 */
import { useState } from 'react'

import type { Rationale, RationaleHazard } from '../types'

/** 回避できたことが伝わる状態か。色分けにだけ使う */
const GOOD = new Set(['avoided', 'already_safe'])

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
            {h.text}
          </span>
          {!h.considered && (
            <span className="ml-1 text-[10.5px] text-slate-500">
              （経路の重みには入れていません）
            </span>
          )}
          {h.unevaluated_note && (
            <span className="mt-0.5 block text-[10.5px] text-amber-700">{h.unevaluated_note}</span>
          )}
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
