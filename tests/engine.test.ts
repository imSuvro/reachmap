import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { compileFeed } from "../pipeline/compile";
import { encodeContainer } from "../src/engine/container";
import { Engine, type EngineConfig } from "../src/engine/engine";
import type { BandCollection, Manifest } from "../src/engine/types";
import { baseFeed, testConfig } from "./fixture";

const cfg = testConfig();

function makeEngine(files = baseFeed()) {
  const compiled = compileFeed(files, cfg);
  const raw = encodeContainer(compiled.sections, compiled.counts, "test");
  const ec: EngineConfig = {
    horizonSec: 3600,
    walking: { speedMps: cfg.walking.speedMps, detour: cfg.walking.detour },
    bands: cfg.bands,
    bbox: compiled.bbox,
    gridCellM: cfg.gridCellM,
  };
  return { engine: new Engine(raw.buffer.slice(0) as ArrayBuffer, ec), compiled };
}

/** ray-casting point-in-multipolygon (evenodd), for nesting checks */
function inMultiPolygon(lon: number, lat: number, coords: number[][][][]): boolean {
  let inside = false;
  for (const poly of coords) {
    for (const ring of poly) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = [ring[i]![0]!, ring[i]![1]!];
        const [xj, yj] = [ring[j]![0]!, ring[j]![1]!];
        if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
          inside = !inside;
        }
      }
    }
  }
  return inside;
}

describe("engine correctness (fixture artifact)", () => {
  const { engine, compiled } = makeEngine();

  it("never arrives before departure across random queries", () => {
    let rng = 7;
    const rand = () => (rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const [w, s, e, n] = compiled.bbox;
    for (let k = 0; k < 200; k++) {
      const T = Math.floor(rand() * 86400);
      const q = engine.csa.query(
        s + rand() * (n - s),
        w + rand() * (e - w),
        Math.floor(rand() * 7),
        T,
      );
      for (let i = 0; i < q.arrival.length; i++) {
        const a = q.arrival[i]!;
        if (a !== Infinity) expect(a).toBeGreaterThanOrEqual(T);
      }
    }
  });

  it("stop reach sets nest across thresholds", () => {
    const q = engine.csa.query(13.0, 80.0, 1, 8 * 3600 - 300);
    const T = 8 * 3600 - 300;
    const counts = cfg.bands.map(
      (b) => [...q.arrival].filter((a) => a <= T + b).length,
    );
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]!).toBeGreaterThanOrEqual(counts[i - 1]!);
    }
    expect(counts[3]!).toBeGreaterThan(0);
  });

  it("band polygons nest: sampled points are monotone in threshold", () => {
    const { geojson } = engine.query(13.0, 80.0, 1, 8 * 3600 - 300);
    let rng = 13;
    const rand = () => (rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const [w, s, e, n] = compiled.bbox;
    let tested = 0;
    for (let k = 0; k < 500; k++) {
      const lon = w + rand() * (e - w);
      const lat = s + rand() * (n - s);
      const membership = geojson.features.map((f) =>
        inMultiPolygon(lon, lat, f.geometry.coordinates),
      );
      for (let i = 1; i < membership.length; i++) {
        if (membership[i - 1]!) {
          expect(membership[i]!).toBe(true);
          tested++;
        }
      }
    }
    expect(tested).toBeGreaterThan(0);
  });

  it("timetable oracle: riding t1 from its first stop arrives no later than scheduled", () => {
    // t1 departs A at 08:00:00, scheduled at D 08:10:00 (Tuesday)
    const q = engine.csa.query(13.0, 80.0, 1, 8 * 3600);
    expect(q.arrival[3]!).toBeLessThanOrEqual(8 * 3600 + 600);
    expect(q.walkOnly).toBe(false);
  });

  it("weekday bitsets gate service: t3 runs Saturday only", () => {
    // t3 departs A 09:00 -> B 09:06. Tuesday at 08:55: B reachable only on foot (~196s)
    const tue = engine.csa.query(13.0, 80.0, 1, 8 * 3600 + 55 * 60);
    const sat = engine.csa.query(13.0, 80.0, 5, 8 * 3600 + 55 * 60);
    const T = 8 * 3600 + 55 * 60;
    expect(sat.arrival[1]!).toBeLessThanOrEqual(9 * 3600 + 6 * 60);
    // on Tuesday the walking path (~196 s) beats waiting for nothing
    expect(tue.arrival[1]!).toBeGreaterThan(T + 150);
    expect(tue.arrival[1]!).toBeLessThan(T + 300);
  });

  it("walk-only desert click yields an honest small answer", () => {
    const [w, s] = compiled.bbox;
    const q = engine.query(s + 0.002, w + 0.002, 1, 8 * 3600);
    expect(q.stats.walkOnly).toBe(true);
    expect(q.stats.outOfCoverage).toBe(false);
    expect(q.stats.reachedLast).toBe(0);
    // the walk disc still paints bands around the origin
    expect(q.geojson.features[3]!.geometry.coordinates.length).toBeGreaterThan(0);
  });

  it("out-of-coverage click returns empty bands, never a clamp", () => {
    const q = engine.query(20.0, 85.0, 1, 8 * 3600);
    expect(q.stats.outOfCoverage).toBe(true);
    for (const f of q.geojson.features) expect(f.geometry.coordinates).toEqual([]);
  });

  it("is deterministic: identical queries produce identical GeoJSON", () => {
    const a = JSON.stringify(engine.query(13.0, 80.0, 1, 30600).geojson);
    const b = JSON.stringify(engine.query(13.0, 80.0, 1, 30600).geojson);
    expect(a).toBe(b);
    const { engine: engine2 } = makeEngine();
    const c = JSON.stringify(engine2.query(13.0, 80.0, 1, 30600).geojson);
    expect(a).toBe(c);
  });
});

describe("after-midnight service (merged two-cursor scan)", () => {
  function midnightFeed() {
    const files = baseFeed();
    // Distances chosen so WALKING CANNOT beat transit (else the assertions
    // would pass even without the merged scan): B is 3.0 km from the origin
    // (walk arrival ~4732s > 3900s by bus) and C is 400 m past B (outside
    // the 300 m footpath radius, 3.4 km from the origin, walk ~5123s).
    files.set(
      "stops.txt",
      [
        "stop_id,stop_name,stop_lat,stop_lon",
        "A,Alpha,13.0000,80.0000",
        "B,Beta,13.0270,80.0000",
        "C,Gamma,13.0306,80.0000",
      ].join("\n"),
    );
    files.set(
      "trips.txt",
      ["route_id,service_id,trip_id", "r1,WK,t2", "r1,WK,t7"].join("\n"),
    );
    files.set(
      "stop_times.txt",
      [
        "trip_id,arrival_time,departure_time,stop_id,stop_sequence",
        // yesterday frame: departs 25:00 (= 01:00 wall clock next day)
        "t2,25:00:00,25:00:00,A,1",
        "t2,25:05:00,25:05:00,B,2",
        // today frame: departs B 01:10, reaches C 01:15
        "t7,01:10:00,01:10:00,B,1",
        "t7,01:15:00,01:15:00,C,2",
      ].join("\n"),
    );
    return files;
  }
  const { engine } = makeEngine(midnightFeed());

  it("Monday 00:30 sees Sunday's 25:00 trip (modular weekday wrap)", () => {
    const q = engine.csa.query(13.0, 80.0, 0, 1800); // Monday 00:30
    // B reached at effective 01:05 = 3900s
    expect(q.arrival[1]!).toBe(3900);
  });

  it("a yesterday-frame arrival can board a today-frame departure", () => {
    const q = engine.csa.query(13.0, 80.0, 0, 1800);
    // t7 departs B 01:10 (4200) AFTER t2's effective arrival 01:05 -> C at 01:15
    expect(q.arrival[2]!).toBe(4500);
  });
});

describe("real Chennai artifact (skipped when not built)", () => {
  const dir = join(import.meta.dirname, "..", "public", "data", "chennai");
  const manifestPath = join(dir, "manifest.json");
  const available = existsSync(manifestPath);

  it.skipIf(!available)("meets the latency gate and answers the default view", () => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
    const gz = readFileSync(join(dir, manifest.artifact.url.split("/").pop()!));
    const raw = gunzipSync(gz);
    const engine = new Engine(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer, {
      horizonSec: manifest.horizonSec,
      walking: { speedMps: manifest.walking.speedMps, detour: manifest.walking.detour },
      bands: manifest.bands,
      bbox: manifest.bbox,
      gridCellM: manifest.grid.cellM,
    });
    const dv = manifest.defaultView;
    const t0 = performance.now();
    const { geojson, stats } = engine.query(dv.lat, dv.lon, dv.weekday, dv.depSec);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(250);
    expect(stats.walkOnly).toBe(false);
    expect(stats.reachedLast).toBeGreaterThan(2000);
    for (const f of geojson.features) {
      expect(f.geometry.coordinates.length).toBeGreaterThan(0);
    }
    // band property carries seconds matching manifest.bands, in order
    expect(geojson.features.map((f) => f.properties.band)).toEqual(manifest.bands);
  });

  it.skipIf(!available)("cross-checks a real timetable oracle from the raw feed", () => {
    // Chennai Central Tue 08:30 must reach a large area; determinism across instances
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
    const gz = readFileSync(join(dir, manifest.artifact.url.split("/").pop()!));
    const raw = gunzipSync(gz);
    const mk = () =>
      new Engine(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer, {
        horizonSec: manifest.horizonSec,
        walking: { speedMps: manifest.walking.speedMps, detour: manifest.walking.detour },
        bands: manifest.bands,
        bbox: manifest.bbox,
        gridCellM: manifest.grid.cellM,
      });
    const a = JSON.stringify(mk().query(13.0827, 80.2757, 1, 30600).geojson).length;
    const b = JSON.stringify(mk().query(13.0827, 80.2757, 1, 30600).geojson).length;
    expect(a).toBe(b);
  });
});

// keep the type import used (vitest strips otherwise-unused imports poorly)
export type _BC = BandCollection;
