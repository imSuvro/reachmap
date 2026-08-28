/** Small geodesy helpers shared by the engine (isomorphic, deterministic). */

export const M_PER_DEG_LAT = 111132;

export function mPerDegLon(latDeg: number): number {
  return 111320 * Math.cos((latDeg * Math.PI) / 180);
}

/** Equirectangular distance in meters — exact enough at city scale. */
export function distM(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  mLon: number,
): number {
  const dx = (lon1 - lon2) * mLon;
  const dy = (lat1 - lat2) * M_PER_DEG_LAT;
  return Math.hypot(dx, dy);
}

/** WebMercator (matches MapLibre's camera math; world = 512 * 2^zoom px). */
export function mercatorPx(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const world = 512 * Math.pow(2, zoom);
  const x = ((lon + 180) / 360) * world;
  const s = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * world;
  return { x, y };
}
