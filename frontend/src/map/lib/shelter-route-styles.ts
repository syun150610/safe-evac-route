import { type RouteStyle, SHELTER_KIND_STYLE, STYLE } from '../constants'
import type { Bundle, RouteId } from '../types'

/** 避難先へ向かう回避経路を、その避難先のピンと同じ色にする。
 * 最短経路は比較基準なので灰色の破線を維持する。 */
export function shelterRouteStyles(bundle: Bundle | null): Record<RouteId, RouteStyle> {
  if (!bundle?.shelter) return STYLE

  const styles = { ...STYLE }
  const selected = bundle.selected_route
  if (selected && selected !== 'baseline' && selected !== 'shelter_alt_baseline') {
    styles[selected] = {
      ...STYLE[selected],
      color: SHELTER_KIND_STYLE[bundle.shelter.type].color,
    }
  }

  if (bundle.alt_shelter) {
    styles.shelter_alt = {
      ...STYLE.shelter_alt,
      color: SHELTER_KIND_STYLE[bundle.alt_shelter.type].color,
    }
  }

  return styles
}
