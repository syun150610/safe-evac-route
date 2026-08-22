export type HazardChoice = 'quake' | 'flood'

interface Props {
  value: HazardChoice
  onChange: (value: HazardChoice) => void
}

/** 経路探索で考慮する災害を1つ選ぶ、モック準拠のセグメント入力。 */
export function HazardPicker({ value, onChange }: Props) {
  return (
    <fieldset className="m-0 grid min-w-28 grid-cols-2 rounded-lg border-0 bg-slate-100 p-0.5 [&_button]:min-h-8 [&_button]:cursor-pointer [&_button]:rounded-md [&_button]:border-0 [&_button]:bg-transparent [&_button]:px-2.5 [&_button]:text-[10px] [&_button[aria-pressed=true]]:bg-[#07156f] [&_button[aria-pressed=true]]:text-white">
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
