import type { Platform } from '../hooks/useMapAdapter'

const LINK_CLASS = 'text-blue-700 underline underline-offset-2'

interface Props {
  mobile: boolean
  platform: Platform
}

export function DataAttribution({ mobile, platform }: Props) {
  const className = mobile
    ? 'border-t border-slate-200 px-3.5 pt-2.5 pb-1 text-[10.5px] leading-relaxed text-slate-700'
    : platform === 'google'
      ? 'fixed right-2 bottom-7 z-[1] max-w-[340px] rounded-md border border-slate-300 bg-white/95 px-2.5 py-1.5 text-[10.5px] leading-relaxed text-slate-700 shadow-sm'
      : 'fixed right-0 bottom-0 left-0 z-[1] bg-white/90 px-2 py-1 pr-[330px] text-[11px] leading-normal text-slate-700'

  return (
    <aside className={className} aria-label="使用データの出典">
      {platform === 'google' && (
        <b className="block text-slate-600">以下は Google 提供のデータではありません</b>
      )}
      <span>使用オープンデータ：</span>
      <a
        className={LINK_CLASS}
        href="https://catalog.data.metro.tokyo.lg.jp/dataset/t000014d0000000029"
        target="_blank"
        rel="noreferrer"
      >
        東京都「浸水予想区域図」
      </a>
      <span> ／ </span>
      <a
        className={LINK_CLASS}
        href="https://www.funenka.metro.tokyo.lg.jp/area-hazard-level/regional-risk-level/"
        target="_blank"
        rel="noreferrer"
      >
        東京都「地震に関する地域危険度測定調査（第9回）」
      </a>
      <span> ／ 経路：</span>
      <a
        className={LINK_CLASS}
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noreferrer"
      >
        © OpenStreetMap contributors
      </a>
      <span>を自前探索</span>
    </aside>
  )
}
