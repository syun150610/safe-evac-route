import type { Post } from './types'

const geocodeCache = new Map<string, string | null>()
let geocodeQueue = Promise.resolve()
let lastGeocodeAt = 0

export async function reverseGeocode(post: Pick<Post, 'latitude' | 'longitude'>) {
  if (post.latitude == null || post.longitude == null) return null
  const key = `${post.latitude.toFixed(5)},${post.longitude.toFixed(5)}`
  if (geocodeCache.has(key)) return geocodeCache.get(key) ?? null

  const request = geocodeQueue.then(async () => {
    const wait = Math.max(0, 1000 - (Date.now() - lastGeocodeAt))
    if (wait > 0) await new Promise((resolve) => window.setTimeout(resolve, wait))
    lastGeocodeAt = Date.now()

    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${post.latitude}&lon=${post.longitude}&zoom=18&addressdetails=1`,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'safe-evac-route/prototype (https://github.com/syun150610/safe-evac-route)',
        },
      },
    )
    if (!response.ok) return null
    const data = (await response.json()) as { address?: Record<string, string> }
    const address = data.address ?? {}
    const parts = [
      address.city || address.town || address.village || address.city_district,
      address.suburb || address.neighbourhood,
      address.road,
    ].filter((part): part is string => Boolean(part))
    return parts.slice(0, 2).join('') || null
  })

  geocodeQueue = request.then(
    () => undefined,
    () => undefined,
  )
  const name = await request.catch(() => null)
  geocodeCache.set(key, name)
  return name
}
