/**
 * Connection Scan engine (ADR-001, ADR-005, ADR-006) over a decoded
 * artifact. Isomorphic and allocation-free per query (buffers are reused;
 * boarded-flags use epoch stamping instead of refills).
 *
 * The after-midnight rule is a MERGED two-cursor ascending scan by
 * effective departure time: today's window [T, T+H) against bits[wd] and
 * yesterday's [T+86400, T+86400+H) against bits[(wd+6)%7], interleaved so a
 * yesterday->today transfer is found (two sequential passes would break
 * CSA's non-decreasing-departure invariant — stage-5 review finding).
 */
import { section } from "./container";
import type { DecodedArtifact } from "./types";
import { distM, M_PER_DEG_LAT, mPerDegLon } from "./geo";

export interface EngineParams {
  horizonSec: number;
  walking: { speedMps: number; detour: number };
  bbox: [number, number, number, number];
}

export interface QueryResult {
  /** seconds since service-day midnight of earliest arrival, per stop; +inf unreached */
  arrival: Float64Array;
  walkOnly: boolean;
  outOfCoverage: boolean;
  reachedLast: number;
}

export class Csa {
  private depTime: Uint32Array;
  private rideSec: Uint16Array;
  private depStop: Uint16Array;
  private arrStop: Uint16Array;
  private tripIdx: Uint32Array;
  private tripBits: Uint8Array;
  private bytesPerDay: number;
  readonly latE5: Int32Array;
  readonly lonE5: Int32Array;
  private fpOff: Uint32Array;
  private fpTarget: Uint16Array;
  private fpWalk: Uint16Array;
  private idxOff: Uint32Array;
  private idxStops: Uint16Array;
  private meta: Int32Array;
  readonly S: number;
  readonly T: number;
  readonly C: number;

  private arrival: Float64Array;
  private stamp0: Uint32Array;
  private stamp1: Uint32Array;
  private epoch = 0;

  readonly effMps: number;
  readonly maxWalkM: number;

  constructor(
    art: DecodedArtifact,
    readonly params: EngineParams,
  ) {
    this.depTime = section(art, "conn.depTimeSec");
    this.rideSec = section(art, "conn.rideSec");
    this.depStop = section(art, "conn.depStop");
    this.arrStop = section(art, "conn.arrStop");
    this.tripIdx = section(art, "conn.tripIdx");
    this.tripBits = section(art, "day.tripBits");
    this.latE5 = section(art, "stops.lat");
    this.lonE5 = section(art, "stops.lon");
    this.fpOff = section(art, "fp.offsets");
    this.fpTarget = section(art, "fp.target");
    this.fpWalk = section(art, "fp.walkSec");
    this.idxOff = section(art, "idx.cellOffsets");
    this.idxStops = section(art, "idx.stopIds");
    this.meta = section(art, "idx.meta");
    this.S = art.counts.stops;
    this.T = art.counts.trips;
    this.C = art.counts.connections;
    this.bytesPerDay = Math.ceil(this.T / 8);
    if (this.tripBits.length !== 7 * this.bytesPerDay) {
      throw new Error("day.tripBits length mismatch");
    }
    this.arrival = new Float64Array(this.S);
    this.stamp0 = new Uint32Array(this.T);
    this.stamp1 = new Uint32Array(this.T);
    this.effMps = params.walking.speedMps / params.walking.detour;
    this.maxWalkM = params.horizonSec * this.effMps;
  }

  private lowerBound(target: number): number {
    let lo = 0;
    let hi = this.C;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.depTime[mid]! < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private active(day: number, trip: number): boolean {
    return ((this.tripBits[day * this.bytesPerDay + (trip >> 3)]! >> (trip & 7)) & 1) === 1;
  }

  /** Seed every stop within the walk horizon of the origin (ADR-005: no radius cap). */
  private seed(lat: number, lon: number, T: number): number {
    const [minLonE5, minLatE5, cellLonE5, cellLatE5, cols, rows] = [
      this.meta[0]!, this.meta[1]!, this.meta[2]!, this.meta[3]!, this.meta[4]!, this.meta[5]!,
    ];
    const latE5 = Math.round(lat * 1e5);
    const lonE5 = Math.round(lon * 1e5);
    const rLatCells = Math.ceil((this.maxWalkM / M_PER_DEG_LAT) * 1e5 / cellLatE5) + 1;
    const mLon = mPerDegLon(lat);
    const rLonCells = Math.ceil((this.maxWalkM / mLon) * 1e5 / cellLonE5) + 1;
    const cx = Math.floor((lonE5 - minLonE5) / cellLonE5);
    const cy = Math.floor((latE5 - minLatE5) / cellLatE5);
    let seeded = 0;
    for (let gy = Math.max(0, cy - rLatCells); gy <= Math.min(rows - 1, cy + rLatCells); gy++) {
      for (let gx = Math.max(0, cx - rLonCells); gx <= Math.min(cols - 1, cx + rLonCells); gx++) {
        const cell = gy * cols + gx;
        for (let e = this.idxOff[cell]!; e < this.idxOff[cell + 1]!; e++) {
          const s = this.idxStops[e]!;
          const d = distM(lat, lon, this.latE5[s]! / 1e5, this.lonE5[s]! / 1e5, mLon);
          if (d > this.maxWalkM) continue;
          const t = T + d / this.effMps;
          if (t < this.arrival[s]!) {
            this.arrival[s] = t;
            seeded++;
          }
        }
      }
    }
    return seeded;
  }

  private relaxFootpaths(stop: number, at: number, H: number) {
    for (let e = this.fpOff[stop]!; e < this.fpOff[stop + 1]!; e++) {
      const na = at + this.fpWalk[e]!;
      const t = this.fpTarget[e]!;
      if (na <= H && na < this.arrival[t]!) this.arrival[t] = na;
    }
  }

  query(lat: number, lon: number, weekday: number, depSec: number): QueryResult {
    const [w, s, e, n] = this.params.bbox;
    const outOfCoverage = lon < w || lon > e || lat < s || lat > n;
    this.arrival.fill(Infinity);
    this.epoch++;
    if (this.epoch === 0xffffffff) {
      this.stamp0.fill(0);
      this.stamp1.fill(0);
      this.epoch = 1;
    }
    if (outOfCoverage) {
      return { arrival: this.arrival, walkOnly: true, outOfCoverage: true, reachedLast: 0 };
    }

    const T = depSec;
    const H = T + this.params.horizonSec;
    this.seed(lat, lon, T);

    const dayToday = weekday;
    const dayYesterday = (weekday + 6) % 7;
    let i0 = this.lowerBound(T);
    let i1 = this.lowerBound(T + 86400);
    const end0 = H;
    const end1 = H + 86400;
    let boarded = false;

    const { depTime, rideSec, depStop, arrStop, tripIdx, arrival } = this;
    while (true) {
      const has0 = i0 < this.C && depTime[i0]! < end0;
      const has1 = i1 < this.C && depTime[i1]! < end1;
      if (!has0 && !has1) break;
      const eff0 = has0 ? depTime[i0]! : Infinity;
      const eff1 = has1 ? depTime[i1]! - 86400 : Infinity;
      if (eff0 <= eff1) {
        const t = tripIdx[i0]!;
        if (this.active(dayToday, t)) {
          const onBoard = this.stamp0[t] === this.epoch;
          if (onBoard || arrival[depStop[i0]!]! <= eff0) {
            this.stamp0[t] = this.epoch;
            boarded = true;
            const a = eff0 + rideSec[i0]!;
            if (a <= H && a < arrival[arrStop[i0]!]!) {
              arrival[arrStop[i0]!] = a;
              this.relaxFootpaths(arrStop[i0]!, a, H);
            }
          }
        }
        i0++;
      } else {
        const t = tripIdx[i1]!;
        if (this.active(dayYesterday, t)) {
          const onBoard = this.stamp1[t] === this.epoch;
          if (onBoard || arrival[depStop[i1]!]! <= eff1) {
            this.stamp1[t] = this.epoch;
            boarded = true;
            const a = eff1 + rideSec[i1]!;
            if (a <= H && a < arrival[arrStop[i1]!]!) {
              arrival[arrStop[i1]!] = a;
              this.relaxFootpaths(arrStop[i1]!, a, H);
            }
          }
        }
        i1++;
      }
    }

    let reachedLast = 0;
    for (let i = 0; i < this.S; i++) if (arrival[i]! <= H) reachedLast++;
    return { arrival, walkOnly: !boarded, outOfCoverage: false, reachedLast };
  }
}
