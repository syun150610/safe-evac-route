export interface ClientPoint {
  x: number
  y: number
}

const HOLD_MS = 650
/** 指は静止していても数px揺れる。8pxでは実機で通常の長押しまで取り消していた。 */
const MOVE_TOLERANCE_PX = 18

/** 地図ライブラリのイベントに依存せず、タッチ・ペン・マウスの長押しを検出する。
 *
 * captureで受けるのは、Google Mapsなどの内側要素がイベントを止めても検出するため。
 * 一方、一定以上動いたら即座に取り消し、地図を移動する操作を地点指定にしない。 */
export function installLongPress(
  target: HTMLElement,
  onLongPress: (point: ClientPoint) => void,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pointerId: number | null = null
  let start: ClientPoint | null = null

  const cancel = () => {
    if (timer) clearTimeout(timer)
    timer = null
    pointerId = null
    start = null
  }

  const onPointerDown = (event: PointerEvent) => {
    if (!event.isPrimary || event.button !== 0) return
    cancel()
    pointerId = event.pointerId
    start = { x: event.clientX, y: event.clientY }
    timer = setTimeout(() => {
      const point = start
      if (!point) return
      onLongPress(point)
      cancel()
    }, HOLD_MS)
  }

  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerId !== pointerId || !start) return
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > MOVE_TOLERANCE_PX) {
      cancel()
    }
  }

  const onPointerEnd = (event: PointerEvent) => {
    if (event.pointerId === pointerId) cancel()
  }
  const onContextMenu = (event: MouseEvent) => event.preventDefault()

  target.addEventListener('pointerdown', onPointerDown, true)
  target.addEventListener('contextmenu', onContextMenu, true)
  window.addEventListener('pointermove', onPointerMove, true)
  window.addEventListener('pointerup', onPointerEnd, true)
  window.addEventListener('pointercancel', onPointerEnd, true)

  return () => {
    cancel()
    target.removeEventListener('pointerdown', onPointerDown, true)
    target.removeEventListener('contextmenu', onContextMenu, true)
    window.removeEventListener('pointermove', onPointerMove, true)
    window.removeEventListener('pointerup', onPointerEnd, true)
    window.removeEventListener('pointercancel', onPointerEnd, true)
  }
}
