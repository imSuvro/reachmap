/**
 * GTFS -> engine-ready artifact model (docs/contracts.md §1, ADR-005/006).
 * Pure function of (feed files, city config): no clock, no randomness, no
 * filesystem — determinism is a tested property.
 */
import type { CityConfig } from "../config/city";
import type { ArtifactCounts } from "../src/engine/types";
import type { NamedSection } from "../src/engine/container";
import {
  BuildError,
  hmsToSec,
  isoToInt,
  intToIso,
  readTable,
  requireTable,
  sanitizeFeedString,
  splitCsv,
  weekdayOf,
  addDays,
} from "./gtfs";

export interface CompiledFeed {
  sections: NamedSection[];
  counts: ArtifactCounts;
  skipped: {
    stopRows: number;
    tripRows: number;
    stopTimeRows: number;
    danglingRefs: number;
    negativeRides: number;
    clampedStops: number;
    excludedServices: string[];
  };
  calendar: { representativeDates: string[]; activeTripsPerDay: number[] };
  feedCalendar: { start: string; end: string };
  bbox: [number, number, number, number];
  stopNames: string[];
  horizonSec: number;
}

const M_PER_DEG_LAT = 111132;

interface Service {
  days: number[]; // Mon..Sun
  start: number; // yyyymmdd
  end: number;
  added: Set<number>; // calendar_dates exception_type 1
  removed: Set<number>; // exception_type 2
}

export function compileFeed(files: Map<string, string>, cfg: CityConfig): CompiledFeed {
  const skipped = {
    stopRows: 0,
    tripRows: 0,
    stopTimeRows: 0,
    danglingRefs: 0,
    negativeRides: 0,
    clampedStops: 0,
    excludedServices: [] as string[],
  };
  const horizonSec = Math.max(...cfg.bands);

  // ---------- stops (with optional parent_station collapse) ----------
  const stopsT = requireTable(files, "stops.txt");
  const sc = stopsT.col;
  interface RawStop {
    id: string;
    lat: number;
    lon: number;
    name: string;
    parent: string;
    locType: number;
  }
  const rawStops: RawStop[] = [];
  const rawById = new Map<string, number>();
  for (const line of stopsT.lines) {
    const f = splitCsv(line);
    if (f.length !== stopsT.width) {
      skipped.stopRows++;
      continue;
    }
    const lat = Number(f[sc.stop_lat!]);
    const lon = Number(f[sc.stop_lon!]);
    const id = f[sc.stop_id!]!;
    if (!id || !Number.isFinite(lat) || !Number.isFinite(lon) || rawById.has(id)) {
      skipped.stopRows++;
      continue;
    }
    rawById.set(id, rawStops.length);
    rawStops.push({
      id,
      lat,
      lon,
      name: sanitizeFeedString(sc.stop_name !== undefined ? (f[sc.stop_name] ?? "") : ""),
      parent: sc.parent_station !== undefined ? (f[sc.parent_station] ?? "") : "",
      locType: sc.location_type !== undefined ? Number(f[sc.location_type] || 0) : 0,
    });
  }
  // canonical stops: location_type 0/1 kept; a child with a resolvable parent
  // station collapses onto the parent (edge-case (c)); entrances etc. dropped
  const stopIdToIdx = new Map<string, number>();
  const stopLat: number[] = [];
  const stopLon: number[] = [];
  const stopNames: string[] = [];
  const canonicalIndexByRaw = new Map<number, number>();
  const addCanonical = (r: RawStop): number => {
    const idx = stopLat.length;
    stopLat.push(r.lat);
    stopLon.push(r.lon);
    stopNames.push(r.name);
    return idx;
  };
  // first pass: stations and independent stops become canonical
  for (let i = 0; i < rawStops.length; i++) {
    const r = rawStops[i]!;
    if (r.locType > 1) continue; // entrances/nodes never board
    const parentIdx = r.parent ? rawById.get(r.parent) : undefined;
    const parentIsStation =
      parentIdx !== undefined && rawStops[parentIdx]!.locType === 1;
    if (r.locType === 1 || !parentIsStation) {
      const c = addCanonical(r);
      canonicalIndexByRaw.set(i, c);
      stopIdToIdx.set(r.id, c);
    }
  }
  // second pass: children collapse onto their station's canonical index
  for (let i = 0; i < rawStops.length; i++) {
    const r = rawStops[i]!;
    if (r.locType !== 0 || !r.parent) continue;
    const parentIdx = rawById.get(r.parent);
    if (parentIdx === undefined || rawStops[parentIdx]!.locType !== 1) continue;
    const canonical = canonicalIndexByRaw.get(parentIdx);
    if (canonical !== undefined) stopIdToIdx.set(r.id, canonical);
  }
  const S = stopLat.length;
  if (S === 0) throw new BuildError("empty-feed", "no usable stops");
  if (S > 65535) throw new BuildError("overflow", `stop count ${S} exceeds u16`);

  // ---------- calendar ----------
  const services = new Map<string, Service>();
  const calT = readTable(files, "calendar.txt");
  if (calT) {
    const c = calT.col;
    for (const line of calT.lines) {
      const f = splitCsv(line);
      if (f.length !== calT.width) continue;
      const id = f[c.service_id!];
      if (!id) continue;
      const start = Number(f[c.start_date!]);
      const end = Number(f[c.end_date!]);
      // a NaN here would poison calStart/calEnd and silently disable the
      // stale-calendar guard — malformed date rows are dropped instead
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      services.set(id, {
        days: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map(
          (d) => Number(f[c[d]!] ?? 0),
        ),
        start,
        end,
        added: new Set(),
        removed: new Set(),
      });
    }
  }
  const cdT = readTable(files, "calendar_dates.txt");
  if (cdT) {
    const c = cdT.col;
    for (const line of cdT.lines) {
      const f = splitCsv(line);
      if (f.length !== cdT.width) continue;
      const id = f[c.service_id!]!;
      const date = Number(f[c.date!]);
      const type = Number(f[c.exception_type!]);
      if (!id || !Number.isFinite(date)) continue;
      let svc = services.get(id);
      if (!svc) {
        svc = { days: [0, 0, 0, 0, 0, 0, 0], start: date, end: date, added: new Set(), removed: new Set() };
        services.set(id, svc);
      }
      svc.start = Math.min(svc.start, date);
      svc.end = Math.max(svc.end, date);
      if (type === 1) svc.added.add(date);
      else if (type === 2) svc.removed.add(date);
    }
  }
  if (services.size === 0) throw new BuildError("missing-file", "no calendar.txt or calendar_dates.txt services");

  // representative date per weekday: first occurrence on/after referenceDate
  const ref = isoToInt(cfg.referenceDate);
  const repDates: number[] = new Array(7).fill(0);
  for (let k = 0; k < 7; k++) {
    const d = addDays(ref, k);
    repDates[weekdayOf(d)] = d;
  }
  const calStart = Math.min(...[...services.values()].map((s) => s.start));
  const calEnd = Math.max(...[...services.values()].map((s) => s.end));
  for (const d of repDates) {
    if (d < calStart || d > calEnd) {
      throw new BuildError(
        "stale-calendar",
        `representative date ${intToIso(d)} outside feed validity ${intToIso(calStart)}..${intToIso(calEnd)} — feed expired or referenceDate wrong`,
      );
    }
  }
  const svcActiveOn = (svc: Service, date: number): boolean => {
    if (svc.removed.has(date)) return false;
    if (svc.added.has(date)) return true;
    return svc.days[weekdayOf(date)] === 1 && svc.start <= date && date <= svc.end;
  };

  // ---------- trips ----------
  const tripsT = requireTable(files, "trips.txt");
  const tc = tripsT.col;
  const excluded = new Set(cfg.excludeServiceIds);
  const excludedSeen = new Set<string>();
  const excludedTripIds = new Set<string>();
  const tripSvc: Service[] = [];
  const tripKeyToRef = new Map<string, number>();
  for (const line of tripsT.lines) {
    const f = splitCsv(line);
    if (f.length !== tripsT.width) {
      skipped.tripRows++;
      continue;
    }
    const id = f[tc.trip_id!]!;
    const svcId = f[tc.service_id!]!;
    if (!id || tripKeyToRef.has(id)) {
      skipped.tripRows++;
      continue;
    }
    if (excluded.has(svcId)) {
      excludedSeen.add(svcId);
      excludedTripIds.add(id);
      continue;
    }
    const svc = services.get(svcId);
    if (!svc) {
      skipped.tripRows++;
      continue;
    }
    tripKeyToRef.set(id, tripSvc.length);
    tripSvc.push(svc);
  }
  skipped.excludedServices = [...excludedSeen].map(sanitizeFeedString).sort();

  // ---------- stop_times ----------
  const stT = requireTable(files, "stop_times.txt");
  const stc = stT.col;
  const nRows = stT.lines.length;
  const rTrip = new Int32Array(nRows);
  const rSeq = new Int32Array(nRows);
  const rArr = new Float64Array(nRows); // -1 = blank (interpolated later)
  const rDep = new Float64Array(nRows);
  const rStop = new Int32Array(nRows);
  let used = 0;
  for (const line of stT.lines) {
    const f = splitCsv(line);
    if (f.length !== stT.width) {
      skipped.stopTimeRows++;
      continue;
    }
    const tripId = f[stc.trip_id!]!;
    const trip = tripKeyToRef.get(tripId);
    const stop = stopIdToIdx.get(f[stc.stop_id!]!);
    if (trip === undefined || stop === undefined) {
      // rows of a deliberately excluded trip are not "dangling" — they are a
      // consequence of the exclusion, not a feed defect
      if (trip === undefined && excludedTripIds.has(tripId)) continue;
      skipped.danglingRefs++;
      continue;
    }
    const seq = Number(f[stc.stop_sequence!]);
    if (!Number.isFinite(seq)) {
      skipped.stopTimeRows++;
      continue;
    }
    rTrip[used] = trip;
    rSeq[used] = seq;
    rArr[used] = hmsToSec(f[stc.arrival_time!]);
    rDep[used] = hmsToSec(f[stc.departure_time!]);
    rStop[used] = stop;
    used++;
  }
  if (used === 0) throw new BuildError("empty-feed", "no usable stop_times rows");

  // sort rows by (trip, seq) — stable, deterministic
  const order = new Uint32Array(used);
  for (let i = 0; i < used; i++) order[i] = i;
  (order as unknown as { sort(cmp: (a: number, b: number) => number): void }).sort(
    (a, b) => rTrip[a]! - rTrip[b]! || rSeq[a]! - rSeq[b]!,
  );

  // per-trip row ranges
  interface TripRows {
    ref: number;
    from: number; // index into order
    to: number; // exclusive
  }
  const tripRows: TripRows[] = [];
  for (let i = 0; i < used; ) {
    let j = i;
    while (j < used && rTrip[order[j]!] === rTrip[order[i]!]) j++;
    tripRows.push({ ref: rTrip[order[i]!]!, from: i, to: j });
    i = j;
  }

  // blank-time interpolation (edge-case (a)): linear by row position between
  // known times inside a trip; leading/trailing blanks drop the row
  for (const t of tripRows) {
    for (let i = t.from; i < t.to; i++) {
      const ri = order[i]!;
      if (rArr[ri]! >= 0 && rDep[ri]! < 0) rDep[ri] = rArr[ri]!;
      if (rDep[ri]! >= 0 && rArr[ri]! < 0) rArr[ri] = rDep[ri]!;
    }
    let i = t.from;
    while (i < t.to) {
      const ri = order[i]!;
      if (rArr[ri]! >= 0) {
        i++;
        continue;
      }
      // blank run [i, j)
      let j = i;
      while (j < t.to && rArr[order[j]!]! < 0) j++;
      const prev = i > t.from ? order[i - 1]! : -1;
      const next = j < t.to ? order[j]! : -1;
      if (prev >= 0 && next >= 0) {
        const t0 = rDep[prev]!;
        const t1 = rArr[next]!;
        const span = j - i + 1;
        for (let k = i; k < j; k++) {
          const v = t0 + ((t1 - t0) * (k - i + 1)) / span;
          rArr[order[k]!] = v;
          rDep[order[k]!] = v;
        }
      } else {
        for (let k = i; k < j; k++) {
          rArr[order[k]!] = -2; // marked dropped
          skipped.stopTimeRows++;
        }
      }
      i = j;
    }
  }

  // frequencies.txt expansion (edge-case (f)): template trips cloned per start
  interface Freq {
    ref: number;
    startSec: number;
    endSec: number;
    headway: number;
  }
  const freqs: Freq[] = [];
  const freqT = readTable(files, "frequencies.txt");
  if (freqT) {
    const c = freqT.col;
    for (const line of freqT.lines) {
      const f = splitCsv(line);
      if (f.length !== freqT.width) continue;
      const ref = tripKeyToRef.get(f[c.trip_id!]!);
      const startSec = hmsToSec(f[c.start_time!]);
      const endSec = hmsToSec(f[c.end_time!]);
      const headway = Number(f[c.headway_secs!]);
      if (ref === undefined || startSec < 0 || endSec < 0 || !(headway > 0)) continue;
      freqs.push({ ref, startSec, endSec, headway });
    }
  }
  const freqByRef = new Map<number, Freq[]>();
  for (const fq of freqs) {
    let a = freqByRef.get(fq.ref);
    if (!a) freqByRef.set(fq.ref, (a = []));
    a.push(fq);
  }

  // ---------- connections (pre-renumbering) ----------
  interface PreConn {
    dep: number;
    ride: number;
    from: number;
    to: number;
    ref: number; // pre-renumber trip ref (frequency clones get fresh refs)
    seq: number;
  }
  const pre: PreConn[] = [];
  let nextRef = tripSvc.length; // frequency clones appended after real trips
  const refSvc: Service[] = tripSvc.slice();
  const emitTrip = (t: TripRows, shift: number, ref: number) => {
    for (let i = t.from; i + 1 < t.to; i++) {
      const a = order[i]!;
      const b = order[i + 1]!;
      if (rArr[a]! < -1 || rArr[b]! < -1) continue; // dropped blank rows
      const dep = rDep[a]! + shift;
      const arr = rArr[b]! + shift;
      if (dep < 0) throw new BuildError("overflow", `negative departure ${dep} after shift`);
      if (arr < dep) {
        skipped.negativeRides++;
        continue;
      }
      const ride = Math.round(arr - dep);
      if (ride > 65535) throw new BuildError("overflow", `rideSec ${ride} exceeds u16`);
      pre.push({ dep: Math.round(dep), ride, from: rStop[a]!, to: rStop[b]!, ref, seq: rSeq[a]! });
    }
  };
  /** anchor for frequency shifts: the template's first SURVIVING row (a
   *  leading blank row keeps rDep = -1 and would poison every clone) */
  const anchorDep = (t: TripRows): number | null => {
    for (let i = t.from; i < t.to; i++) {
      const ri = order[i]!;
      if (rArr[ri]! >= 0 && rDep[ri]! >= 0) return rDep[ri]!;
    }
    return null;
  };
  for (const t of tripRows) {
    const fqs = freqByRef.get(t.ref);
    if (fqs && fqs.length) {
      const base = anchorDep(t);
      if (base === null) continue; // template fully dropped
      for (const fq of fqs) {
        for (let start = fq.startSec; start < fq.endSec; start += fq.headway) {
          const ref = nextRef++;
          refSvc.push(tripSvc[t.ref]!);
          emitTrip(t, start - base, ref);
        }
      }
    } else {
      emitTrip(t, 0, t.ref);
    }
  }
  if (pre.length === 0) throw new BuildError("empty-feed", "no usable connections");

  // ---------- trip renumbering by first departure ----------
  const firstDep = new Map<number, number>();
  for (const c of pre) {
    const cur = firstDep.get(c.ref);
    if (cur === undefined || c.dep < cur) firstDep.set(c.ref, c.dep);
  }
  const usedRefs = [...firstDep.keys()].sort(
    (a, b) => firstDep.get(a)! - firstDep.get(b)! || a - b,
  );
  const refToTripIdx = new Map<number, number>();
  usedRefs.forEach((ref, i) => refToTripIdx.set(ref, i));
  const T = usedRefs.length;

  // per-weekday active-trip bitsets over the RENUMBERED domain (contract §1)
  const bytesPerDay = Math.ceil(T / 8);
  const tripBits = new Uint8Array(7 * bytesPerDay);
  const activeTripsPerDay = new Array<number>(7).fill(0);
  for (let wd = 0; wd < 7; wd++) {
    const date = repDates[wd]!;
    for (let t = 0; t < T; t++) {
      if (svcActiveOn(refSvc[usedRefs[t]!]!, date)) {
        tripBits[wd * bytesPerDay + (t >> 3)]! |= 1 << (t & 7);
        activeTripsPerDay[wd]!++;
      }
    }
  }
  const maxDay = Math.max(...activeTripsPerDay);
  const minDay = Math.min(...activeTripsPerDay);
  if (maxDay === 0) throw new BuildError("stale-calendar", "no trips active on any weekday");
  if (minDay < 0.3 * maxDay) {
    throw new BuildError(
      "anemic-weekday",
      `weekday active-trip counts ${activeTripsPerDay.join(",")}: min < 30% of max — calendar likely broken`,
    );
  }

  // ---------- sort connections by (depTime, tripIdx, seq) ----------
  pre.sort((a, b) => {
    const d = a.dep - b.dep;
    if (d) return d;
    const t = refToTripIdx.get(a.ref)! - refToTripIdx.get(b.ref)!;
    if (t) return t;
    return a.seq - b.seq;
  });
  const C = pre.length;
  const depTimeSec = new Uint32Array(C);
  const rideSec = new Uint16Array(C);
  const depStop = new Uint16Array(C);
  const arrStop = new Uint16Array(C);
  const tripIdx = new Uint32Array(C);
  for (let i = 0; i < C; i++) {
    const c = pre[i]!;
    depTimeSec[i] = c.dep;
    rideSec[i] = c.ride;
    depStop[i] = c.from;
    arrStop[i] = c.to;
    tripIdx[i] = refToTripIdx.get(c.ref)!;
  }

  // ---------- footpaths (generated; transfers.txt overrides) ----------
  const lat0 = [...stopLat].sort((a, b) => a - b)[S >> 1]!;
  const mPerDegLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const effMps = cfg.walking.speedMps / cfg.walking.detour;
  const R = cfg.walking.transferRadiusM;
  const cellSize = R;
  const buckets = new Map<number, number[]>();
  const bx = (i: number) => Math.floor((stopLon[i]! * mPerDegLon) / cellSize);
  const by = (i: number) => Math.floor((stopLat[i]! * M_PER_DEG_LAT) / cellSize);
  for (let i = 0; i < S; i++) {
    const k = bx(i) * 100003 + by(i);
    let a = buckets.get(k);
    if (!a) buckets.set(k, (a = []));
    a.push(i);
  }
  // transfers.txt overrides, keyed "from:to" on canonical indices
  const overrides = new Map<string, number>();
  const forbidden = new Set<string>();
  const trT = readTable(files, "transfers.txt");
  if (trT) {
    const c = trT.col;
    for (const line of trT.lines) {
      const f = splitCsv(line);
      if (f.length !== trT.width) continue;
      const a = stopIdToIdx.get(f[c.from_stop_id!]!);
      const b = stopIdToIdx.get(f[c.to_stop_id!]!);
      if (a === undefined || b === undefined) continue;
      const type = Number(f[c.transfer_type!] || 0);
      if (type === 3) {
        forbidden.add(`${a}:${b}`);
        continue;
      }
      // an empty cell is NOT an override of 0 — Number("") === 0 would turn
      // every bare transfers.txt row into a 60 s teleport
      const rawMt = c.min_transfer_time !== undefined ? (f[c.min_transfer_time] ?? "").trim() : "";
      const mt = rawMt === "" ? NaN : Number(rawMt);
      if (Number.isFinite(mt) && mt >= 0) overrides.set(`${a}:${b}`, Math.round(mt));
    }
  }
  const fpTargets: number[][] = Array.from({ length: S }, () => []);
  const fpSecs: number[][] = Array.from({ length: S }, () => []);
  let F = 0;
  for (let i = 0; i < S; i++) {
    const cx = bx(i);
    const cy = by(i);
    const xi = stopLon[i]! * mPerDegLon;
    const yi = stopLat[i]! * M_PER_DEG_LAT;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const cellStops = buckets.get((cx + dx) * 100003 + (cy + dy));
        if (!cellStops) continue;
        for (const j of cellStops) {
          if (j === i) continue;
          const d = Math.hypot(xi - stopLon[j]! * mPerDegLon, yi - stopLat[j]! * M_PER_DEG_LAT);
          if (d > R) continue;
          if (forbidden.has(`${i}:${j}`)) continue;
          const key = `${i}:${j}`;
          const walk = overrides.has(key)
            ? Math.max(cfg.walking.minTransferSec, overrides.get(key)!)
            : Math.max(cfg.walking.minTransferSec, Math.round(d / effMps));
          if (walk > 65535) continue;
          fpTargets[i]!.push(j);
          fpSecs[i]!.push(walk);
          F++;
        }
      }
    }
    // deterministic neighbor order
    const idx = fpTargets[i]!.map((t, k) => k).sort((a, b) => fpTargets[i]![a]! - fpTargets[i]![b]!);
    fpTargets[i] = idx.map((k) => fpTargets[i]![k]!);
    fpSecs[i] = idx.map((k) => fpSecs[i]![k]!);
  }
  const fpOffsets = new Uint32Array(S + 1);
  const fpTarget = new Uint16Array(F);
  const fpWalkSec = new Uint16Array(F);
  {
    let o = 0;
    for (let i = 0; i < S; i++) {
      fpOffsets[i] = o;
      for (let k = 0; k < fpTargets[i]!.length; k++) {
        fpTarget[o] = fpTargets[i]![k]!;
        fpWalkSec[o] = fpSecs[i]![k]!;
        o++;
      }
    }
    fpOffsets[S] = o;
  }

  // ---------- spatial bucket index (contract cell formula) ----------
  const cellLatE5 = Math.round((cfg.indexCellM / M_PER_DEG_LAT) * 1e5);
  const cellLonE5 = Math.round((cfg.indexCellM / mPerDegLon) * 1e5);
  const latE5 = stopLat.map((v) => Math.round(v * 1e5));
  const lonE5 = stopLon.map((v) => Math.round(v * 1e5));
  const minLatE5 = Math.min(...latE5);
  const minLonE5 = Math.min(...lonE5);
  const cols = Math.floor((Math.max(...lonE5) - minLonE5) / cellLonE5) + 1;
  const rows = Math.floor((Math.max(...latE5) - minLatE5) / cellLatE5) + 1;
  const NC = cols * rows;
  const stopCell = new Uint32Array(S);
  for (let i = 0; i < S; i++) {
    const rawCx = Math.floor((lonE5[i]! - minLonE5) / cellLonE5);
    const rawCy = Math.floor((latE5[i]! - minLatE5) / cellLatE5);
    const cxi = Math.min(cols - 1, Math.max(0, rawCx));
    const cyi = Math.min(rows - 1, Math.max(0, rawCy));
    if (cxi !== rawCx || cyi !== rawCy) skipped.clampedStops++;
    stopCell[i] = cyi * cols + cxi;
  }
  const cellCount = new Uint32Array(NC);
  for (let i = 0; i < S; i++) cellCount[stopCell[i]!]!++;
  const cellOffsets = new Uint32Array(NC + 1);
  for (let i = 0; i < NC; i++) cellOffsets[i + 1] = cellOffsets[i]! + cellCount[i]!;
  const idxStopIds = new Uint16Array(S);
  {
    const cursor = cellOffsets.slice(0, NC);
    for (let i = 0; i < S; i++) {
      const c = stopCell[i]!;
      idxStopIds[cursor[c]!] = i;
      cursor[c]!++;
    }
  }
  const idxMeta = new Int32Array([minLonE5, minLatE5, cellLonE5, cellLatE5, cols, rows]);

  // ---------- coverage bbox: stop bbox + walk-horizon pad ----------
  const padM = horizonSec * effMps;
  const padLat = padM / M_PER_DEG_LAT;
  const padLon = padM / mPerDegLon;
  const r5 = (v: number) => Math.round(v * 1e5) / 1e5;
  const bbox: [number, number, number, number] = [
    r5(Math.min(...stopLon) - padLon),
    r5(Math.min(...stopLat) - padLat),
    r5(Math.max(...stopLon) + padLon),
    r5(Math.max(...stopLat) + padLat),
  ];

  const counts: ArtifactCounts = { stops: S, trips: T, connections: C, footpaths: F };
  const sections: NamedSection[] = [
    { name: "conn.depTimeSec", data: depTimeSec },
    { name: "conn.rideSec", data: rideSec },
    { name: "conn.depStop", data: depStop },
    { name: "conn.arrStop", data: arrStop },
    { name: "conn.tripIdx", data: tripIdx },
    { name: "day.tripBits", data: tripBits },
    { name: "stops.lat", data: new Int32Array(latE5) },
    { name: "stops.lon", data: new Int32Array(lonE5) },
    { name: "fp.offsets", data: fpOffsets },
    { name: "fp.target", data: fpTarget },
    { name: "fp.walkSec", data: fpWalkSec },
    { name: "idx.cellOffsets", data: cellOffsets },
    { name: "idx.stopIds", data: idxStopIds },
    { name: "idx.meta", data: idxMeta },
  ];

  return {
    sections,
    counts,
    skipped,
    calendar: {
      representativeDates: repDates.map(intToIso),
      activeTripsPerDay,
    },
    feedCalendar: { start: intToIso(calStart), end: intToIso(calEnd) },
    bbox,
    stopNames,
    horizonSec,
  };
}
