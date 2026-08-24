import { suggestionAreaStatus } from '../hooks/useArea'
import type { PlaceSuggestion } from '../lib/place-search'
import type { Area } from '../types'

export function PlaceSuggestionItem({
  area,
  suggestion,
  onChoose,
}: {
  area: Area | null
  suggestion: PlaceSuggestion
  onChoose: (suggestion: PlaceSuggestion) => void
}) {
  const known = suggestion.place
  const outside = suggestionAreaStatus(area, suggestion) === false
  return (
    <button
      type="button"
      role="option"
      aria-selected="false"
      onClick={() => onChoose(suggestion)}
      disabled={outside}
      className={`grid w-full grid-cols-[26px_1fr_auto] items-center gap-1 border-0 border-slate-100 border-t px-3 py-2.5 text-left ${
        outside
          ? 'cursor-not-allowed bg-red-50 text-red-700'
          : 'cursor-pointer bg-transparent hover:bg-slate-50 focus-visible:bg-indigo-50'
      }`}
    >
      <span className={`text-base ${outside ? 'text-red-600' : 'text-[#07156f]'}`}>⌖</span>
      <span className="min-w-0">
        <strong className="block truncate text-xs">{suggestion.title}</strong>
        <small
          className={`mt-0.5 block truncate text-[9px] ${outside ? 'text-red-600' : 'text-slate-500'}`}
        >
          {suggestion.address ?? (known ? `${known.lat.toFixed(5)}, ${known.lon.toFixed(5)}` : '')}
        </small>
        {outside && (
          <small className="mt-0.5 block text-[9px] font-medium text-red-700">
            {area?.label ?? '現在の対応地域'}以外は未対応です
          </small>
        )}
      </span>
      <em
        className={`text-[8px] font-bold not-italic ${outside ? 'text-red-700' : 'text-[#07156f]'}`}
      >
        {outside ? '検索対象外' : '選択'}
      </em>
    </button>
  )
}
