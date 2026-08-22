import type { SearchRequest, ShelterSearchRequest } from '../types'
import type { Place } from './gsi'

export function buildShelterSearchRequest(
  origin: Place,
  hazards: Record<string, string>,
  scenario: string,
): ShelterSearchRequest {
  return {
    origin: { lat: origin.lat, lon: origin.lon, label: origin.title },
    hazards,
    include: ['baseline', 'selected'],
    scenario,
  }
}

export function buildRouteSearchRequest(
  base: ShelterSearchRequest,
  destination: Place,
): SearchRequest {
  return {
    ...base,
    dest: { lat: destination.lat, lon: destination.lon, label: destination.title },
  }
}
