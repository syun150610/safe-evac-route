import { SearchIcon } from './MapToolIcons'

/** 地図左上の検索入口。ホームでは検索ボックス、その他ではアイコンだけを残す。 */
export function MapSearchControl({
  compact,
  label,
  onOpen,
}: {
  compact: boolean
  label: string
  onOpen: () => void
}) {
  if (compact) {
    return (
      <button
        type="button"
        className="absolute top-3 left-3 z-[5] grid size-12 cursor-pointer place-items-center rounded-full border border-slate-100 bg-white text-[#07156f] shadow-[0_5px_16px_rgb(15_23_42/18%)] hover:bg-slate-50"
        onClick={onOpen}
        aria-label="地点を検索"
        title="地点を検索"
      >
        <SearchIcon />
      </button>
    )
  }

  return (
    <button
      type="button"
      className="absolute top-3 right-16 left-3 z-[3] flex min-h-12 cursor-pointer items-center gap-2.5 rounded-[13px] border border-slate-100 bg-white px-4 text-left text-slate-500 shadow-[0_5px_16px_rgb(15_23_42/14%)] [&>span:last-child]:overflow-hidden [&>span:last-child]:text-ellipsis [&>span:last-child]:whitespace-nowrap"
      onClick={onOpen}
    >
      <SearchIcon className="shrink-0" />
      <span>{label}</span>
    </button>
  )
}
