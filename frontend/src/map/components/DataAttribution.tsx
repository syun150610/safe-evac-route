import { useId, useState } from 'react'

import type { Platform } from '../hooks/useMapAdapter'

const LINK_CLASS =
  'text-black underline decoration-slate-500 underline-offset-2 hover:text-slate-950'

interface Props {
  mobile: boolean
  platform: Platform
}

export function DataAttribution({ mobile, platform }: Props) {
  const [open, setOpen] = useState(false)
  const detailsId = useId()
  const position = mobile
    ? 'fixed bottom-[calc(var(--sheet-peek,74px)+32px)] left-2 z-[13] max-w-[calc(100%-76px)]'
    : 'fixed bottom-7 left-[calc(clamp(360px,34vw,480px)+8px)] z-[3] max-w-[min(560px,calc(66vw-16px))]'

  return (
    <aside
      className={`${position} text-[10px] leading-[1.35] text-slate-600`}
      aria-label="使用データの出典"
    >
      {open && (
        <div
          id={detailsId}
          className="absolute bottom-[calc(100%+6px)] left-0 w-[min(340px,calc(100vw-16px))] rounded-lg bg-slate-100/70 p-3 shadow-[0_4px_16px_rgb(15_23_42/18%)] backdrop-blur-sm"
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <strong className="text-[11px] text-slate-800">使用データ</strong>
            <button
              type="button"
              className="grid size-7 cursor-pointer place-items-center rounded-full border-0 bg-slate-100 text-sm text-slate-600"
              onClick={() => setOpen(false)}
              aria-label="データ出典を閉じる"
            >
              ×
            </button>
          </div>
          {platform === 'google' && (
            <b className="mb-2 block rounded bg-slate-100 px-2 py-1.5 font-medium text-slate-700">
              以下は Google 提供のデータではありません
            </b>
          )}
          <ul className="m-0 grid list-none gap-1.5 p-0">
            <li>
              <a
                className={LINK_CLASS}
                href="https://catalog.data.metro.tokyo.lg.jp/dataset/t000014d0000000029"
                target="_blank"
                rel="noreferrer"
              >
                東京都「浸水予想区域図」
              </a>
            </li>
            <li>
              <a
                className={LINK_CLASS}
                href="https://www.funenka.metro.tokyo.lg.jp/area-hazard-level/regional-risk-level/"
                target="_blank"
                rel="noreferrer"
              >
                東京都「地震に関する地域危険度測定調査（第9回）」
              </a>
            </li>
            <li>
              経路データ：
              <a
                className={LINK_CLASS}
                href="https://www.openstreetmap.org/copyright"
                target="_blank"
                rel="noreferrer"
              >
                © OpenStreetMap contributors
              </a>
              を自前探索
            </li>
          </ul>
        </div>
      )}
      <div className="flex min-h-8 flex-wrap items-center gap-x-1 rounded bg-slate-200/60 px-2 py-1 shadow-sm text-black">
        <span>経路:</span>
        <a
          className={LINK_CLASS}
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
        >
          © OpenStreetMap contributors
        </a>
        <span aria-hidden="true">｜</span>
        <button
          type="button"
          className="min-h-6 cursor-pointer border-0 bg-transparent p-0 text-[10px] font-bold text-black underline decoration-slate-500 underline-offset-2 hover:text-slate-950"
          aria-expanded={open}
          aria-controls={detailsId}
          onClick={() => setOpen((value) => !value)}
        >
          データ出典
        </button>
      </div>
    </aside>
  )
}
