import { useEffect, useRef, useState } from 'react'
import type { MapTextSize } from '../lib/text-size'

interface Props {
  value: MapTextSize
  onChange: (value: MapTextSize) => void
}

const OPTIONS: { value: MapTextSize; label: string; sample: string }[] = [
  { value: 'small', label: '小', sample: '標準' },
  { value: 'medium', label: '中', sample: '読みやすく' },
  { value: 'large', label: '大', sample: 'より大きく' },
]

/** 地図画面だけの表示設定。投稿・マイページの文字サイズは変更しない。 */
export function TextSizeSettings({ value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function closeOnOutside(event: PointerEvent) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false)
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutside, true)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside, true)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="flex h-[30px] cursor-pointer items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 text-[11px] font-bold text-[#07156f]"
        aria-label="表示設定"
        aria-expanded={open}
        aria-controls="map-text-size-settings"
        onClick={() => setOpen((current) => !current)}
      >
        <span aria-hidden="true" className="font-serif text-sm">
          Aa
        </span>
        <span className="hidden min-[420px]:inline">表示</span>
      </button>
      {open && (
        <section
          id="map-text-size-settings"
          role="dialog"
          aria-label="表示設定"
          className="absolute top-[36px] right-0 z-30 w-[250px] rounded-xl border border-slate-200 bg-white p-3 text-left shadow-[0_10px_28px_rgb(15_23_42/20%)]"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <div>
              <strong className="block text-sm text-slate-800">表示設定</strong>
              <span className="text-[9px] text-slate-500">地図画面の文字サイズ</span>
            </div>
            <button
              type="button"
              className="grid size-8 cursor-pointer place-items-center rounded-full border-0 bg-slate-100 text-base text-slate-600"
              aria-label="表示設定を閉じる"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </div>
          <fieldset className="m-0 grid grid-cols-3 gap-1.5 border-0 p-0">
            <legend className="sr-only">文字サイズ</legend>
            {OPTIONS.map((option, index) => (
              <button
                type="button"
                key={option.value}
                aria-pressed={value === option.value}
                className={`grid min-h-[58px] cursor-pointer place-items-center gap-0.5 rounded-lg border px-1 py-2 ${value === option.value ? 'border-blue-700 bg-blue-50 text-[#07156f]' : 'border-slate-200 bg-white text-slate-600'}`}
                onClick={() => onChange(option.value)}
              >
                <strong style={{ fontSize: `${12 + index * 2}px` }}>{option.label}</strong>
                <small className="text-[8px]">{option.sample}</small>
              </button>
            ))}
          </fieldset>
          <p className="mt-2 mb-0 text-[9px] leading-relaxed text-slate-500">
            地図、検索、経路評価、避難先候補の文字へ反映します。
          </p>
        </section>
      )}
    </div>
  )
}
