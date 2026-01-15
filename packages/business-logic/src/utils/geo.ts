/**
 * Geographic utility functions for distance calculations
 * Shared between API and frontend
 */

/** Earth's radius in kilometers */
const EARTH_RADIUS_KM = 6371

/**
 * Converts degrees to radians
 */
function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

/**
 * Calculates the Haversine distance between two GPS coordinates.
 * Returns the distance in kilometers.
 *
 * The Haversine formula calculates the shortest distance over the earth's surface
 * giving an 'as-the-crow-flies' distance between the points.
 *
 * @see https://en.wikipedia.org/wiki/Haversine_formula
 *
 * @param lat1 - Latitude of point 1 (in degrees)
 * @param lon1 - Longitude of point 1 (in degrees)
 * @param lat2 - Latitude of point 2 (in degrees)
 * @param lon2 - Longitude of point 2 (in degrees)
 * @returns Distance in kilometers
 *
 * @example
 * ```ts
 * // Distance from Mexico City to Guadalajara
 * const distance = haversineDistance(19.4326, -99.1332, 20.6597, -103.3496)
 * console.log(distance) // ~461 km
 * ```
 */
export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLat = toRadians(lat2 - lat1)
  const dLon = toRadians(lon2 - lon1)

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return EARTH_RADIUS_KM * c
}

/**
 * Calculates the total distance for a sequence of coordinates.
 * Only considers locations with valid (non-null) coordinates.
 *
 * @param locations - Array of locations with latitude and longitude
 * @returns Total distance in kilometers (rounded to 2 decimal places)
 *
 * @example
 * ```ts
 * const route = [
 *   { latitude: 19.43, longitude: -99.13 },
 *   { latitude: 20.66, longitude: -103.35 },
 *   { latitude: 21.88, longitude: -102.29 },
 * ]
 * const totalKm = calculateTotalDistance(route)
 * ```
 */
export function calculateTotalDistance(
  locations: Array<{ latitude: number | null; longitude: number | null }>
): number {
  // Filter locations with valid coordinates
  const validLocations = locations.filter(
    (loc): loc is { latitude: number; longitude: number } =>
      loc.latitude !== null && loc.longitude !== null
  )

  if (validLocations.length < 2) {
    return 0
  }

  let totalDistance = 0

  for (let i = 0; i < validLocations.length - 1; i++) {
    const current = validLocations[i]
    const next = validLocations[i + 1]

    totalDistance += haversineDistance(
      current.latitude,
      current.longitude,
      next.latitude,
      next.longitude
    )
  }

  // Round to 2 decimal places
  return Math.round(totalDistance * 100) / 100
}
