import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import { LocateIcon } from './MapToolIcons'

const SUGGESTION_MAX_HEIGHT = 248
const SUGGESTION_MIN_BELOW = 160
const SUGGESTION_MIN_HEIGHT = 72
const SUGGESTION_GAP = 4
const MOBILE_QUERY = '(max-width: 700px)'

export interface SuggestionLayout {
  above: boolean
  maxHeight: number
}

/** ソフトウェアキーボードを含む「実際に見えている領域」から候補の出し方を決める。
 * 下側が狭いときだけ上へ出し、候補がキーボードの裏へ伸びない高さに抑える。 */
export function suggestionLayout(
  inputTop: number,
  inputBottom: number,
  viewportTop: number,
  viewportHeight: number,
): SuggestionLayout {
  const viewportBottom = viewportTop + viewportHeight
  const below = Math.max(0, viewportBottom - inputBottom - SUGGESTION_GAP)
  const above = Math.max(0, inputTop - viewportTop - SUGGESTION_GAP)
  const placeAbove = below < SUGGESTION_MIN_BELOW && above > below
  const available = placeAbove ? above : below
  return {
    above: placeAbove,
    maxHeight: Math.max(
      SUGGESTION_MIN_HEIGHT,
      Math.min(SUGGESTION_MAX_HEIGHT, Math.floor(available)),
    ),
  }
}

interface CurrentLocationOption {
  /** 位置情報の取得中 */
  loading: boolean
  /** 入力値が端末の現在地から得たものか。文字列だけでは判定しない */
  selected: boolean
  onSelect: () => void
}

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
  /** 出発地だけに付ける現在地操作。入力欄の近くで選べ、選択後は専用表示にする */
  currentLocation?: CurrentLocationOption
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
  currentLocation,
  suggestions,
}: Props) {
  const clearable = onClear !== undefined && query !== ''
  const listId = `${id}-suggestions`
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const open = active && suggestions !== undefined
  const currentSelected = currentLocation?.selected === true
  const [editing, setEditing] = useState(false)
  const mobileEditing =
    editing && (window.matchMedia?.(MOBILE_QUERY).matches ?? window.innerWidth <= 700)
  const [listLayout, setListLayout] = useState<SuggestionLayout>({
    above: false,
    maxHeight: SUGGESTION_MAX_HEIGHT,
  })

  useEffect(() => {
    if (!open) return

    const update = () => {
      const root = rootRef.current
      if (!root) return
      const rect = root.getBoundingClientRect()
      const viewport = window.visualViewport
      const viewportTop = viewport?.offsetTop ?? 0
      const viewportHeight = viewport?.height ?? window.innerHeight
      setListLayout(suggestionLayout(rect.top, rect.bottom, viewportTop, viewportHeight))
    }

    update()
    const viewport = window.visualViewport
    viewport?.addEventListener('resize', update)
    viewport?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    return () => {
      viewport?.removeEventListener('resize', update)
      viewport?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [open])

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

  function finishEditingAfterFocusMove(root: HTMLDivElement, next: EventTarget | null) {
    if (next instanceof Node && root.contains(next)) return
    window.setTimeout(() => {
      if (!root.contains(document.activeElement)) setEditing(false)
    }, 0)
  }

  return (
    <>
      <div
        ref={rootRef}
        data-editing={editing ? 'true' : 'false'}
        className="place-input relative mb-2"
        onBlurCapture={(event) =>
          finishEditingAfterFocusMove(event.currentTarget, event.relatedTarget)
        }
      >
        <div
          className={`grid min-h-12 items-center gap-1 rounded-[10px] border px-3 ${
            currentSelected
              ? 'grid-cols-[56px_minmax(0,1fr)_32px]'
              : currentLocation
                ? clearable
                  ? 'grid-cols-[56px_minmax(0,1fr)_auto_32px]'
                  : 'grid-cols-[56px_minmax(0,1fr)_auto]'
                : clearable
                  ? 'grid-cols-[56px_minmax(0,1fr)_32px]'
                  : 'grid-cols-[56px_minmax(0,1fr)]'
          } ${active && !currentSelected ? 'border-blue-600 shadow-[0_0_0_2px_rgb(37_99_235/10%)]' : 'border-slate-200'}`}
        >
          <label htmlFor={currentSelected ? undefined : id} className="text-[10px] text-slate-500">
            {label}
          </label>
          {currentSelected ? (
            <div
              className="my-1.5 flex min-h-9 min-w-0 items-center gap-2 rounded-lg bg-blue-50 px-2 text-[#07156f]"
              role="status"
              aria-label="端末の現在地を選択中"
            >
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-white">
                <LocateIcon className="size-4" />
              </span>
              <span className="min-w-0 leading-tight">
                <strong className="block truncate text-[11px]">現在地</strong>
                <small className="block truncate text-[8px] text-blue-700">
                  端末の位置情報を使用中
                </small>
              </span>
            </div>
          ) : (
            <input
              id={id}
              ref={inputRef}
              className="h-11 min-w-0 border-0 bg-transparent text-[16px] outline-0 min-[900px]:text-xs"
              value={query}
              placeholder={placeholder}
              autoComplete="off"
              role="combobox"
              aria-expanded={open}
              aria-controls={listId}
              aria-autocomplete="list"
              onFocus={() => {
                setEditing(true)
                onActivate()
              }}
              onKeyDown={onInputKeyDown}
              onChange={(event) => onQueryChange(event.target.value)}
            />
          )}
          {currentLocation && !currentSelected && (
            <button
              type="button"
              className="inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 text-[9px] font-bold whitespace-nowrap text-[#07156f] disabled:cursor-wait disabled:opacity-60"
              aria-label={currentLocation.loading ? '現在地を取得中' : '現在地を出発地にする'}
              aria-busy={currentLocation.loading}
              disabled={currentLocation.loading}
              onClick={currentLocation.onSelect}
            >
              {currentLocation.loading ? (
                <span
                  aria-hidden="true"
                  className="size-3 animate-spin rounded-full border-2 border-blue-200 border-t-[#07156f] motion-reduce:animate-none"
                />
              ) : (
                <LocateIcon className="size-4" />
              )}
              {currentLocation.loading ? '取得中' : '現在地を使う'}
            </button>
          )}
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
        </div>
        {open && (
          <div
            id={listId}
            ref={listRef}
            role="listbox"
            aria-label={`${label}の候補`}
            data-placement={listLayout.above ? 'above' : 'below'}
            onKeyDown={onListKeyDown}
            onClick={() => setEditing(false)}
            style={mobileEditing ? undefined : { maxHeight: listLayout.maxHeight }}
            className={`inset-x-0 z-20 overflow-auto rounded-xl border border-slate-200 bg-white shadow-[0_12px_32px_rgb(15_23_42/22%)] ${
              mobileEditing
                ? 'relative mt-1'
                : `absolute ${listLayout.above ? 'bottom-[calc(100%+4px)]' : 'top-[calc(100%+4px)]'}`
            }`}
          >
            {suggestions}
          </div>
        )}
      </div>
    </>
  )
}
