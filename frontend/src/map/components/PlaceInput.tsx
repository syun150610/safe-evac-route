import { type KeyboardEvent, type ReactNode, useRef } from 'react'

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
  /** 入力のすぐ下に出す候補。**中身は呼び出し側が描く**（対象エリアの判定や
   * 表記は画面側の都合なので、この部品には持たせない）。
   * ⚠️ 渡されたときだけ出す。`active` でない入力の下には出さない。 */
  suggestions?: ReactNode
}

/** 検索処理は親に集約し、既存の地点入力をモック準拠のcontrolled inputとして使う。
 *
 * ⚠️ **候補は入力の真下に重ねて出す。** 以前は入力・現在地ボタン・検索ボタンを
 * またいだ下に置いていて、「予測が遠い」「候補だと分からない」と言われた
 * （ユーザー指摘、2026-08-23）。
 *
 * ⚠️ **押し下げではなく重ねる**（`absolute`）。下のボタンが打鍵のたびに動くと、
 * 押そうとしていたものが逃げる。
 *
 * ⚠️ **キーボードで候補へ行けるようにする。** 候補は入力の直後に置いてあるので
 * Tab で入る。加えて ↓ で先頭の候補へ飛び、Esc で閉じて入力へ戻る。
 */
export function PlaceInput({
  id,
  label,
  query,
  placeholder,
  active,
  onActivate,
  onQueryChange,
  onClear,
  suggestions,
}: Props) {
  const clearable = onClear !== undefined && query !== ''
  const listId = `${id}-suggestions`
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const open = active && suggestions !== undefined

  const options = () =>
    Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!open) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      options()[0]?.focus()
    }
  }

  /** 候補の中の移動。⚠️ Esc は**入力へ戻す**（閉じるだけだと打ち直せない） */
  function onListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      inputRef.current?.focus()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const items = options()
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    if (index < 0) return
    event.preventDefault()
    const next = event.key === 'ArrowDown' ? index + 1 : index - 1
    if (next < 0) inputRef.current?.focus()
    else items[next]?.focus()
  }

  return (
    <div className="relative mb-2">
      <label
        htmlFor={id}
        className={`grid min-h-12 items-center rounded-[10px] border px-3 [&_span]:text-[10px] [&_span]:text-slate-500 [&_input]:h-11 [&_input]:min-w-0 [&_input]:border-0 [&_input]:bg-transparent [&_input]:text-xs [&_input]:outline-0 ${
          clearable ? 'grid-cols-[56px_1fr_32px]' : 'grid-cols-[56px_1fr]'
        } ${active ? 'border-blue-600 shadow-[0_0_0_2px_rgb(37_99_235/10%)]' : 'border-slate-200'}`}
      >
        <span>{label}</span>
        <input
          id={id}
          ref={inputRef}
          value={query}
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          onFocus={onActivate}
          onKeyDown={onInputKeyDown}
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
      {open && (
        <div
          id={listId}
          ref={listRef}
          role="listbox"
          aria-label={`${label}の候補`}
          onKeyDown={onListKeyDown}
          className="absolute inset-x-0 top-[calc(100%+4px)] z-20 max-h-[248px] overflow-auto rounded-xl border border-slate-200 bg-white shadow-[0_12px_32px_rgb(15_23_42/22%)]"
        >
          {suggestions}
        </div>
      )}
    </div>
  )
}
