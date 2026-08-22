export type MapLayerChoice = 'none' | 'quake' | 'flood'

interface Props {
  value: MapLayerChoice
  loading?: boolean
  error?: string | null
  onChange: (value: MapLayerChoice) => void
}

/** 地図へ重ねる災害情報を、モック準拠の設定項目で表示する。 */
export function LayerPicker({ value, loading, error, onChange }: Props) {
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
      {(loading || error) && (
        <p className="text-[9px] text-slate-500">{loading ? '地震データを読み込み中…' : error}</p>
      )}
    </>
  )
}
