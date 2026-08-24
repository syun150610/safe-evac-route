/** 地図の右下に並ぶ道具のアイコン。
 *
 * ⚠️ **記号1文字で表さない。** 以前は現在地が「◎」、レイヤーが「▱」だった。
 * 何の機能なのか読み取れず、押してみるまで分からない（ユーザー指摘、2026-08-23）。
 *
 * ⚠️ **アイコンだけでも足りない。** 呼び出し側で `aria-label` と `title` を必ず付ける
 * （読み上げと、PCでのホバー説明）。
 *
 * ⚠️ 色は指定しない。`currentColor` でボタン側の色に従う。
 */
interface IconProps {
  className?: string
}

const BASE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

/** 地点検索。虫眼鏡 */
export function SearchIcon({ className }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" width="20" height="20">
      <circle cx="10.5" cy="10.5" r="6.5" {...BASE} />
      <path d="m15.4 15.4 5.1 5.1" {...BASE} />
    </svg>
  )
}

/** 現在地。十字と中心の点（GPSの照準） */
export function LocateIcon({ className }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" width="20" height="20">
      <circle cx="12" cy="12" r="6.5" {...BASE} />
      <circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none" />
      <path d="M12 1.8v3.2M12 19v3.2M1.8 12h3.2M19 12h3.2" {...BASE} />
    </svg>
  )
}

/** 地図に重ねる情報。重なった紙 */
export function LayersIcon({ className }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" width="20" height="20">
      <path d="M12 3 2.8 7.6 12 12.2l9.2-4.6L12 3Z" {...BASE} />
      <path d="m3.4 12.4 8.6 4.3 8.6-4.3" {...BASE} />
      <path d="m3.4 16.9 8.6 4.3 8.6-4.3" {...BASE} />
    </svg>
  )
}

/** 凡例。色の見本と説明の行 */
export function LegendIcon({ className }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" width="20" height="20">
      <rect x="2.6" y="4.6" width="4.4" height="3.4" rx="1" {...BASE} />
      <rect x="2.6" y="10.3" width="4.4" height="3.4" rx="1" {...BASE} />
      <rect x="2.6" y="16" width="4.4" height="3.4" rx="1" {...BASE} />
      <path d="M10.4 6.3h11M10.4 12h11M10.4 17.7h7.6" {...BASE} />
    </svg>
  )
}
