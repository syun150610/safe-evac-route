import type { ReactNode, RefObject } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MapAdapter } from '../adapters/types'
import type { Bundle } from '../types'
import { decideSheet, sheetSummary } from './bottomSheetLogic'

const MOBILE_QUERY = '(max-width: 700px)'
const DRAG_SLOP = 6
export const DESKTOP_SIDEBAR_MIN = 320
export const DESKTOP_SIDEBAR_MAX = 640
const DESKTOP_MAP_MIN = 360

export function clampDesktopSidebarWidth(width: number, viewportWidth: number): number {
  const maximum = Math.max(
    DESKTOP_SIDEBAR_MIN,
    Math.min(DESKTOP_SIDEBAR_MAX, viewportWidth - DESKTOP_MAP_MIN),
  )
  return Math.round(Math.max(DESKTOP_SIDEBAR_MIN, Math.min(width, maximum)))
}

interface Props {
  adapter: RefObject<MapAdapter | null>
  bundle: Bundle | null
  mobile: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  /** PCでは従来の地図上オーバーレイか、新UIの左サイドバーとして表示する */
  desktopMode?: 'overlay' | 'sidebar'
  /** PCサイドバーの幅と折り畳み操作。mobileでは使わない */
  desktopWidth?: number
  desktopCollapsed?: boolean
  onDesktopResize?: (width: number) => void
  onDesktopCollapsedChange?: (collapsed: boolean) => void
  /** 経路結果がないときに、折りたたみ部分へ表示する文言 */
  collapsedLabel?: ReactNode
  /** 折りたたみ部分の見出し（「地震を考慮」など）。
   * ⚠️ **ここで組み立てない。** 災害の呼び名は `/api/hazards` が配るので、
   * 持っている側（`EvacRouteMap`）が完成した文字列で渡す */
  conditionLabel?: string
  children?: ReactNode
}

interface DragState {
  pointerId: number | null
  active: boolean
  swiped: boolean
  x0: number
  y0: number
  base: number
  samples: { time: number; y: number }[]
}

export function useMobileLayout(): boolean {
  const [mobile, setMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches)

  useEffect(() => {
    const query = window.matchMedia(MOBILE_QUERY)
    const update = () => setMobile(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  return mobile
}

export function BottomSheet({
  adapter,
  bundle,
  mobile,
  open,
  onOpenChange,
  desktopMode = 'overlay',
  desktopWidth = 420,
  desktopCollapsed = false,
  onDesktopResize,
  onDesktopCollapsedChange,
  collapsedLabel = '避難経路の設定',
  conditionLabel,
  children,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const travelRef = useRef(0)
  const shiftRef = useRef(0)
  const [dragging, setDragging] = useState(false)
  const desktopResizePointer = useRef<number | null>(null)
  const drag = useRef<DragState>({
    pointerId: null,
    active: false,
    swiped: false,
    x0: 0,
    y0: 0,
    base: 0,
    samples: [],
  })
  const summary = sheetSummary(bundle)

  function applyShift(value: number) {
    shiftRef.current = value
    if (rootRef.current) rootRef.current.style.transform = `translateY(${value}px)`
  }

  function measure() {
    const root = rootRef.current
    const body = bodyRef.current
    if (!root || !body) return
    const travel = mobile ? body.offsetHeight : 0
    travelRef.current = travel
    const peek = mobile ? Math.max(0, root.offsetHeight - travel) : 0
    adapter.current?.reserveBottom(peek)
    if (!drag.current.active) applyShift(open ? 0 : travel)
  }

  useLayoutEffect(() => {
    measure()
    const body = bodyRef.current
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    if (body) observer?.observe(body)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  })

  useEffect(() => {
    if (mobile) return
    adapter.current?.reserveBottom(0)
    adapter.current?.lockGestures(false)
    drag.current.active = false
    setDragging(false)
    shiftRef.current = 0
    if (rootRef.current) rootRef.current.style.transform = 'translateY(0px)'
  }, [adapter, mobile])

  useEffect(
    () => () => {
      adapter.current?.reserveBottom(0)
      adapter.current?.lockGestures(false)
    },
    [adapter],
  )

  function beginDrag(event: React.PointerEvent<HTMLButtonElement>) {
    if (!mobile || !event.isPrimary) return
    drag.current = {
      pointerId: event.pointerId,
      active: false,
      swiped: false,
      x0: event.clientX,
      y0: event.clientY,
      base: shiftRef.current,
      samples: [{ time: event.timeStamp, y: event.clientY }],
    }
    measure()
  }

  function moveDrag(event: React.PointerEvent<HTMLButtonElement>) {
    const state = drag.current
    if (event.pointerId !== state.pointerId) return
    if (!state.active) {
      const dx = event.clientX - state.x0
      const dy = event.clientY - state.y0
      if (Math.abs(dy) < DRAG_SLOP || Math.abs(dy) < Math.abs(dx)) return
      state.active = true
      state.base = shiftRef.current
      state.y0 = event.clientY
      setDragging(true)
      adapter.current?.lockGestures(true)
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // pointerup 済みなどで捕捉できなくても、開閉判定自体は継続できる
      }
    }
    event.preventDefault()
    state.samples.push({ time: event.timeStamp, y: event.clientY })
    if (state.samples.length > 6) state.samples.shift()
    const raw = state.base + event.clientY - state.y0
    applyShift(Math.max(0, Math.min(travelRef.current, raw)))
  }

  function endDrag(event: React.PointerEvent<HTMLButtonElement>) {
    const state = drag.current
    if (event.pointerId !== state.pointerId) return
    state.pointerId = null
    if (!state.active) return
    state.active = false
    state.swiped = true
    setDragging(false)
    adapter.current?.lockGestures(false)
    state.samples.push({ time: event.timeStamp, y: event.clientY })
    const recent = state.samples.filter((sample) => event.timeStamp - sample.time < 120)
    const first = recent[0]
    const last = recent[recent.length - 1]
    const velocity =
      first && last && last.time !== first.time ? (last.y - first.y) / (last.time - first.time) : 0
    onOpenChange(decideSheet(open, shiftRef.current, travelRef.current, velocity))
  }

  function toggle() {
    if (drag.current.swiped) {
      drag.current.swiped = false
      return
    }
    onOpenChange(!open)
  }

  function beginDesktopResize(event: React.PointerEvent<HTMLHRElement>) {
    if (mobile || desktopMode !== 'sidebar') return
    desktopResizePointer.current = event.pointerId
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function moveDesktopResize(event: React.PointerEvent<HTMLHRElement>) {
    if (desktopResizePointer.current !== event.pointerId) return
    onDesktopResize?.(event.clientX)
  }

  function endDesktopResize(event: React.PointerEvent<HTMLHRElement>) {
    if (desktopResizePointer.current !== event.pointerId) return
    desktopResizePointer.current = null
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // pointercancel 後など、既に解放済みなら何もしない
    }
  }

  function resizeWithKeyboard(event: React.KeyboardEvent<HTMLHRElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    onDesktopResize?.(desktopWidth + (event.key === 'ArrowRight' ? 16 : -16))
  }

  return (
    <div
      ref={rootRef}
      className={
        mobile
          ? `fixed right-0 bottom-0 left-0 z-10 overflow-visible rounded-t-[14px] border-t border-slate-300 bg-white/95 pb-[env(safe-area-inset-bottom,0px)] shadow-[0_-3px_16px_rgba(0,0,0,0.2)] ${dragging ? '' : 'transition-transform duration-200 ease-out motion-reduce:transition-none'}`
          : desktopMode === 'sidebar'
            ? 'relative col-start-1 row-start-2 min-h-0 overflow-hidden border-r border-slate-200 bg-slate-50'
            : 'absolute top-3 left-3 z-10 max-h-[calc(100%-46px)] overflow-y-auto'
      }
    >
      {!mobile && desktopMode === 'sidebar' && desktopCollapsed ? (
        <button
          type="button"
          className="hidden h-full w-full cursor-pointer flex-col items-center gap-3 border-0 bg-white py-4 text-[10px] font-bold text-[#07156f] min-[900px]:flex"
          aria-label="サイドバーを開く"
          onClick={() => onDesktopCollapsedChange?.(false)}
        >
          <span className="grid size-7 place-items-center rounded-full bg-blue-50 text-base">
            ›
          </span>
          <span className="[writing-mode:vertical-rl]">サイドバーを開く</span>
        </button>
      ) : (
        !mobile &&
        desktopMode === 'sidebar' && (
          <div className="hidden h-8 items-center justify-between border-b border-slate-200 bg-white px-2 min-[900px]:flex">
            <span className="text-[9px] text-slate-500">右端をドラッグして幅を変更</span>
            <button
              type="button"
              className="min-h-6 cursor-pointer rounded-md border border-slate-200 bg-white px-2 text-[9px] font-bold text-[#07156f]"
              onClick={() => onDesktopCollapsedChange?.(true)}
              aria-label="サイドバーを畳む"
            >
              ‹ 畳む
            </button>
          </div>
        )
      )}
      {!mobile && desktopMode === 'sidebar' && !desktopCollapsed && (
        <hr
          aria-label="サイドバーの幅を変更"
          aria-orientation="vertical"
          aria-valuemin={DESKTOP_SIDEBAR_MIN}
          aria-valuemax={DESKTOP_SIDEBAR_MAX}
          aria-valuenow={desktopWidth}
          tabIndex={0}
          className="absolute top-0 right-0 z-20 m-0 hidden h-full w-1.5 cursor-col-resize border-0 bg-transparent outline-none hover:bg-blue-400/40 focus:bg-blue-500/50 min-[900px]:block"
          onKeyDown={resizeWithKeyboard}
          onPointerDown={beginDesktopResize}
          onPointerMove={moveDesktopResize}
          onPointerUp={endDesktopResize}
          onPointerCancel={endDesktopResize}
        />
      )}
      <button
        type="button"
        className={`relative z-10 min-h-[74px] w-full touch-none flex-col items-center justify-center gap-1 rounded-t-[14px] bg-white/95 px-3 py-2 select-none ${mobile ? 'flex' : 'hidden'}`}
        aria-expanded={open}
        aria-controls="route-sheet-body"
        onClick={toggle}
        onPointerDown={beginDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <span className="h-1 w-10 rounded-full bg-slate-300" />
        {summary ? (
          <span className="flex flex-wrap items-baseline justify-center gap-x-2 text-[12px]">
            <b>{conditionLabel ?? summary.label}</b>
            <span>{summary.distance}</span>
            <span>徒歩 {summary.minutes}分</span>
            {summary.evaluation && <span>{summary.evaluation}</span>}
          </span>
        ) : (
          <span className="text-[12px] text-slate-600">{collapsedLabel}</span>
        )}
        <span className="text-[10.5px] text-slate-600">{open ? '閉じる' : '詳しく'}</span>
      </button>
      <div
        ref={bodyRef}
        id="route-sheet-body"
        className={
          mobile
            ? `relative z-0 max-h-[calc(80dvh-74px)] overscroll-contain overflow-y-auto ${dragging ? 'overflow-hidden' : ''}`
            : desktopMode === 'sidebar'
              ? 'h-[calc(100%-32px)] overflow-y-auto'
              : ''
        }
        hidden={!mobile && desktopMode === 'sidebar' && desktopCollapsed}
        inert={
          (mobile && !open && !dragging) ||
          (!mobile && desktopMode === 'sidebar' && desktopCollapsed)
            ? true
            : undefined
        }
      >
        {children}
      </div>
    </div>
  )
}
