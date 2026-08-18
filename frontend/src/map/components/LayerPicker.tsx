/** ③ 地図に表示する災害種別の切替。
 *
 * ⚠️ **同時に出すのは1つ**（`display_policy: "one_at_a_time"`）。
 * 浸水深(m)と地域危険度ランクは単位が違うので、重ねると読めない
 * （docs/dev/05_チーム移行案.md §3-4）。だからラジオにしてある。
 *
 * ⚠️ **②（経路で考慮する災害）とは別物。** ここは見た目だけを変える。
 * 「地震を表示していないから経路も地震を見ていない」わけではない。
 */
import type { HazardCatalog } from '../types'

/** 表示中の種別。null = 何も重ねない */
export type ShownHazard = { id: string; scenario: string } | null

interface Props {
  catalog: HazardCatalog | null
  value: ShownHazard
  onChange: (v: ShownHazard) => void
  opacity: number
  onOpacity: (v: number) => void
  /** シナリオを外から固定する種別。
   *
   * 浸水がこれ。**表示と経路の想定図がズレると読み違える**（神田川のタイルを見ながら
   * 包絡で引いた経路を見る、など）ので、浸水シナリオの選択はパネル上部に1つだけ置き、
   * ここでは選ばせない。 */
  fixed?: Record<string, string>
}

export function LayerPicker({ catalog, value, onChange, opacity, onOpacity, fixed = {} }: Props) {
  const hazards = catalog?.hazards ?? []
  const current = hazards.find((h) => h.id === value?.id) ?? null
  const scenario = current?.scenarios.find((s) => s.id === value?.scenario) ?? null
  const legend = current?.legend ?? scenario?.legend ?? null

  function select(id: string | null) {
    if (id === null) {
      onChange(null)
      return
    }
    const h = hazards.find((x) => x.id === id)
    // 既定シナリオは先頭。浸水は「包絡」、地震は「総合危険度」が先頭に来る
    onChange({ id, scenario: fixed[id] ?? h?.scenarios[0]?.id ?? '' })
  }

  return (
    <fieldset className="mb-2 rounded-md border border-slate-200 px-2.5 pt-1.5 pb-2 disabled:opacity-50">
      <legend className="px-1 text-[11px] text-slate-600">地図に表示する災害</legend>
      <div className="flex flex-wrap gap-x-3.5 gap-y-0.5">
        <label className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 text-[12.5px]">
          <input
            type="radio"
            name="layer"
            className="size-4"
            checked={value === null}
            onChange={() => select(null)}
          />
          表示しない
        </label>
        {hazards.map((h) => (
          <label
            key={h.id}
            className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 text-[12.5px]"
            title={h.note}
          >
            <input
              type="radio"
              name="layer"
              className="size-4"
              checked={value?.id === h.id}
              onChange={() => select(h.id)}
            />
            {h.label}
          </label>
        ))}
      </div>

      {current && !(current.id in fixed) && current.scenarios.length > 1 && (
        <select
          className="min-h-11 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-[12.5px] mt-1"
          value={value?.scenario ?? ''}
          aria-label={`${current.label}の種類`}
          onChange={(e) => onChange({ id: current.id, scenario: e.target.value })}
        >
          {current.scenarios.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      )}

      {current && (
        <label className="mt-1.5 flex items-center gap-2 text-[11px] text-slate-600">
          濃さ
          <input
            type="range"
            className="flex-1"
            min={0}
            max={100}
            value={Math.round(opacity * 100)}
            onChange={(e) => onOpacity(Number(e.target.value) / 100)}
          />
        </label>
      )}

      {/* 凡例。**「範囲外＝安全」ではない**という注意もAPIが配る文言をそのまま出す。
          浸水は種別ごと、地震はシナリオごと（ランクの色）に持っている */}
      {legend && (
        <ul className="mt-1.5 flex list-none flex-wrap gap-x-2.5 gap-y-0.5 p-0">
          {legend.map((L) => (
            <li
              key={L.label}
              className="flex items-center gap-1.5 text-[10.5px] text-slate-700"
              title={L.note?.replace(/\*\*/g, '')}
            >
              <span
                className={`inline-block size-3.5 rounded-sm border border-slate-300 ${L.hatch ? 'legend-hatch' : ''}`}
                style={L.color ? { background: L.color } : undefined}
              />
              {L.label}
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  )
}
