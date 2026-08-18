import { km } from '../lib/format'
import type { Bundle } from '../types'

const FLING_VELOCITY = 0.45

export interface SheetSummary {
  label: string
  distance: string
  minutes: number
  baselineDelta: number | null
}

export function sheetSummary(bundle: Bundle | null): SheetSummary | null {
  if (!bundle?.routes.length) return null
  const route =
    bundle.routes.find((item) => item.id === bundle.selected_route) ??
    bundle.routes.find((item) => item.role === 'recommended') ??
    bundle.routes[0]
  const baseline = bundle.routes.find((item) => item.id === 'baseline')
  const baselineDelta =
    baseline && baseline.id !== route.id
      ? route.stats.duration_min_60 - baseline.stats.duration_min_60
      : null
  return {
    label: `${route.no} ${route.label}`,
    distance: km(route.stats.distance_m),
    minutes: Math.round(route.stats.duration_min_60),
    baselineDelta: baselineDelta == null ? null : Math.round(baselineDelta),
  }
}

export function decideSheet(
  open: boolean,
  shift: number,
  travel: number,
  velocity: number,
): boolean {
  if (velocity > FLING_VELOCITY) return false
  if (velocity < -FLING_VELOCITY) return true
  const threshold = Math.min(120, Math.max(40, travel * 0.25))
  return open ? shift < threshold : shift < travel - threshold
}
