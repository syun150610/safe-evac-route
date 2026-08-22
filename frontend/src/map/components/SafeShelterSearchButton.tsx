interface Props {
  loading: boolean
  disabled?: boolean
  onSearch: () => void | Promise<void>
}

export function SafeShelterSearchButton({ loading, disabled = false, onSearch }: Props) {
  return (
    <button
      type="button"
      className="group mb-3 flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-xl border border-[#07156f] bg-[#07156f] px-3.5 py-2.5 text-left text-white transition-colors hover:bg-[#10248f] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:border-slate-400 disabled:bg-slate-400"
      onClick={() => void onSearch()}
      disabled={loading || disabled}
      aria-busy={loading}
    >
      <span
        className="grid size-8 shrink-0 place-items-center rounded-full bg-white/15 text-base text-white"
        aria-hidden="true"
      >
        ◇
      </span>
      <span className="grid flex-1 gap-0.5">
        <strong className="text-xs tracking-[0.02em]">
          {loading ? '安全な避難先を検索中…' : '安全な避難先を探す'}
        </strong>
        <small className="text-[9px] leading-normal text-blue-100">
          出発地と災害リスクから候補を比較します
        </small>
      </span>
      <span
        className="grid size-7 shrink-0 place-items-center rounded-full bg-white text-sm font-bold text-[#07156f] transition-transform group-hover:translate-x-0.5"
        aria-hidden="true"
      >
        →
      </span>
    </button>
  )
}
