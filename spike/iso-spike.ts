/**
 * Stage-3b micro-spike (THROWAWAY): measures the UNMEASURED half of the
 * per-click budget — grid field fill + marching-squares contouring — on the
 * real Chennai feed, closing the adversarial-review finding that ADR-004
 * rested on an estimate. Also measures the emitted GeoJSON size (raw + gzip)
 * to decide whether contour simplification is needed at all.
 *
 * Run: pnpm tsx spike/iso-spike.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { contours } from "d3-contour";

const FEED_DIR = join(import.meta.dirname, ".cache", "chennai");
const EFF_MPS = 1.33 / 1.3;
const HORIZON = 3600;
const BANDS = [900, 1800, 2700, 3600];
const T = 8.5 * 3600;
const ORIGIN = { lat: 13.0827, lon: 80.2757 };
const PAD_M = 3600 * EFF_MPS; // walk-out margin around the stop bbox

// ---------- minimal parse (same rules as csa-spike) ----------
function splitCsv(line: string): string[] {
  if (!line.includes('"')) return line.split(",");
  const out: string[] = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur); return out;
}
function table(name: string) {
  let t = readFileSync(join(FEED_DIR, name), "utf8");
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
  const lines = t.split(/\r?\n/);
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  return { h: Object.fromEntries(splitCsv(lines[0]).map((x, i) => [x.trim(), i])), lines };
}
const hms = (s: string) => { const p = s.split(":"); return p.length === 3 ? +p[0] * 3600 + +p[1] * 60 + +p[2] : -1; };

const st = table("stops.txt");
const stopIdToIdx = new Map<string, number>(); const lat: number[] = []; const lon: number[] = [];
for (let i = 1; i < st.lines.length; i++) {
  const f = splitCsv(st.lines[i]); if (f.length !== Object.keys(st.h).length) continue;
  const la = +f[st.h.stop_lat], lo = +f[st.h.stop_lon];
  if (!Number.isFinite(la) || !Number.isFinite(lo) || stopIdToIdx.has(f[st.h.stop_id])) continue;
  stopIdToIdx.set(f[st.h.stop_id], lat.length); lat.push(la); lon.push(lo);
}
const S = lat.length;
const tr = table("trips.txt");
const tripIdToIdx = new Map<string, number>();
for (let i = 1; i < tr.lines.length; i++) {
  const f = splitCsv(tr.lines[i]); if (f.length !== Object.keys(tr.h).length) continue;
  tripIdToIdx.set(f[tr.h.trip_id], tripIdToIdx.size);
}
const sx = table("stop_times.txt");
const N = sx.lines.length - 1;
const rT = new Int32Array(N), rS = new Int32Array(N), rA = new Int32Array(N), rD = new Int32Array(N), rP = new Int32Array(N);
let n = 0;
for (let i = 1; i < sx.lines.length; i++) {
  const f = splitCsv(sx.lines[i]); if (f.length !== Object.keys(sx.h).length) continue;
  const t = tripIdToIdx.get(f[sx.h.trip_id]), p = stopIdToIdx.get(f[sx.h.stop_id]);
  if (t === undefined || p === undefined) continue;
  const a = hms(f[sx.h.arrival_time]), d = hms(f[sx.h.departure_time]);
  if (a < 0 || d < 0) continue;
  rT[n] = t; rS[n] = +f[sx.h.stop_sequence]; rA[n] = a; rD[n] = d; rP[n] = p; n++;
}
const ord = new Uint32Array(n); for (let i = 0; i < n; i++) ord[i] = i;
(ord as unknown as number[]).sort?.call(ord, (a: number, b: number) => rT[a] - rT[b] || rS[a] - rS[b]);
let C = 0;
const cD = new Uint32Array(n), cR = new Uint32Array(n), cF = new Uint16Array(n), cO = new Uint16Array(n);
for (let k = 0; k + 1 < n; k++) {
  const a = ord[k], b = ord[k + 1];
  if (rT[a] !== rT[b] || rA[b] < rD[a]) continue;
  cD[C] = rD[a]; cR[C] = rA[b] - rD[a]; cF[C] = rP[a]; cO[C] = rP[b]; C++;
}
const o2 = new Uint32Array(C); for (let i = 0; i < C; i++) o2[i] = i;
(o2 as unknown as number[]).sort?.call(o2, (a: number, b: number) => cD[a] - cD[b]);
const dep = new Uint32Array(C), ride = new Uint32Array(C), from = new Uint16Array(C), to = new Uint16Array(C);
for (let i = 0; i < C; i++) { dep[i] = cD[o2[i]]; ride[i] = cR[o2[i]]; from[i] = cF[o2[i]]; to[i] = cO[o2[i]]; }
console.log(`parsed: ${S} stops, ${C} connections`);

// meter frame
const lat0 = lat.slice().sort((a, b) => a - b)[S >> 1];
const MLat = 111132, MLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
const px = new Float64Array(S), py = new Float64Array(S);
for (let i = 0; i < S; i++) { px[i] = lon[i] * MLon; py[i] = lat[i] * MLat; }

// footpaths 300m
const cell = new Map<number, number[]>();
const key = (x: number, y: number) => (Math.floor(x / 300) & 0xffff) * 65536 + (Math.floor(y / 300) & 0xffff);
for (let i = 0; i < S; i++) { const k = key(px[i], py[i]); (cell.get(k) ?? cell.set(k, []).get(k)!).push(i); }
const fpT: number[][] = Array.from({ length: S }, () => []), fpS: number[][] = Array.from({ length: S }, () => []);
for (let i = 0; i < S; i++) {
  const cx = Math.floor(px[i] / 300), cy = Math.floor(py[i] / 300);
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    const c = cell.get(((cx + dx) & 0xffff) * 65536 + ((cy + dy) & 0xffff)); if (!c) continue;
    for (const j of c) { if (j === i) continue; const d = Math.hypot(px[i] - px[j], py[i] - py[j]);
      if (d <= 300) { fpT[i].push(j); fpS[i].push(Math.max(60, Math.round(d / EFF_MPS))); } }
  }
}

// one CSA query from ORIGIN (all trips active — Regular dominates; fine for a latency probe)
const INF = Infinity;
const arr = new Float64Array(S).fill(INF);
const flag = new Uint8Array(tripIdToIdx.size);
const ox = ORIGIN.lon * MLon, oy = ORIGIN.lat * MLat;
const maxWalk = HORIZON * EFF_MPS;
for (let i = 0; i < S; i++) { const d = Math.hypot(ox - px[i], oy - py[i]); if (d <= maxWalk) { const t = T + d / EFF_MPS; if (t < arr[i]) arr[i] = t; } }
let lo = 0, hi = C; while (lo < hi) { const m = (lo + hi) >> 1; if (dep[m] < T) lo = m + 1; else hi = m; }
const H = T + HORIZON;
// trip index per connection was dropped in this trimmed build — rebuild boarding via per-connection scan with flags on "from-stop reachable" only.
// For a latency probe this is fine (it upper-bounds work); correctness was proven in csa-spike.
for (let i = lo; i < C && dep[i] < H; i++) {
  if (arr[from[i]] <= dep[i]) {
    const a = dep[i] + ride[i];
    if (a <= H && a < arr[to[i]]) {
      arr[to[i]] = a;
      const tg = fpT[to[i]], ts = fpS[to[i]];
      for (let e = 0; e < tg.length; e++) { const na = a + ts[e]; if (na <= H && na < arr[tg[e]]) arr[tg[e]] = na; }
    }
  }
}
let reached = 0; for (let i = 0; i < S; i++) if (arr[i] <= H) reached++;
console.log(`reached stops: ${reached}`);

// ---------- the measured part: grid fill + contours ----------
for (const CELL_M of [300, 200, 150]) {
  const t0 = performance.now();
  const minX = Math.min(...px) - PAD_M, maxX = Math.max(...px) + PAD_M;
  const minY = Math.min(...py) - PAD_M, maxY = Math.max(...py) + PAD_M;
  const cols = Math.ceil((maxX - minX) / CELL_M), rows = Math.ceil((maxY - minY) / CELL_M);
  const field = new Float64Array(cols * rows).fill(1e9);
  const stamp = (cxm: number, cym: number, startSec: number) => {
    const budget = HORIZON - startSec; if (budget <= 0) return;
    const r = budget * EFF_MPS;
    const x0 = Math.max(0, Math.floor((cxm - r - minX) / CELL_M)), x1 = Math.min(cols - 1, Math.floor((cxm + r - minX) / CELL_M));
    const y0 = Math.max(0, Math.floor((cym - r - minY) / CELL_M)), y1 = Math.min(rows - 1, Math.floor((cym + r - minY) / CELL_M));
    for (let gy = y0; gy <= y1; gy++) {
      const wy = minY + (gy + 0.5) * CELL_M, dy2 = (wy - cym) * (wy - cym);
      const rowOff = gy * cols;
      for (let gx = x0; gx <= x1; gx++) {
        const wx = minX + (gx + 0.5) * CELL_M;
        const d = Math.sqrt((wx - cxm) * (wx - cxm) + dy2);
        if (d > r) continue;
        const v = startSec + d / EFF_MPS;
        if (v < field[rowOff + gx]) field[rowOff + gx] = v;
      }
    }
  };
  stamp(ox, oy, 0);
  let stamped = 1;
  for (let i = 0; i < S; i++) if (arr[i] <= H) { stamp(px[i], py[i], arr[i] - T); stamped++; }
  const tFill = performance.now();
  const gen = contours().size([cols, rows]).thresholds(BANDS.map((b) => -b).reverse().map((x) => -x)); // ascending [900..3600]
  // d3-contour returns region >= threshold; we need <= threshold, so contour the negated field
  const neg = new Float64Array(cols * rows);
  for (let i = 0; i < neg.length; i++) neg[i] = -field[i];
  const polysNeg = contours().size([cols, rows]).thresholds(BANDS.map((b) => -b))(neg as unknown as number[]);
  const tContour = performance.now();
  // to lon/lat GeoJSON (5 dp)
  const toLL = (pt: [number, number]) => [
    Math.round(((minX + pt[0] * CELL_M) / MLon) * 1e5) / 1e5,
    Math.round(((minY + pt[1] * CELL_M) / MLat) * 1e5) / 1e5,
  ];
  const features = polysNeg.map((mp, bi) => ({
    type: "Feature",
    properties: { band: BANDS[bi] },
    geometry: { type: "MultiPolygon", coordinates: mp.coordinates.map((poly) => poly.map((ring) => ring.map(toLL))) },
  }));
  const geojson = JSON.stringify({ type: "FeatureCollection", features });
  const tSer = performance.now();
  const gz = gzipSync(Buffer.from(geojson), { level: 9 });
  let verts = 0; for (const f of features) for (const poly of (f.geometry.coordinates as unknown as number[][][][])) for (const ring of poly) verts += ring.length;
  console.log(
    `cell ${CELL_M}m: grid ${cols}x${rows}=${cols * rows} | stamps ${stamped} | fill ${(tFill - t0).toFixed(0)}ms | ` +
    `contour ${(tContour - tFill).toFixed(0)}ms | serialize ${(tSer - tContour).toFixed(0)}ms | ` +
    `verts ${verts} | geojson ${(geojson.length / 1024).toFixed(0)}KB raw / ${(gz.length / 1024).toFixed(0)}KB gz`
  );
}
