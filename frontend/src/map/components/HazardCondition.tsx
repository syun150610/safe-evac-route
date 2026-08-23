/** 「どの災害で経路を引くか」の入力。**検索前も検索後も同じ部品を使う。**
 *
 * ⚠️ **変更は1つのコールバックで、次の条件をまとめて渡す。**
 * 種別と浸水想定を別々の `onChange` にすると、呼び出し側が
 * 「新しい種別 ＋ 古い想定」で再検索してしまう（Reactのstateは
 * 同じイベント内では更新前の値のままなので、押した直後に読めない）。
 * ここで完成した条件を渡せば、呼び出し側はそれをそのまま投げられる。
 *
 * ⚠️ **種別名をここに書かない。** 地震/浸水の出し分けは `HazardPicker`、
 * 浸水想定の一覧は `/api/hazards` が配る。この部品は並べるだけ。
 */
import type { HazardScenario } from '../types'
import { HazardPicker } from './HazardPicker'

export type HazardChoice = 'quake' | 'flood'

export interface Condition {
  hazard: HazardChoice
  scenario: string
}

interface Props extends Condition {
  /** 浸水想定の選択肢（`/api/hazards` の flood.scenarios） */
  scenarios: HazardScenario[]
  /** 次の条件。**種別と想定がそろった形で来る** */
  onChange: (next: Condition) => void
  title?: string
  /** 補足。検索後は「切り替えると引き直す」ことを伝える */
  note?: string
  /** 再検索中。二重に投げさせない */
  busy?: boolean
}

export function HazardCondition({
  hazard,
  scenario,
  scenarios,
  onChange,
  title = '考慮する災害',
  note,
  busy = false,
}: Props) {
  return (
    <section
      aria-busy={busy}
      className="mb-2.5 flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 [&>div]:mr-auto"
    >
      <div>
        <strong className="block text-[10px]">{title}</strong>
        {note && <small className="mt-0.5 block text-[8px] text-slate-500">{note}</small>}
      </div>
      <HazardPicker
        compact
        value={hazard}
        onChange={(next) => !busy && onChange({ hazard: next, scenario })}
      />
      {hazard === 'flood' && (
        <label className="ml-auto min-w-28 flex-1 text-[9px] text-slate-600 min-[420px]:max-w-36 [&_select]:min-h-7 [&_select]:w-full [&_select]:rounded-md [&_select]:border [&_select]:border-slate-200 [&_select]:bg-white [&_select]:px-1.5 [&_select]:text-[9px]">
          <span className="sr-only">浸水想定</span>
          <select
            aria-label="浸水想定"
            disabled={busy}
            value={scenario}
            onChange={(event) => onChange({ hazard, scenario: event.target.value })}
          >
            {scenarios.map((option) => (
              <option value={option.id} key={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      )}
    </section>
  )
}
