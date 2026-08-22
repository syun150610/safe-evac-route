export type HazardChoice = 'quake' | 'flood'

interface Props {
  value: HazardChoice
  onChange: (value: HazardChoice) => void
  compact?: boolean
}

/** 経路探索で考慮する災害を1つ選ぶ、モック準拠のセグメント入力。 */
export function HazardPicker({ value, onChange, compact = false }: Props) {
  return (
    <fieldset
      className={`m-0 grid grid-cols-2 border-0 bg-slate-100 p-0.5 [&_button]:cursor-pointer [&_button]:border-0 [&_button]:bg-transparent [&_button[aria-pressed=true]]:bg-[#07156f] [&_button[aria-pressed=true]]:text-white ${
        compact
          ? 'min-w-24 rounded-md [&_button]:min-h-7 [&_button]:rounded-[5px] [&_button]:px-2 [&_button]:text-[9px]'
          : 'min-w-28 rounded-lg [&_button]:min-h-8 [&_button]:rounded-md [&_button]:px-2.5 [&_button]:text-[10px]'
      }`}
    >
      <legend className="sr-only">経路で考慮する災害</legend>
      <button type="button" aria-pressed={value === 'quake'} onClick={() => onChange('quake')}>
        地震
      </button>
      <button type="button" aria-pressed={value === 'flood'} onClick={() => onChange('flood')}>
        浸水
      </button>
    </fieldset>
  )
}
