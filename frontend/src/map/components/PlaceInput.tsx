interface Props {
  id: string
  label: string
  query: string
  placeholder: string
  active: boolean
  onActivate: () => void
  onQueryChange: (query: string) => void
}

/** 検索処理は親に集約し、既存の地点入力をモック準拠のcontrolled inputとして使う。 */
export function PlaceInput({
  id,
  label,
  query,
  placeholder,
  active,
  onActivate,
  onQueryChange,
}: Props) {
  return (
    <label
      htmlFor={id}
      className={`mb-2 grid min-h-12 grid-cols-[56px_1fr] items-center rounded-[10px] border px-3 [&_span]:text-[10px] [&_span]:text-slate-500 [&_input]:h-11 [&_input]:min-w-0 [&_input]:border-0 [&_input]:bg-transparent [&_input]:text-xs [&_input]:outline-0 ${active ? 'border-blue-600 shadow-[0_0_0_2px_rgb(37_99_235/10%)]' : 'border-slate-200'}`}
    >
      <span>{label}</span>
      <input
        id={id}
        value={query}
        placeholder={placeholder}
        autoComplete="off"
        onFocus={onActivate}
        onChange={(event) => onQueryChange(event.target.value)}
      />
    </label>
  )
}
