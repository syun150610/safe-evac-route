import { type ReactNode, useState } from 'react'

/** 検索の条件をひとまとめにして畳む。
 *
 * ⚠️ **畳んだときも、いまの条件を言葉で出す。** ボタンを押した瞬間に既定の条件で
 * 走るので、何で探すのか読めないと気づけない（#48 で踏んだ問題）。
 *
 * ⚠️ **検索の画面では畳まない。** これから条件を決める場面なので、隠すと
 * 選べることが分からない（`defaultOpen`）。
 *
 * ⚠️ 中身（災害の選択・避難先の種類）はここで組み立てない。呼び出し側が渡す。
 */
interface Props {
  /** 見出し（"検索の条件"） */
  title: string
  /** 畳んでいるときに出す、いまの条件。**必ず言葉で** */
  summary: string
  /** API由来の条件名を取得中 */
  loading?: boolean
  defaultOpen?: boolean
  children: ReactNode
}

export function SearchOptions({
  title,
  summary,
  loading = false,
  defaultOpen = false,
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section aria-busy={loading} className="mb-2 rounded-[10px] border border-slate-200 bg-white">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-11 w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-3 text-left"
      >
        <span className="shrink-0 text-[10px] text-slate-500">{title}</span>
        <strong className="flex min-w-0 flex-1 items-center gap-1.5 text-[11px] text-slate-800">
          {loading && (
            <span
              aria-hidden="true"
              className="size-3 shrink-0 animate-spin rounded-full border-2 border-slate-300 border-t-[#07156f] motion-reduce:animate-[spin_2s_linear_infinite]"
            />
          )}
          <span className="truncate">{summary}</span>
        </strong>
        <span className="shrink-0 text-[10px] text-[#07156f]">{open ? '閉じる' : '変更'}</span>
      </button>
      {open && <div className="border-slate-100 border-t px-3 pt-2 pb-1">{children}</div>}
    </section>
  )
}
