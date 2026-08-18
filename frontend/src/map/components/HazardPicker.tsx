/** ② ルート検索時にどの災害を考慮するか。
 *
 * 選んだ種別の係数を掛け合わせて経路を引く（`length × Π cost_h`）。
 * 種別と説明文は **API のカタログから**取る（フロントにハードコードしない。
 * docs/dev/05_チーム移行案.md §5-2）。
 *
 * ⚠️ **③（表示の切替）とは別物。** ②は経路の引き方、③は地図に何を重ねるか。
 * 「地震を表示していないから経路も地震を見ていない」わけではない。
 */
import type { HazardCatalog } from '../types'

/** 種別ID -> variant。flood は浸水シナリオID、quake はいまのところ "total" のみ */
export type HazardSelection = Record<string, string>

/** 経路探索で選べる variant。焼いてある係数がこれしかない（cost_quake は総合ランク） */
const FIXED_VARIANT: Record<string, string> = { quake: 'total' }

interface Props {
  catalog: HazardCatalog | null
  value: HazardSelection
  onChange: (v: HazardSelection) => void
  /** 浸水を選んだときのシナリオ。flood の variant になる */
  scenario: string
  disabled?: boolean
}

export function HazardPicker({ catalog, value, onChange, scenario, disabled }: Props) {
  function toggle(id: string, on: boolean) {
    const next = { ...value }
    if (on) next[id] = id === 'flood' ? scenario : (FIXED_VARIANT[id] ?? 'total')
    else delete next[id]
    onChange(next)
  }

  const n = Object.keys(value).length
  return (
    <fieldset
      className="mb-2 rounded-md border border-slate-200 px-2.5 pt-1.5 pb-2 disabled:opacity-50"
      disabled={disabled}
    >
      <legend className="px-1 text-[11px] text-slate-600">経路で考慮する災害</legend>
      {(catalog?.hazards ?? []).map((h) => (
        <label
          key={h.id}
          className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 text-[12.5px] max-[700px]:min-h-11"
          title={h.note}
        >
          <input
            type="checkbox"
            className="size-4"
            checked={h.id in value}
            onChange={(e) => toggle(h.id, e.target.checked)}
          />
          {h.label}
        </label>
      ))}
      <p className="mt-1 text-[11px] text-slate-600">
        {n === 0
          ? '何も選ばないと距離だけの単純最短になります。'
          : '選んだ災害の係数を掛け合わせて経路を引きます。単純最短も一緒に出します。'}
      </p>
    </fieldset>
  )
}
