import { describe, expect, it } from "vitest";
import { compileFeed } from "../pipeline/compile";
import { BuildError } from "../pipeline/gtfs";
import { encodeContainer } from "../src/engine/container";
import { baseFeed, testConfig } from "./fixture";

const cfg = testConfig();

function named(c: ReturnType<typeof compileFeed>, name: string) {
  const s = c.sections.find((s) => s.name === name);
  if (!s) throw new Error(`section ${name} missing`);
  return s.data;
}

describe("compileFeed on the base fixture", () => {
  const c = compileFeed(baseFeed(), cfg);

  it("counts and skips are exact", () => {
    expect(c.counts.stops).toBe(5); // A..D + Z
    expect(c.skipped.stopRows).toBe(2); // bad row + duplicate id
    expect(c.counts.trips).toBe(4); // t1..t4 survive; t5 dangling svc, blank id row skipped
    expect(c.skipped.tripRows).toBe(2);
    expect(c.skipped.danglingRefs).toBe(1); // GHOST stop ref
    expect(c.skipped.stopTimeRows).toBe(1); // "badrow,1"
    expect(c.counts.connections).toBe(6); // t1:3 (blank C interpolated), t2/t3/t4: 1 each
  });

  it("interpolates blank non-timepoint times linearly", () => {
    const dep = named(c, "conn.depTimeSec") as Uint32Array;
    const ride = named(c, "conn.rideSec") as Uint16Array;
    // t1 B->C departs at B 08:04:00, C interpolated to 08:07:00
    const i = [...dep].findIndex((d, k) => d === 29040 && ride[k] === 180);
    expect(i).toBeGreaterThanOrEqual(0);
    // and C->D departs 08:07:00 arriving 08:10:00
    expect([...dep]).toContain(29220);
  });

  it("preserves >24:00 departures raw", () => {
    const dep = named(c, "conn.depTimeSec") as Uint32Array;
    expect(Math.max(...dep)).toBe(90000); // t2 departs 25:00:00
  });

  it("renumbers trips by first departure and bitsets follow that domain", () => {
    // firstDep order: t1 08:00 < t3 09:00 < t4 10:00 < t2 25:00
    const trip = named(c, "conn.tripIdx") as Uint32Array;
    const dep = named(c, "conn.depTimeSec") as Uint32Array;
    const firstDepByTrip = new Map<number, number>();
    for (let i = 0; i < dep.length; i++) {
      const t = trip[i]!;
      if (!firstDepByTrip.has(t)) firstDepByTrip.set(t, dep[i]!);
      else firstDepByTrip.set(t, Math.min(firstDepByTrip.get(t)!, dep[i]!));
    }
    const firsts = [0, 1, 2, 3].map((t) => firstDepByTrip.get(t)!);
    expect(firsts).toEqual([...firsts].sort((a, b) => a - b));
    expect(Math.max(...trip)).toBe(c.counts.trips - 1); // max(tripIdx) < T

    const bits = named(c, "day.tripBits") as Uint8Array;
    const bytesPerDay = Math.ceil(c.counts.trips / 8);
    const active = (wd: number, t: number) => (bits[wd * bytesPerDay + (t >> 3)]! >> (t & 7)) & 1;
    // trip 0 = t1 (WK daily): active Mon..Sun
    for (let wd = 0; wd < 7; wd++) expect(active(wd, 0)).toBe(1);
    // trip 1 = t3 (SAT): only Saturday (wd 5)
    expect([0, 1, 2, 3, 4, 5, 6].map((wd) => active(wd, 1))).toEqual([0, 0, 0, 0, 0, 1, 0]);
    // trip 2 = t4 (EXPIRED): never active — in the artifact, zero bits
    for (let wd = 0; wd < 7; wd++) expect(active(wd, 2)).toBe(0);
    expect(c.calendar.activeTripsPerDay).toEqual([2, 2, 2, 2, 2, 3, 2]);
  });

  it("connections are sorted ascending by departure", () => {
    const dep = named(c, "conn.depTimeSec") as Uint32Array;
    for (let i = 1; i < dep.length; i++) expect(dep[i]!).toBeGreaterThanOrEqual(dep[i - 1]!);
  });

  it("generates symmetric footpaths within 300 m with the min floor", () => {
    const off = named(c, "fp.offsets") as Uint32Array;
    const tgt = named(c, "fp.target") as Uint16Array;
    const sec = named(c, "fp.walkSec") as Uint16Array;
    const edges = new Map<string, number>();
    for (let s = 0; s < c.counts.stops; s++) {
      for (let e = off[s]!; e < off[s + 1]!; e++) edges.set(`${s}:${tgt[e]}`, sec[e]!);
    }
    // A(0)<->B(1) ~200m apart: both directions, equal cost, >= 60s
    expect(edges.has("0:1")).toBe(true);
    expect(edges.get("0:1")).toBe(edges.get("1:0"));
    expect(edges.get("0:1")!).toBeGreaterThanOrEqual(60);
    // A(0)-C(2) ~400m: no edge; Z(4): isolated
    expect(edges.has("0:2")).toBe(false);
    expect(off[4 + 1]! - off[4]!).toBe(0);
  });

  it("spatial index locates stops via the contract cell formula", () => {
    const meta = named(c, "idx.meta") as Int32Array;
    const [minLonE5, minLatE5, cellLonE5, cellLatE5, cols, rows] = [...meta] as [
      number, number, number, number, number, number,
    ];
    const offs = named(c, "idx.cellOffsets") as Uint32Array;
    const ids = named(c, "idx.stopIds") as Uint16Array;
    const lat = named(c, "stops.lat") as Int32Array;
    const lon = named(c, "stops.lon") as Int32Array;
    expect(offs[cols * rows]!).toBe(c.counts.stops);
    for (let s = 0; s < c.counts.stops; s++) {
      const cx = Math.min(cols - 1, Math.max(0, Math.floor((lon[s]! - minLonE5) / cellLonE5)));
      const cy = Math.min(rows - 1, Math.max(0, Math.floor((lat[s]! - minLatE5) / cellLatE5)));
      const cell = cy * cols + cx;
      const inCell = [...ids.slice(offs[cell]!, offs[cell + 1]!)];
      expect(inCell).toContain(s);
    }
  });

  it("coverage bbox pads the stop bbox by the walk horizon", () => {
    const [w, s, e, n] = c.bbox;
    expect(w).toBeLessThan(80.0);
    expect(s).toBeLessThan(13.0);
    expect(e).toBeGreaterThan(80.2);
    expect(n).toBeGreaterThan(13.2);
    // pad ~3.68 km ~ 0.033 deg lat
    expect(13.0 - s).toBeGreaterThan(0.03);
    expect(13.0 - s).toBeLessThan(0.04);
  });

  it("compiles deterministically to byte-identical containers", () => {
    const a = encodeContainer(compileFeed(baseFeed(), cfg).sections, c.counts, "h");
    const b = encodeContainer(compileFeed(baseFeed(), cfg).sections, c.counts, "h");
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0);
  });
});

describe("guards", () => {
  it("fails on an expired calendar (stale-calendar)", () => {
    const files = baseFeed();
    files.set(
      "calendar.txt",
      [
        "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date",
        "WK,1,1,1,1,1,1,1,20200101,20201231",
      ].join("\n"),
    );
    expect(() => compileFeed(files, cfg)).toThrowError(BuildError);
    expect(() => compileFeed(files, cfg)).toThrow(/stale|expired/i);
  });

  it("fails when a weekday is anemic (<30% of max)", () => {
    const files = baseFeed();
    files.set(
      "calendar.txt",
      [
        "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date",
        "WK,1,0,0,0,0,0,0,20260101,20261231", // Monday-only service
        "SAT,0,0,0,0,0,1,0,20260101,20261231",
      ].join("\n"),
    );
    expect(() => compileFeed(files, cfg)).toThrow(/anemic|30%/i);
  });

  it("fails cleanly on a missing required file", () => {
    const files = baseFeed();
    files.delete("stop_times.txt");
    expect(() => compileFeed(files, cfg)).toThrow(/stop_times/);
  });
});

describe("calendar_dates exceptions", () => {
  it("removes and adds service on the representative dates", () => {
    const files = baseFeed();
    // remove WK on rep-Monday (2026-09-07); add SAT on that same Monday
    files.set(
      "calendar_dates.txt",
      ["service_id,date,exception_type", "WK,20260907,2", "SAT,20260907,1"].join("\n"),
    );
    const c = compileFeed(files, cfg);
    // Monday: WK trips (t1,t2) removed, SAT trip (t3) added
    expect(c.calendar.activeTripsPerDay[0]).toBe(1);
    expect(c.calendar.activeTripsPerDay[1]).toBe(2); // Tuesday unaffected
  });
});

describe("frequencies expansion", () => {
  it("clones the template trip per headway start", () => {
    const files = baseFeed();
    files.set(
      "frequencies.txt",
      ["trip_id,start_time,end_time,headway_secs", "t3,06:00:00,06:30:00,600"].join("\n"),
    );
    const c = compileFeed(files, cfg);
    // t3's single template connection replaced by 3 clones (06:00, 06:10, 06:20)
    expect(c.counts.connections).toBe(5 + 3); // t1:3, t2:1, t4:1, t3 clones:3
    const dep = named(c, "conn.depTimeSec") as Uint32Array;
    expect([...dep].filter((d) => d >= 21600 && d < 23400)).toHaveLength(3);
  });
});

describe("service exclusion", () => {
  it("drops excluded services and logs them", () => {
    const c = compileFeed(baseFeed(), testConfig({ excludeServiceIds: ["SAT"] }));
    expect(c.counts.trips).toBe(3);
    expect(c.skipped.excludedServices).toEqual(["SAT"]);
    expect(c.calendar.activeTripsPerDay).toEqual([2, 2, 2, 2, 2, 2, 2]);
  });
});

describe("review regressions (stage-8 adversarial findings)", () => {
  it("an EMPTY min_transfer_time cell is not an override of zero", () => {
    const files = baseFeed();
    files.set(
      "transfers.txt",
      ["from_stop_id,to_stop_id,transfer_type,min_transfer_time", "A,B,0,"].join("\n"),
    );
    const c = compileFeed(files, cfg);
    const off = named(c, "fp.offsets") as Uint32Array;
    const tgt = named(c, "fp.target") as Uint16Array;
    const sec = named(c, "fp.walkSec") as Uint16Array;
    let ab = -1;
    for (let e = off[0]!; e < off[1]!; e++) if (tgt[e] === 1) ab = sec[e]!;
    // generated crow-fly time (~195 s for ~200 m), NOT the 60 s floor
    expect(ab).toBeGreaterThan(150);
    expect(ab).toBeLessThan(250);
  });

  it("frequency clones anchor on the first SURVIVING row when the first row is blank", () => {
    const files = baseFeed();
    files.set(
      "trips.txt",
      ["route_id,service_id,trip_id", "r1,WK,t1", "r1,WK,t6"].join("\n"),
    );
    files.set(
      "stop_times.txt",
      [
        "trip_id,arrival_time,departure_time,stop_id,stop_sequence",
        "t1,08:00:00,08:00:00,A,1",
        "t1,08:04:00,08:04:00,B,2",
        "t6,,,A,1", // leading blank row: dropped
        "t6,10:00:00,10:00:00,B,2",
        "t6,10:05:00,10:05:00,C,3",
      ].join("\n"),
    );
    files.set(
      "frequencies.txt",
      ["trip_id,start_time,end_time,headway_secs", "t6,06:00:00,06:20:00,600"].join("\n"),
    );
    const c = compileFeed(files, cfg);
    const dep = named(c, "conn.depTimeSec") as Uint32Array;
    // clones must depart exactly at 06:00 and 06:10 (anchored to the surviving 10:00 row)
    const cloneDeps = [...dep].filter((d) => d < 28800).sort((a, b) => a - b);
    expect(cloneDeps).toEqual([21600, 22200]);
  });

  it("excluded-service stop_times rows are not miscounted as dangling refs", () => {
    const c = compileFeed(baseFeed(), testConfig({ excludeServiceIds: ["SAT"] }));
    expect(c.skipped.danglingRefs).toBe(1); // only the GHOST stop row
  });

  it("a malformed calendar date row cannot poison the stale-calendar guard", () => {
    const files = baseFeed();
    files.set(
      "calendar.txt",
      [
        "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date",
        "WK,1,1,1,1,1,1,1,20260101,20261231",
        "SAT,0,0,0,0,0,1,0,20260101,20261231",
        "BROKEN,1,1,1,1,1,1,1,not-a-date,20261231",
      ].join("\n"),
    );
    const c = compileFeed(files, cfg);
    // BROKEN row dropped; guard still evaluated against real bounds
    expect(c.feedCalendar.start).toBe("2026-01-01");
    expect(c.feedCalendar.end).toBe("2026-12-31");
  });

  it("clampedStops counter exists and is zero for in-frame stops", () => {
    const c = compileFeed(baseFeed(), cfg);
    expect(c.skipped.clampedStops).toBe(0);
  });
});

describe("transfers.txt", () => {
  it("overrides generated walk time and honors type-3 forbids", () => {
    const files = baseFeed();
    files.set(
      "transfers.txt",
      [
        "from_stop_id,to_stop_id,transfer_type,min_transfer_time",
        "A,B,2,240",
        "B,A,3,",
      ].join("\n"),
    );
    const c = compileFeed(files, cfg);
    const off = named(c, "fp.offsets") as Uint32Array;
    const tgt = named(c, "fp.target") as Uint16Array;
    const sec = named(c, "fp.walkSec") as Uint16Array;
    const edges = new Map<string, number>();
    for (let s = 0; s < c.counts.stops; s++) {
      for (let e = off[s]!; e < off[s + 1]!; e++) edges.set(`${s}:${tgt[e]}`, sec[e]!);
    }
    expect(edges.get("0:1")).toBe(240); // override
    expect(edges.has("1:0")).toBe(false); // forbidden
  });
});

describe("parent_station collapse", () => {
  it("maps child platforms onto their station", () => {
    const files = baseFeed();
    files.set(
      "stops.txt",
      [
        "stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station",
        "STN,Station,13.0000,80.0000,1,",
        "P1,Platform 1,13.0001,80.0000,0,STN",
        "P2,Platform 2,13.0002,80.0000,0,STN",
        "B,Beta,13.0018,80.0000,0,",
        "C,Gamma,13.0036,80.0000,0,",
        "D,Delta,13.0054,80.0000,0,",
        "Z,Zulu,13.2000,80.2000,0,",
        "A,Alpha,13.0000,80.0000,0,STN",
      ].join("\n"),
    );
    const c = compileFeed(files, cfg);
    // STN + B,C,D,Z canonical; P1/P2/A collapse onto STN
    expect(c.counts.stops).toBe(5);
    // trips referencing A still produce connections (via STN)
    expect(c.counts.connections).toBe(6);
  });
});
