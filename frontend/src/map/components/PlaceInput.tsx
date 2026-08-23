interface Props {
  id: string
  label: string
  query: string
  placeholder: string
  active: boolean
  onActivate: () => void
  onQueryChange: (query: string) => void
  /** 入力を消す。⚠️ **これが無いと、一度決めた地点を選び直せない。**
   * 文字を全部消すしか手が無く、実際に「ページを再読み込みするしかない」
   * という指摘が出た（2026-08-23） */
  onClear?: () => void
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
  onClear,
}: Props) {
  const clearable = onClear !== undefined && query !== ''
  return (
    <label
      htmlFor={id}
      className={`mb-2 grid min-h-12 items-center rounded-[10px] border px-3 [&_span]:text-[10px] [&_span]:text-slate-500 [&_input]:h-11 [&_input]:min-w-0 [&_input]:border-0 [&_input]:bg-transparent [&_input]:text-xs [&_input]:outline-0 ${
        clearable ? 'grid-cols-[56px_1fr_32px]' : 'grid-cols-[56px_1fr]'
      } ${active ? 'border-blue-600 shadow-[0_0_0_2px_rgb(37_99_235/10%)]' : 'border-slate-200'}`}
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
      {clearable && (
        <button
          type="button"
          aria-label={`${label}を消す`}
          className="grid size-7 cursor-pointer place-items-center justify-self-end rounded-full border-0 bg-slate-100 text-[11px] text-slate-500"
          onClick={onClear}
        >
          ×
        </button>
      )}
    </label>
  )
}
