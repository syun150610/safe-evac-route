import type { HazardScenario } from '../types'

export type MapLayerChoice = 'none' | 'quake' | 'flood'

interface Props {
  value: MapLayerChoice
  scenario: string
  scenarios: HazardScenario[]
  opacity: number
  loading?: boolean
  error?: string | null
  onChange: (value: MapLayerChoice) => void
  onScenarioChange: (scenario: string) => void
  onOpacityChange: (opacity: number) => void
}

/** 地図へ重ねる災害情報を、モック準拠の設定項目で表示する。 */
export function LayerPicker({
  value,
  scenario,
  scenarios,
  opacity,
  loading,
  error,
  onChange,
  onScenarioChange,
  onOpacityChange,
}: Props) {
  return (
    <>
      <div className="grid gap-1 [&_label]:flex [&_label]:min-h-11 [&_label]:items-center [&_label]:gap-2.5 [&_label]:border-b [&_label]:border-slate-100 [&_label]:text-xs">
        {(['none', 'quake', 'flood'] as const).map((choice) => (
          <label key={choice}>
            <input
              type="radio"
              name="layer"
              checked={value === choice}
              onChange={() => onChange(choice)}
            />
            {choice === 'none' ? '表示しない' : choice === 'quake' ? '地震危険度' : '浸水想定区域'}
          </label>
        ))}
      </div>
      {value === 'flood' && (
        <label className="mt-4 grid gap-1.5 text-[10px] text-slate-600 [&_select]:min-h-11 [&_select]:rounded-lg [&_select]:border [&_select]:border-slate-200 [&_select]:bg-white [&_select]:px-2.5">
          浸水想定
          <select value={scenario} onChange={(event) => onScenarioChange(event.target.value)}>
            {scenarios.map((item) => (
              <option value={item.id} key={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {value !== 'none' && (
        <label className="my-4 grid grid-cols-[75px_1fr] items-center text-[10px]">
          表示の濃さ
          <input
            type="range"
            min="20"
            max="90"
            value={Math.round(opacity * 100)}
            onChange={(event) => onOpacityChange(Number(event.target.value) / 100)}
          />
        </label>
      )}
      {(loading || error) && (
        <p className="text-[9px] text-slate-500">{loading ? '地震データを読み込み中…' : error}</p>
      )}
    </>
  )
}
