export type MapLayerChoice = 'none' | 'quake' | 'flood'

interface Props {
  value: MapLayerChoice
  loading?: boolean
  error?: string | null
  onChange: (value: MapLayerChoice) => void
  /** 経路の要約（吹き出し）を地図に出すか */
  callouts: boolean
  onCalloutsChange: (shown: boolean) => void
  /** いま重ねている災害の濃さ（0〜1）。⚠️ **種別ごとに覚える** */
  opacity: number
  onOpacityChange: (value: number) => void
}

/** 地図へ重ねる災害情報を、モック準拠の設定項目で表示する。 */
export function LayerPicker({
  value,
  loading,
  error,
  onChange,
  callouts,
  onCalloutsChange,
  opacity,
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
      {/* ⚠️ **濃さは種別ごとに覚える。** 地震の面と浸水のラスタでは、ちょうどよい
          濃さが違う。値の意味（見え方の強さ0〜1）は揃えてあり、換算はアダプタが持つ。
          ⚠️ 何も重ねていないときは出さない（動かしても何も起きない） */}
      {value !== 'none' && (
        <div className="mt-2 border-slate-100 border-t pt-2">
          <label className="flex min-h-11 items-center gap-2.5 text-xs" htmlFor="layer-opacity">
            <span className="shrink-0">濃さ</span>
            <input
              className="min-w-0 flex-1"
              id="layer-opacity"
              max="1"
              min="0.1"
              step="0.05"
              type="range"
              value={opacity}
              onChange={(event) => onOpacityChange(Number(event.target.value))}
            />
            <span className="w-9 shrink-0 text-right text-[10px] text-slate-500 tabular-nums">
              {Math.round(opacity * 100)}%
            </span>
          </label>
        </div>
      )}
      {(loading || error) && (
        <p className="text-[9px] text-slate-500">{loading ? '地震データを読み込み中…' : error}</p>
      )}
      {/* ⚠️ **消せるようにしておく。** 吹き出しは避難先のピンの近くに出るので、
          ピンや経路と重なる場所がどうしても出る（ユーザー指摘、2026-08-23）。
          ハザードの重ね合わせ（上の3択）とは別のものなので、区切って置く */}
      <div className="mt-2 border-slate-100 border-t pt-2">
        <label className="flex min-h-11 items-center gap-2.5 text-xs">
          <input
            type="checkbox"
            checked={callouts}
            onChange={(event) => onCalloutsChange(event.target.checked)}
          />
          経路の要約を地図に出す
        </label>
        <p className="text-[9px] text-slate-500">
          避難先の上に距離・徒歩時間・危険区間の吹き出しを出します。
        </p>
      </div>
    </>
  )
}
