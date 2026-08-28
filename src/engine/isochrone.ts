/**
 * Isochrone generation (ADR-004): one travel-time scalar field on a fixed
 * grid over the coverage bbox, contoured with marching squares at the band
 * thresholds. Nesting is guaranteed by construction (sublevel sets of one
 * field); no simplification (measured 84 KB raw / 17 KB gz at 200 m —
 * shipping exact keeps the guarantee unconditional). 5-dp coordinates.
 */
import { contours } from "d3-contour";
import type { BandCollection, BandFeature } from "./types";
import { M_PER_DEG_LAT, mPerDegLon } from "./geo";

export interface IsoParams {
  bbox: [number, number, number, number]; // coverage [w, s, e, n]
  cellM: number;
  bands: number[]; // seconds ascending
  effMps: number;
}

export class IsochroneGrid {
  readonly cols: number;
  readonly rows: number;
  private field: Float64Array;
  private minX: number;
  private minY: number;
  private mLon: number;

  constructor(readonly p: IsoParams) {
    // meter frame anchored at the bbox center latitude — internal to this
    // module, no cross-component agreement needed
    const [w, s, e, n] = p.bbox;
    this.mLon = mPerDegLon((s + n) / 2);
    this.minX = w * this.mLon;
    this.minY = s * M_PER_DEG_LAT;
    this.cols = Math.ceil(((e - w) * this.mLon) / p.cellM);
    this.rows = Math.ceil(((n - s) * M_PER_DEG_LAT) / p.cellM);
    this.field = new Float64Array(this.cols * this.rows);
  }

  /**
   * Fill the field from per-stop arrivals and contour it.
   * arrivalOffset(s) = earliest arrival at stop s MINUS T (seconds into the
   * journey), Infinity if unreached. Origin walking is stamped directly.
   */
  bands(
    originLat: number,
    originLon: number,
    stopLatE5: Int32Array,
    stopLonE5: Int32Array,
    arrival: Float64Array,
    T: number,
  ): BandCollection {
    const { cellM, bands, effMps } = this.p;
    const horizon = bands[bands.length - 1]!;
    this.field.fill(1e9);
    this.stamp(originLon * this.mLon, originLat * M_PER_DEG_LAT, 0, horizon, effMps, cellM);
    for (let s = 0; s < arrival.length; s++) {
      const off = arrival[s]! - T;
      if (off <= horizon) {
        this.stamp(
          (stopLonE5[s]! / 1e5) * this.mLon,
          (stopLatE5[s]! / 1e5) * M_PER_DEG_LAT,
          off,
          horizon,
          effMps,
          cellM,
        );
      }
    }
    // d3-contour yields regions >= threshold; contour the negated field.
    // Band identity comes from each contour's own `.value` — d3 reorders
    // thresholds internally, so positional mapping mislabels bands (a bug
    // this module shipped with until the point-sample nesting test caught it).
    const neg = this.field;
    for (let i = 0; i < neg.length; i++) neg[i] = -neg[i]!;
    const polys = contours()
      .size([this.cols, this.rows])
      .thresholds(bands.map((b) => -b))(neg as unknown as number[]);
    const features: BandFeature[] = polys
      .map((mp) => ({
        type: "Feature" as const,
        properties: { band: -(mp as unknown as { value: number }).value },
        geometry: {
          type: "MultiPolygon" as const,
          coordinates: mp.coordinates.map((poly) =>
            poly.map((ring) => ring.map((pt) => this.toLL(pt as [number, number], cellM))),
          ),
        },
      }))
      .sort((a, b) => a.properties.band - b.properties.band);
    if (
      features.length !== bands.length ||
      features.some((f, i) => f.properties.band !== bands[i])
    ) {
      throw new Error("contour thresholds do not match configured bands");
    }
    return { type: "FeatureCollection", features };
  }

  private stamp(
    cx: number,
    cy: number,
    startSec: number,
    horizon: number,
    effMps: number,
    cellM: number,
  ) {
    const budget = horizon - startSec;
    if (budget <= 0) return;
    const r = budget * effMps;
    const x0 = Math.max(0, Math.floor((cx - r - this.minX) / cellM));
    const x1 = Math.min(this.cols - 1, Math.floor((cx + r - this.minX) / cellM));
    const y0 = Math.max(0, Math.floor((cy - r - this.minY) / cellM));
    const y1 = Math.min(this.rows - 1, Math.floor((cy + r - this.minY) / cellM));
    const f = this.field;
    for (let gy = y0; gy <= y1; gy++) {
      const wy = this.minY + (gy + 0.5) * cellM;
      const dy2 = (wy - cy) * (wy - cy);
      const row = gy * this.cols;
      for (let gx = x0; gx <= x1; gx++) {
        const wx = this.minX + (gx + 0.5) * cellM;
        const d = Math.sqrt((wx - cx) * (wx - cx) + dy2);
        if (d > r) continue;
        const v = startSec + d / effMps;
        if (v < f[row + gx]!) f[row + gx] = v;
      }
    }
  }

  private toLL(pt: [number, number], cellM: number): number[] {
    const lon = (this.minX + pt[0] * cellM) / this.mLon;
    const lat = (this.minY + pt[1] * cellM) / M_PER_DEG_LAT;
    return [Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5];
  }
}
