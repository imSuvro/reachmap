/**
 * Engine-dependent sidecars (ADR-007): the default-view isochrone GeoJSON
 * and the poster WebP — rendered in plain Node via sharp (SVG -> WebP), no
 * GL, no browser, no tile fetches. The poster shares the exact WebMercator
 * camera (defaultView.zoom) the live map initializes with, so the tier-2
 * cross-fade cannot jump.
 */
import sharp from "sharp";
import type { CityConfig } from "../config/city";
import { Engine } from "../src/engine/engine";
import { mercatorPx } from "../src/engine/geo";
import type { BandCollection } from "../src/engine/types";

export const POSTER_W = 1200;
export const POSTER_H = 630;

const MAP_BASE = "#EDEAE3";
const INK = "#1B1B2F";
const BAND_COLORS: Record<number, { fill: string; line: string }> = {
  900: { fill: "#FFB300", line: "#C68600" },
  1800: { fill: "#F4511E", line: "#C23A0F" },
  2700: { fill: "#C2185B", line: "#8E1043" },
  3600: { fill: "#4527A0", line: "#311B7A" },
};
/** blend hex color onto the base at alpha — poster fills are pre-composited */
function blend(hex: string, alpha: number): string {
  const c = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16);
  const b = (x: number, y: number) => Math.round(x * alpha + y * (1 - alpha));
  const base = [c(MAP_BASE, 1), c(MAP_BASE, 3), c(MAP_BASE, 5)];
  const col = [c(hex, 1), c(hex, 3), c(hex, 5)];
  return `#${[0, 1, 2].map((i) => b(col[i]!, base[i]!).toString(16).padStart(2, "0")).join("")}`;
}
const FILL_ALPHA: Record<number, number> = { 900: 0.44, 1800: 0.4, 2700: 0.36, 3600: 0.3 };

export async function renderSidecars(
  artifact: ArrayBuffer,
  cfg: CityConfig,
  bbox: [number, number, number, number],
): Promise<{ geojson: Uint8Array; poster: Uint8Array; width: number; height: number }> {
  const engine = new Engine(artifact, {
    horizonSec: Math.max(...cfg.bands),
    walking: { speedMps: cfg.walking.speedMps, detour: cfg.walking.detour },
    bands: cfg.bands,
    bbox,
    gridCellM: cfg.gridCellM,
  });
  const dv = cfg.defaultView;
  const { geojson, stats } = engine.query(dv.lat, dv.lon, dv.weekday, dv.depSec);
  if (stats.outOfCoverage || stats.reachedLast === 0) {
    throw new Error(
      `default view produced an empty isochrone (outOfCoverage=${stats.outOfCoverage}, reached=${stats.reachedLast}) — defaultView misconfigured?`,
    );
  }
  const geojsonBytes = new TextEncoder().encode(JSON.stringify(geojson));
  const poster = await renderPoster(geojson, dv);
  return { geojson: geojsonBytes, poster, width: POSTER_W, height: POSTER_H };
}

async function renderPoster(
  geojson: BandCollection,
  dv: { lat: number; lon: number; zoom: number },
): Promise<Uint8Array> {
  const center = mercatorPx(dv.lat, dv.lon, dv.zoom);
  const px = (lon: number, lat: number): [number, number] => {
    const p = mercatorPx(lat, lon, dv.zoom);
    return [p.x - center.x + POSTER_W / 2, p.y - center.y + POSTER_H / 2];
  };
  const pathOf = (coords: number[][][][]): string =>
    coords
      .map((poly) =>
        poly
          .map(
            (ring) =>
              "M" +
              ring
                .map((pt) => {
                  const [x, y] = px(pt[0]!, pt[1]!);
                  return `${x.toFixed(1)} ${y.toFixed(1)}`;
                })
                .join("L") +
              "Z",
          )
          .join(""),
      )
      .join("");
  // draw cumulative regions outermost-first; inner bands paint over outer,
  // producing exact rings with pre-composited colors
  const layers = [...geojson.features]
    .sort((a, b) => b.properties.band - a.properties.band)
    .map((f) => {
      const c = BAND_COLORS[f.properties.band] ?? { fill: "#888888", line: "#555555" };
      const fill = blend(c.fill, FILL_ALPHA[f.properties.band] ?? 0.35);
      return `<path d="${pathOf(f.geometry.coordinates)}" fill="${fill}" stroke="${c.line}" stroke-width="1.5" fill-rule="evenodd"/>`;
    })
    .join("\n  ");
  const [pinX, pinY] = px(dv.lon, dv.lat);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${POSTER_W}" height="${POSTER_H}" viewBox="0 0 ${POSTER_W} ${POSTER_H}">
  <rect width="${POSTER_W}" height="${POSTER_H}" fill="${MAP_BASE}"/>
  ${layers}
  <circle cx="${pinX.toFixed(1)}" cy="${pinY.toFixed(1)}" r="7" fill="${INK}" stroke="#ffffff" stroke-width="3.5"/>
</svg>`;
  const webp = await sharp(Buffer.from(svg)).webp({ quality: 82, effort: 6 }).toBuffer();
  return new Uint8Array(webp);
}
