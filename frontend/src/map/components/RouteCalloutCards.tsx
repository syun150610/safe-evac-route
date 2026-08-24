import { useEffect, useRef, useState } from 'react'

import type { CalloutSpec } from '../adapters/types'

const CARD_MARGIN = 12
const MOBILE_BOTTOM_INSET = 104
/** 左上の検索ボタン（12px + 48px）とカードの間にも12px空ける。 */
const TOP_LEFT_CONTROL_CLEARANCE = 72

interface Point {
  x: number
  y: number
}

interface DragState extends Point {
  id: string
  pointerId: number
  startX: number
  startY: number
}

function MoveIcon() {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2v20M2 12h20M8 6l4-4 4 4M8 18l4 4 4-4M6 8l-4 4 4 4M18 8l4 4-4 4" />
    </svg>
  )
}

export function clampCalloutPosition(
  point: Point,
  container: { width: number; height: number },
  card: { width: number; height: number },
  bottomInset: number,
): Point {
  const maxX = Math.max(CARD_MARGIN, container.width - card.width - CARD_MARGIN)
  const maxY = Math.max(CARD_MARGIN, container.height - card.height - bottomInset)
  const clamped = {
    x: Math.min(Math.max(point.x, CARD_MARGIN), maxX),
    y: Math.min(Math.max(point.y, CARD_MARGIN), maxY),
  }
  // 検索ボタンの周囲へカードを置かない。上辺へ動かしたい場合は右側へ、
  // 左辺へ動かしたい場合は検索ボタンの下へ置ける。
  if (clamped.x < TOP_LEFT_CONTROL_CLEARANCE && clamped.y < TOP_LEFT_CONTROL_CLEARANCE) {
    clamped.y = Math.min(TOP_LEFT_CONTROL_CLEARANCE, maxY)
  }
  return clamped
}

/** 地図上の経路要約。地点へ固定せず、利用者が画面内の好きな場所へ動かせる。 */
export function RouteCalloutCards({
  callouts,
  mobile,
}: {
  callouts: CalloutSpec[]
  mobile: boolean
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef<Record<string, HTMLElement | null>>({})
  const dragRef = useRef<DragState | null>(null)
  const [positions, setPositions] = useState<Record<string, Point>>({})
  const [frontCalloutId, setFrontCalloutId] = useState<string | null>(null)

  useEffect(() => {
    const valid = new Set(callouts.map((callout) => callout.id))
    setPositions((current) =>
      Object.fromEntries(Object.entries(current).filter(([id]) => valid.has(id))),
    )
    setFrontCalloutId((current) => (current && valid.has(current) ? current : null))
  }, [callouts])

  function beginDrag(event: React.PointerEvent<HTMLButtonElement>, id: string) {
    if (!event.isPrimary) return
    const root = rootRef.current
    const card = cardRefs.current[id]
    if (!root || !card) return
    event.preventDefault()
    event.stopPropagation()
    // 重なったカードを動かすとき、操作対象が別カードの下へ潜らないよう最前面へ出す。
    setFrontCalloutId(id)
    const rootRect = root.getBoundingClientRect()
    const cardRect = card.getBoundingClientRect()
    dragRef.current = {
      id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: cardRect.left - rootRect.left,
      y: cardRect.top - rootRect.top,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function moveDrag(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const root = rootRef.current
    const card = cardRefs.current[drag.id]
    if (!root || !card) return
    event.preventDefault()
    const next = clampCalloutPosition(
      {
        x: drag.x + event.clientX - drag.startX,
        y: drag.y + event.clientY - drag.startY,
      },
      { width: root.clientWidth, height: root.clientHeight },
      { width: card.offsetWidth, height: card.offsetHeight },
      mobile ? MOBILE_BOTTOM_INSET : CARD_MARGIN,
    )
    setPositions((current) => ({ ...current, [drag.id]: next }))
  }

  function endDrag(event: React.PointerEvent<HTMLButtonElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // pointercancel 後など、既に解放済みなら何もしない
    }
  }

  return (
    <div ref={rootRef} className="pointer-events-none absolute inset-0 z-[4]" aria-live="polite">
      {callouts.map((callout, index) => {
        const position = positions[callout.id]
        const initial =
          index === 0
            ? { top: TOP_LEFT_CONTROL_CLEARANCE, left: CARD_MARGIN }
            : { right: CARD_MARGIN, bottom: mobile ? MOBILE_BOTTOM_INSET : CARD_MARGIN }
        return (
          <article
            key={callout.id}
            ref={(node) => {
              cardRefs.current[callout.id] = node
            }}
            data-callout-id={callout.id}
            className="pointer-events-auto absolute w-[min(220px,calc(100%-24px))] rounded-xl border border-slate-200 bg-white p-2 shadow-[0_6px_18px_rgb(15_23_42/22%)]"
            style={{
              ...(position ? { top: position.y, left: position.x } : initial),
              zIndex: frontCalloutId === callout.id ? 1 : 0,
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="absolute top-1.5 right-1.5 z-10 flex gap-1">
              <button
                type="button"
                className="grid size-8 touch-none cursor-move place-items-center rounded-full border-0 bg-slate-100 text-[15px] text-slate-600 hover:bg-slate-200"
                aria-label="経路要約カードを移動"
                title="カードを移動"
                onPointerDown={(event) => beginDrag(event, callout.id)}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              >
                <MoveIcon />
              </button>
              <button
                type="button"
                className="grid size-8 cursor-pointer place-items-center rounded-full border-0 bg-slate-100 text-[18px] text-slate-600 hover:bg-slate-200"
                aria-label="この要約を閉じる（行先のピンで戻せます）"
                onClick={callout.onDismiss}
              >
                ×
              </button>
            </div>
            {/* biome-ignore lint/security/noDangerouslySetInnerHtml: route-calloutsがAPI由来文字列をescapeHtmlした内部生成HTML */}
            <div className="pr-[72px]" dangerouslySetInnerHTML={{ __html: callout.html }} />
          </article>
        )
      })}
    </div>
  )
}
