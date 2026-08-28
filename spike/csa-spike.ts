/**
 * Stage-3 feasibility spike (THROWAWAY): one-to-all Connection Scan on the
 * real Chennai unified GTFS feed, with footpath relaxation and after-midnight
 * handling, measured against pre-committed pass gates:
 *
 *   - p95 query < 250 ms in Node (hard fail at 1 s)
 *   - parse + build < 120 s, RSS < 1.5 GB
 *   - 0.5-5 M connections, >= 300 stops reached in 60 min from a central origin
 *   - oracles: arrival >= departure; 15c30c45c60 nesting; timetable replay
 *
 * Run: pnpm spike   (feed pre-extracted to spike/.cache/chennai/)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FEED_DIR = join(import.meta.dirname, ".cache", "chennai");
const WALK_SPEED_MPS = 1.33; // 4.8 km/h
const DETOUR = 1.3;
const EFF_MPS = WALK_SPEED_MPS / DETOUR; // effective crow-fly walking speed
const TRANSFER_RADIUS_M = 300;
const ORIGIN_RADIUS_M = 800;
const MIN_TRANSFER_SEC = 60;
const HORIZON_SEC = 3600;
const BANDS = [900, 1800, 2700, 3600];
// "today" anchor for calendar-window resolution
const TODAY = { y: 2026, m: 8, d: 29 };

const t0 = performance.now();
const mark = (label: string) =>
  console.log(`[${((performance.now() - t0) / 1000).toFixed(1)}s] ${label}`);

// ---------- CSV ----------
/** Minimal CSV split: fast path on plain commas, slow path when quotes appear. */
function splitCsv(line: string): string[] {
  if (!line.includes('"')) return line.split(",");
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function readTable(name: string): { header: string[]; lines: string[] } {
  let text = readFileSync(join(FEED_DIR, name), "utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = text.split(/\r?\n/);
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  const header = splitCsv(lines[0]).map((h) => h.trim());
  return { header, lines };
}

function hmsToSec(s: string): number {
  // Returns -1 for blank/malformed. Values > 86400 are preserved (GTFS >24:00).
  if (!s) return -1;
  const p = s.split(":");
  if (p.length !== 3) return -1;
  const h = +p[0], m = +p[1], sec = +p[2];
  if (!Number.isFinite(h) || !Number.isFinite(m) || !Number.isFinite(sec)) return -1;
  return h * 3600 + m * 60 + sec;
}

// ---------- stops ----------
mark("parsing stops.txt");
const stopsT = readTable("stops.txt");
const sh = Object.fromEntries(stopsT.header.map((h, i) => [h, i]));
const stopIdToIdx = new Map<string, number>();
const stopLat: number[] = [];
const stopLon: number[] = [];
let badStopRows = 0;
for (let i = 1; i < stopsT.lines.length; i++) {
  const f = splitCsv(stopsT.lines[i]);
  if (f.length !== stopsT.header.length) { badStopRows++; continue; }
  const lat = +f[sh.stop_lat], lon = +f[sh.stop_lon];
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) { badStopRows++; continue; }
  const id = f[sh.stop_id];
  if (stopIdToIdx.has(id)) { badStopRows++; continue; }
  stopIdToIdx.set(id, stopLat.length);
  stopLat.push(lat);
  stopLon.push(lon);
}
const nStops = stopLat.length;
console.log(`  stops: ${nStops} (skipped ${badStopRows})`);

// local meter frame around the median latitude
const lat0 = stopLat.slice().sort((a, b) => a - b)[nStops >> 1];
const M_PER_DEG_LAT = 111132;
const M_PER_DEG_LON = 111320 * Math.cos((lat0 * Math.PI) / 180);
const sx = new Float64Array(nStops);
const sy = new Float64Array(nStops);
for (let i = 0; i < nStops; i++) {
  sx[i] = stopLon[i] * M_PER_DEG_LON;
  sy[i] = stopLat[i] * M_PER_DEG_LAT;
}

// ---------- calendar ----------
mark("parsing calendar.txt");
const calT = readTable("calendar.txt");
const ch = Object.fromEntries(calT.header.map((h, i) => [h, i]));
type Svc = { id: string; days: number[]; start: number; end: number };
const services: Svc[] = [];
const svcIdToIdx = new Map<string, number>();
for (let i = 1; i < calT.lines.length; i++) {
  const f = splitCsv(calT.lines[i]);
  if (f.length !== calT.header.length) continue;
  const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
    .map((d) => +f[ch[d]]);
  svcIdToIdx.set(f[ch.service_id], services.length);
  services.push({ id: f[ch.service_id], days, start: +f[ch.start_date], end: +f[ch.end_date] });
}
console.log(`  services: ${services.map((s) => JSON.stringify(s.id)).join(", ")}`);

/** Representative date (yyyymmdd int) for each weekday: next occurrence from TODAY. */
function repDates(): number[] {
  const base = new Date(Date.UTC(TODAY.y, TODAY.m - 1, TODAY.d));
  const out: number[] = new Array(7);
  for (let k = 0; k < 7; k++) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + k);
    const wd = (d.getUTCDay() + 6) % 7; // 0=Mon .. 6=Sun
    out[wd] = d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  }
  return out;
}
const REP = repDates();
const svcActiveOnWeekday = (s: Svc, wd: number) =>
  s.days[wd] === 1 && s.start <= REP[wd] && REP[wd] <= s.end;

// ---------- trips ----------
mark("parsing trips.txt");
const tripsT = readTable("trips.txt");
const th = Object.fromEntries(tripsT.header.map((h, i) => [h, i]));
const tripIdToIdx = new Map<string, number>();
const tripSvc: number[] = [];
let badTripRows = 0;
for (let i = 1; i < tripsT.lines.length; i++) {
  const f = splitCsv(tripsT.lines[i]);
  if (f.length !== tripsT.header.length) { badTripRows++; continue; }
  const svc = svcIdToIdx.get(f[th.service_id]);
  if (svc === undefined) { badTripRows++; continue; }
  tripIdToIdx.set(f[th.trip_id], tripSvc.length);
  tripSvc.push(svc);
}
const nTrips = tripSvc.length;
console.log(`  trips: ${nTrips} (skipped ${badTripRows})`);
{
  const perSvc = new Array(services.length).fill(0);
  for (const s of tripSvc) perSvc[s]++;
  for (let s = 0; s < services.length; s++)
    console.log(`    service ${JSON.stringify(services[s].id)}: ${perSvc[s]} trips`);
}

// ---------- stop_times -> connections ----------
mark("parsing stop_times.txt");
const stT = readTable("stop_times.txt");
const sth = Object.fromEntries(stT.header.map((h, i) => [h, i]));
const nRows = stT.lines.length - 1;
const rTrip = new Int32Array(nRows);
const rSeq = new Int32Array(nRows);
const rArr = new Int32Array(nRows);
const rDep = new Int32Array(nRows);
const rStop = new Int32Array(nRows);
let nUsed = 0, badStRows = 0, blankTimes = 0, danglingRefs = 0;
for (let i = 1; i < stT.lines.length; i++) {
  const f = splitCsv(stT.lines[i]);
  if (f.length !== stT.header.length) { badStRows++; continue; }
  const trip = tripIdToIdx.get(f[sth.trip_id]);
  const stop = stopIdToIdx.get(f[sth.stop_id]);
  if (trip === undefined || stop === undefined) { danglingRefs++; continue; }
  const arr = hmsToSec(f[sth.arrival_time]);
  const dep = hmsToSec(f[sth.departure_time]);
  if (arr < 0 || dep < 0) { blankTimes++; continue; }
  rTrip[nUsed] = trip;
  rSeq[nUsed] = +f[sth.stop_sequence];
  rArr[nUsed] = arr;
  rDep[nUsed] = dep;
  rStop[nUsed] = stop;
  nUsed++;
}
console.log(
  `  stop_times: ${nUsed} used / ${nRows} rows ` +
  `(malformed ${badStRows}, blank-time ${blankTimes}, dangling ${danglingRefs})`
);

mark("sorting stop_times by (trip, seq)");
const order = new Uint32Array(nUsed);
for (let i = 0; i < nUsed; i++) order[i] = i;
// typed-array sort with comparator
(order as unknown as number[]).sort?.call(order, (a: number, b: number) =>
  rTrip[a] - rTrip[b] || rSeq[a] - rSeq[b]
);

mark("building connections");
let cap = nUsed;
let cDep = new Uint32Array(cap);
let cRide = new Uint32Array(cap);
let cFrom = new Uint16Array(cap);
let cTo = new Uint16Array(cap);
let cTrip = new Uint32Array(cap);
let nConn = 0, negRide = 0, over24 = 0, longRide = 0;
for (let k = 0; k + 1 < nUsed; k++) {
  const a = order[k], b = order[k + 1];
  if (rTrip[a] !== rTrip[b]) continue;
  const dep = rDep[a], arr = rArr[b];
  if (arr < dep) { negRide++; continue; }
  if (dep >= 86400) over24++;
  if (arr - dep > 65535) longRide++;
  cDep[nConn] = dep;
  cRide[nConn] = arr - dep;
  cFrom[nConn] = rStop[a];
  cTo[nConn] = rStop[b];
  cTrip[nConn] = rTrip[a];
  nConn++;
}
console.log(
  `  connections: ${nConn} (negative-ride skipped ${negRide}, dep>24:00 ${over24}, ride>65535s ${longRide})`
);

mark("sorting connections by depTime");
{
  const ord = new Uint32Array(nConn);
  for (let i = 0; i < nConn; i++) ord[i] = i;
  (ord as unknown as number[]).sort?.call(ord, (a: number, b: number) =>
    cDep[a] - cDep[b] || cTrip[a] - cTrip[b]
  );
  const p = (src: any, Ctor: any) => {
    const out = new Ctor(nConn);
    for (let i = 0; i < nConn; i++) out[i] = src[ord[i]];
    return out;
  };
  cDep = p(cDep, Uint32Array);
  cRide = p(cRide, Uint32Array);
  cFrom = p(cFrom, Uint16Array);
  cTo = p(cTo, Uint16Array);
  cTrip = p(cTrip, Uint32Array);
}

// ---------- footpaths (direct pairs <= 300 m, CSR) ----------
mark("building footpaths");
const CELL = TRANSFER_RADIUS_M;
const grid = new Map<number, number[]>();
const cellKey = (x: number, y: number) =>
  (Math.floor(x / CELL) & 0xffff) * 65536 + (Math.floor(y / CELL) & 0xffff);
for (let i = 0; i < nStops; i++) {
  const k = cellKey(sx[i], sy[i]);
  let arr = grid.get(k);
  if (!arr) grid.set(k, (arr = []));
  arr.push(i);
}
const fpTarget: number[][] = Array.from({ length: nStops }, () => []);
const fpSec: number[][] = Array.from({ length: nStops }, () => []);
let fpEdges = 0, maxDeg = 0;
for (let i = 0; i < nStops; i++) {
  const cx = Math.floor(sx[i] / CELL), cy = Math.floor(sy[i] / CELL);
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++) {
      const cell = grid.get(((cx + dx) & 0xffff) * 65536 + ((cy + dy) & 0xffff));
      if (!cell) continue;
      for (const j of cell) {
        if (j === i) continue;
        const d = Math.hypot(sx[i] - sx[j], sy[i] - sy[j]);
        if (d <= TRANSFER_RADIUS_M) {
          fpTarget[i].push(j);
          fpSec[i].push(Math.max(MIN_TRANSFER_SEC, Math.round(d / EFF_MPS)));
          fpEdges++;
        }
      }
    }
  if (fpTarget[i].length > maxDeg) maxDeg = fpTarget[i].length;
}
console.log(`  footpath edges: ${fpEdges} (max degree ${maxDeg})`);

// per-weekday active-trip bitmaps
const activeByDay: Uint8Array[] = [];
for (let wd = 0; wd < 7; wd++) {
  const act = new Uint8Array(nTrips);
  for (let t = 0; t < nTrips; t++)
    if (svcActiveOnWeekday(services[tripSvc[t]], wd)) act[t] = 1;
  activeByDay.push(act);
}
console.log(
  `  active trips by weekday: ${activeByDay.map((a) => a.reduce((s, v) => s + v, 0)).join(", ")}`
);

const buildDone = performance.now();
mark(`BUILD DONE in ${((buildDone - t0) / 1000).toFixed(1)}s`);

// ---------- CSA ----------
const INF = Infinity;
const arrival = new Float64Array(nStops);
const tripFlag = new Uint8Array(nTrips);
const tripFlag2 = new Uint8Array(nTrips);

function lowerBound(target: number): number {
  let lo = 0, hi = nConn;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cDep[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function seedStops(olat: number, olon: number, T: number) {
  const ox = olon * M_PER_DEG_LON, oy = olat * M_PER_DEG_LAT;
  const r = Math.ceil(ORIGIN_RADIUS_M / CELL);
  const cx = Math.floor(ox / CELL), cy = Math.floor(oy / CELL);
  let seeded = 0;
  for (let dx = -r; dx <= r; dx++)
    for (let dy = -r; dy <= r; dy++) {
      const cell = grid.get(((cx + dx) & 0xffff) * 65536 + ((cy + dy) & 0xffff));
      if (!cell) continue;
      for (const j of cell) {
        const d = Math.hypot(ox - sx[j], oy - sy[j]);
        if (d <= ORIGIN_RADIUS_M) {
          const t = T + d / EFF_MPS;
          if (t < arrival[j]) { arrival[j] = t; seeded++; }
        }
      }
    }
  return seeded;
}

function relaxFootpaths(stop: number, at: number, H: number) {
  const tg = fpTarget[stop], ts = fpSec[stop];
  for (let e = 0; e < tg.length; e++) {
    const na = at + ts[e];
    if (na <= H && na < arrival[tg[e]]) arrival[tg[e]] = na;
  }
}

function scanWindow(T: number, H: number, offset: number, act: Uint8Array, flags: Uint8Array) {
  // connections with depTime in [T+offset, H+offset), interpreted at depTime-offset
  let i = lowerBound(T + offset);
  const end = H + offset;
  for (; i < nConn && cDep[i] < end; i++) {
    const t = cTrip[i];
    if (!act[t]) continue;
    const dep = cDep[i] - offset;
    if (flags[t] || arrival[cFrom[i]] <= dep) {
      flags[t] = 1;
      const a = dep + cRide[i];
      if (a <= H && a < arrival[cTo[i]]) {
        arrival[cTo[i]] = a;
        relaxFootpaths(cTo[i], a, H);
      }
    }
  }
}

function query(olat: number, olon: number, weekday: number, T: number) {
  arrival.fill(INF);
  tripFlag.fill(0);
  tripFlag2.fill(0);
  seedStops(olat, olon, T);
  const H = T + HORIZON_SEC;
  scanWindow(T, H, 0, activeByDay[weekday], tripFlag);
  // yesterday's >24:00 service reaching past midnight into today
  scanWindow(T, H, 86400, activeByDay[(weekday + 6) % 7], tripFlag2);
  return arrival;
}

// ---------- measurements ----------
mark("running queries");
const CENTRAL = { lat: 13.0827, lon: 80.2757 }; // Chennai Central
// 20 central-ish origins: the 20 stops nearest Chennai Central
const byDist = Array.from({ length: nStops }, (_, i) => i).sort(
  (a, b) =>
    Math.hypot(sx[a] - CENTRAL.lon * M_PER_DEG_LON, sy[a] - CENTRAL.lat * M_PER_DEG_LAT) -
    Math.hypot(sx[b] - CENTRAL.lon * M_PER_DEG_LON, sy[b] - CENTRAL.lat * M_PER_DEG_LAT)
);
type Q = { lat: number; lon: number; wd: number; T: number; tag: string };
const queries: Q[] = [];
for (let k = 0; k < 20; k++) {
  const s = byDist[k];
  queries.push({ lat: stopLat[s], lon: stopLon[s], wd: 1, T: 8.5 * 3600, tag: "central" });
}
// 80 random origins in the stop bbox, deterministic LCG
let rng = 42;
const rand = () => (rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const latMin = Math.min(...stopLat), latMax = Math.max(...stopLat);
const lonMin = Math.min(...stopLon), lonMax = Math.max(...stopLon);
console.log(`  stop bbox: lat ${latMin.toFixed(4)}..${latMax.toFixed(4)}, lon ${lonMin.toFixed(4)}..${lonMax.toFixed(4)}`);
for (let k = 0; k < 80; k++) {
  const peakAM = rand() < 0.5;
  const T = peakAM
    ? 7 * 3600 + Math.floor(rand() * 4 * 3600)
    : 17 * 3600 + Math.floor(rand() * 4 * 3600);
  queries.push({
    lat: latMin + rand() * (latMax - latMin),
    lon: lonMin + rand() * (lonMax - lonMin),
    wd: Math.floor(rand() * 7),
    T,
    tag: "random",
  });
}

const times: number[] = [];
let worstCentralReach60 = Infinity;
let nestingViolations = 0;
let timeTravel = 0;
for (let rep = 0; rep < 3; rep++) {
  for (const q of queries) {
    const qs = performance.now();
    const arr = query(q.lat, q.lon, q.wd, q.T);
    times.push(performance.now() - qs);
    if (rep === 0) {
      const counts = BANDS.map((b) => {
        let c = 0;
        for (let s = 0; s < nStops; s++) if (arr[s] <= q.T + b) c++;
        return c;
      });
      for (let s = 0; s < nStops; s++)
        if (arr[s] !== INF && arr[s] < q.T) timeTravel++;
      for (let b = 1; b < BANDS.length; b++)
        if (counts[b] < counts[b - 1]) nestingViolations++;
      // strict subset check on band membership
      for (let s = 0; s < nStops; s++) {
        const inBands = BANDS.map((b) => arr[s] <= q.T + b);
        for (let b = 1; b < BANDS.length; b++)
          if (inBands[b - 1] && !inBands[b]) nestingViolations++;
      }
      if (q.tag === "central" && counts[3] < worstCentralReach60)
        worstCentralReach60 = counts[3];
    }
  }
}
times.sort((a, b) => a - b);
const p = (q: number) => times[Math.min(times.length - 1, Math.floor(q * times.length))];
console.log(
  `  queries: ${times.length}  p50 ${p(0.5).toFixed(1)}ms  p95 ${p(0.95).toFixed(1)}ms  max ${times[times.length - 1].toFixed(1)}ms`
);
console.log(`  worst central-origin 60-min reach: ${worstCentralReach60} stops`);

// sample band sizes for the central origin
{
  const arr = query(CENTRAL.lat, CENTRAL.lon, 1, 8.5 * 3600);
  const counts = BANDS.map((b) => {
    let c = 0;
    for (let s = 0; s < nStops; s++) if (arr[s] <= 8.5 * 3600 + b) c++;
    return c;
  });
  console.log(`  Chennai Central Tue 08:30 band stop-counts (15/30/45/60): ${counts.join(" / ")}`);
}

// ---------- timetable oracle ----------
mark("timetable oracle (5 trips)");
let oracleFails = 0;
{
  // pick 5 well-formed Tuesday-active trips with >= 6 stops, spread across the file
  const rowsByTrip = new Map<number, number[]>();
  for (let k = 0; k < nUsed; k++) {
    const i = order[k];
    let arr = rowsByTrip.get(rTrip[i]);
    if (!arr) rowsByTrip.set(rTrip[i], (arr = []));
    arr.push(i);
  }
  let tested = 0;
  for (const [trip, rows] of rowsByTrip) {
    if (tested >= 5) break;
    if (rows.length < 6) continue;
    if (!activeByDay[1][trip]) continue;
    if (tested % 1 === 0 && rows.length >= 6) {
      const first = rows[0], fifth = rows[5];
      const olat = stopLat[rStop[first]], olon = stopLon[rStop[first]];
      const T = rDep[first];
      if (T >= 86400) continue;
      const arr = query(olat, olon, 1, T);
      const sched = rArr[fifth];
      const got = arr[rStop[fifth]];
      const ok = got <= sched + 1e-9;
      if (!ok) oracleFails++;
      console.log(
        `  trip#${trip} dep ${T}s: CSA ${got === INF ? "INF" : Math.round(got)}s vs scheduled ${sched}s -> ${ok ? "OK" : "FAIL"}`
      );
      tested++;
    }
  }
}

// ---------- verdict ----------
const rssMb = process.memoryUsage().rss / 1024 / 1024;
const buildSec = (buildDone - t0) / 1000;
console.log("\n===== SPIKE VERDICT =====");
const gates: [string, boolean, string][] = [
  ["p95 < 250 ms", p(0.95) < 250, `${p(0.95).toFixed(1)} ms`],
  ["p95 < 1 s (hard)", p(0.95) < 1000, `${p(0.95).toFixed(1)} ms`],
  ["parse+build < 120 s", buildSec < 120, `${buildSec.toFixed(1)} s`],
  ["RSS < 1.5 GB", rssMb < 1536, `${rssMb.toFixed(0)} MB`],
  ["connections 0.5-5 M", nConn >= 500_000 && nConn <= 5_000_000, `${nConn}`],
  [">= 300 stops in 60 min (central)", worstCentralReach60 >= 300, `${worstCentralReach60}`],
  ["no time travel", timeTravel === 0, `${timeTravel}`],
  ["nesting holds", nestingViolations === 0, `${nestingViolations}`],
  ["timetable oracle", oracleFails === 0, `${oracleFails} fails`],
];
let pass = true;
for (const [name, ok, val] of gates) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}  (${val})`);
  if (!ok) pass = false;
}
console.log(pass ? "\nALL GATES PASS" : "\nGATES FAILED");
process.exit(pass ? 0 : 1);
