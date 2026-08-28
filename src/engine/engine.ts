/**
 * The full engine: decoded artifact -> per-query band GeoJSON + stats.
 * Shared verbatim by the web worker, Node tests, and the sidecar renderer
 * (ADR-002: the identical module runs everywhere).
 */
import { decodeContainer } from "./container";
import { Csa } from "./csa";
import { IsochroneGrid } from "./isochrone";
import type { BandCollection, QueryStats } from "./types";

export interface EngineConfig {
  horizonSec: number;
  walking: { speedMps: number; detour: number };
  bands: number[];
  bbox: [number, number, number, number];
  gridCellM: number;
}

export class Engine {
  readonly csa: Csa;
  /** the resolved-config hash baked into the container at build (contract §1) */
  readonly configHash: string;
  private grid: IsochroneGrid;

  constructor(artifact: ArrayBuffer, cfg: EngineConfig) {
    const art = decodeContainer(artifact);
    this.configHash = art.configHash;
    this.csa = new Csa(art, {
      horizonSec: cfg.horizonSec,
      walking: cfg.walking,
      bbox: cfg.bbox,
    });
    this.grid = new IsochroneGrid({
      bbox: cfg.bbox,
      cellM: cfg.gridCellM,
      bands: cfg.bands,
      effMps: cfg.walking.speedMps / cfg.walking.detour,
    });
  }

  query(
    lat: number,
    lon: number,
    weekday: number,
    depSec: number,
  ): { geojson: BandCollection; stats: QueryStats } {
    const t0 = performance.now();
    const q = this.csa.query(lat, lon, weekday, depSec);
    let geojson: BandCollection;
    if (q.outOfCoverage) {
      geojson = {
        type: "FeatureCollection",
        features: this.grid.p.bands.map((b) => ({
          type: "Feature",
          properties: { band: b },
          geometry: { type: "MultiPolygon", coordinates: [] },
        })),
      };
    } else {
      geojson = this.grid.bands(lat, lon, this.csa.latE5, this.csa.lonE5, q.arrival, depSec);
    }
    return {
      geojson,
      stats: {
        reachedLast: q.reachedLast,
        walkOnly: q.walkOnly,
        outOfCoverage: q.outOfCoverage,
        computeMs: Math.round(performance.now() - t0),
      },
    };
  }
}
