# Data contracts

**Stage 5 · Architect · 2026-08-29.** These contracts are implemented
verbatim by the pipeline (stage 8), engine/worker (stage 9), and UI
(stage 10). A change here is a breaking change: bump the container version
and the manifest `version` together.

---

## 1. Artifact container — `timetable.<sha8>.bin` (deployed as `.bin.gz`)

Little-endian throughout. **Every hashed filename carries the hash of its
own contents**: for the container, `<sha8>` = first 8 hex chars of the
SHA-256 of the **uncompressed** container bytes; for each sidecar
(`stopnames`, `default-iso`, `poster`), the first 8 hex chars of that file's
own SHA-256. Sidecars are functions of config (bands, walking, defaultView)
as much as of feed data, so sharing the container's hash would pin them to a
stale immutable URL across config-only changes. The deployed container is
gzipped at build time (`zlib.gzipSync`, level 9) and served as opaque bytes —
no `Content-Encoding` header (ADR-003); the client inflates via
`DecompressionStream('gzip')`.

Builds are **byte-reproducible**: the container is a pure function of (feed
bytes, resolved city config). Everything date-dependent is anchored to
`config.referenceDate`, never to the build clock (ADR-006).

```
offset  size  content
0       8     magic: ASCII "RCHMAP01"  (bytes 52 43 48 4D 41 50 30 31)
8       4     u32 tableLen — byte length of the JSON section table
12      tableLen  UTF-8 JSON section table (no BOM)
pad     0-3   zero bytes to 4-byte-align the data region
...     ...   data region: sections, each 4-byte aligned, zero-padded
```

### Section table JSON

```jsonc
{
  "sections": [
    { "name": "conn.depTimeSec", "off": 0, "len": 5253584, "type": "u32", "enc": "raw" }
    // off = byte offset from the start of the DATA REGION (not the file)
  ],
  "counts": { "stops": 5580, "trips": 47047, "connections": 1313396, "footpaths": 14050 },
  "configHash": "<sha256 of the resolved city config>"
}
```

`type` ∈ `u8 | u16 | u32 | i32 | f32`. `enc` is always `"raw"` in v1 — the
escape hatch for a future varint/delta encoding without a magic bump.
`configHash` sits **inside** the container so that a config-only change
(bands, walking constants, referenceDate) perturbs the container bytes and
therefore every content hash — without it, immutable caching could pin
config-dependent output to a stale URL forever.

**Trip indexing domain.** Exactly one trip numbering exists in the artifact:
the **post-renumbering index** (trips ordered by first departure at build).
`conn.tripIdx` and `day.tripBits` are both indexed by it. `T` =
`counts.trips` = the number of trips that survive to the artifact — a trip
whose stop_times all got dropped (blank times, dangling refs) contributes no
connections and **is not counted**. Build asserts `max(conn.tripIdx) < T`.

### Sections (v1, all required)

Counts: S stops, T trips, C connections, F footpath edges (directed), NC
spatial-index cells.

| name | type | length | content |
|---|---|---|---|
| `conn.depTimeSec` | u32 | C | departure, seconds since service-day midnight; **values > 86400 preserved**; sorted ascending, ties broken by (tripIdx, stopSeq) at build |
| `conn.rideSec` | u16 | C | arrival − departure of this hop (build asserts < 65536) |
| `conn.depStop` | u16 | C | stop index (build asserts S ≤ 65535) |
| `conn.arrStop` | u16 | C | stop index |
| `conn.tripIdx` | u32 | C | trip index; trips renumbered by first departure at build |
| `day.tripBits` | u8 | 7 × ⌈T/8⌉ | per-weekday active-trip bitsets, weekday-major (Mon=0 … Sun=6); bit `t & 7` of byte `wd*⌈T/8⌉ + (t >> 3)` |
| `stops.lat` | i32 | S | latitude × 1e-5 degrees |
| `stops.lon` | i32 | S | longitude × 1e-5 degrees |
| `fp.offsets` | u32 | S + 1 | CSR row offsets into fp.target / fp.walkSec |
| `fp.target` | u16 | F | neighbor stop index |
| `fp.walkSec` | u16 | F | max(60, dist·1.3/1.33); symmetric pairs both present |
| `idx.cellOffsets` | u32 | NC + 1 | CSR offsets into idx.stopIds |
| `idx.stopIds` | u16 | S | stop indices bucketed by cell |
| `idx.meta` | i32 | 6 | [minLonE5, minLatE5, cellLonE5, cellLatE5, cols, rows] |

**Spatial-index cell formula** (identical in builder and worker — no
projection constants needed at query time): `cellLonE5`/`cellLatE5` are the
cell sizes in 1e-5 degrees, computed once at build from `indexCellM` (500 m)
at the feed's median stop latitude. For a point (latE5, lonE5):

```
cx = clamp(floor((lonE5 - minLonE5) / cellLonE5), 0, cols - 1)
cy = clamp(floor((latE5 - minLatE5) / cellLatE5), 0, rows - 1)
linear index = cy * cols + cx
```

Every stop is bucketed (out-of-frame stops clamp to the boundary cell; the
build counts them in `skipped.clampedStops`), so `idx.stopIds` length is
always exactly S.

Everything else (service ids, stop names/ids, feed metadata) ships in JSON
sidecars, never in the binary.

## 2. `manifest.json` (short-cache entry point, 5 min)

```jsonc
{
  "version": 1,
  "city": "chennai",
  "cityName": "Chennai",
  "subtitle": "MTC bus + CMRL metro",
  "timezone": "Asia/Kolkata",
  "tzLabel": "IST",
  "artifact": { "url": "/data/chennai/timetable.<sha8>.bin.gz",
                "gzBytes": 0, "rawBytes": 0, "sha256": "<full hash of raw container>" },
  "stopNames": { "url": "/data/chennai/stopnames.<own sha8>.json", "bytes": 0, "sha256": "…" },
  "defaultIsochrone": { "url": "/data/chennai/default-iso.<own sha8>.geojson", "bytes": 0, "sha256": "…" },
  "poster": { "url": "/data/chennai/poster.<own sha8>.webp", "width": 1200, "height": 630 },
  "map": { "styleUrl": "https://tiles.openfreemap.org/styles/positron", "styleFallback": null },
  "dataNotes": ["…rendered in the ⓘ panel, developer-authored…"],
  "horizonSec": 3600,   // scan horizon = max(bands), stated explicitly
  "counts": { "stops": 0, "trips": 0, "connections": 0, "footpaths": 0 },
  "skipped": { "stopRows": 0, "tripRows": 0, "stopTimeRows": 0,
               "danglingRefs": 0, "negativeRides": 0, "excludedServices": [] },
  "feed": { "name": "chennai-unified-gtfs", "publisher": "UngalSoththu / Ithu Ungal Soththu",
            "attributionHtml": "Transit data © <a href=…>UngalSoththu</a> (ODbL)",  // developer-authored, trusted
            "sourceUrl": "…", "license": "ODbL",
            "licenseUrl": "https://opendatacommons.org/licenses/odbl/",
            "version": "2025.03.25", "downloadedAt": "…", "sha256": "…",
            "calendarStart": "20240501", "calendarEnd": "20300501",
            "validator": { "tool": "gtfs-validator", "version": "8.0.1",
                           "errors": 0, "warnings": 0 } },
  "calendar": { "representativeDates": ["2026-08-31", "…7 ISO dates, Mon-first"],
                "activeTripsPerDay": [0,0,0,0,0,0,0] },
  "walking": { "speedMps": 1.33, "detour": 1.3,
               "transferRadiusM": 300, "minTransferSec": 60 },
  "bands": [900, 1800, 2700, 3600],
  "grid": { "cellM": 200 },
  "bbox": [79.8019, 12.6148, 80.3358, 13.4904],   // COVERAGE bbox: stop bbox + walk-horizon pad; also the raster frame
  "defaultView": { "lat": 13.0827, "lon": 80.2757, "weekday": 1, "depSec": 30600, "zoom": 11 },
  "build": { "at": "ISO-8601", "configHash": "sha256 of resolved city config", "git": "<short sha>" }
}
```

`bbox` is the **coverage** rectangle: the stop bbox padded by the walk
horizon (3600 s × effective speed ≈ 3.3 km) at build. Clicks outside it get
an explicit out-of-coverage answer (§3) — never a silent clamp. `zoom` is
the camera zoom shared by the poster renderer and the MapLibre init so the
tier-2 cross-fade cannot jump.

**Feed-string handling.** Strings originating in the feed (publisher,
version, service ids in `skipped.excludedServices`) are stored **verbatim
except**: C0 control characters and DEL removed (`/[\x00-\x1F\x7F]/g`),
then capped at 120 chars — in that order. No entity stripping: stripping
would corrupt round-trippable identifiers (an id logged as `A&B` must paste
back into `excludeServiceIds` unchanged). Consumers MUST render these as
text (React's default escaping), never as HTML — the feed has contained an
XSS-payload service id; feed strings are attacker-controlled data. The one
trusted-HTML field is `feed.attributionHtml`, which is developer-authored
in the config, not feed-derived.

## 3. Worker protocol

One worker owns download + decode + query. Messages are structured clones;
GeoJSON coordinates are plain arrays.

```ts
// main -> worker
type In =
  | { type: "init"; manifestUrl: string }
  | { type: "query"; id: number; lat: number; lon: number;
      weekday: number /* 0=Mon..6=Sun */; depSec: number /* 0..86399 */ };

// worker -> main
type Out =
  | { type: "progress"; phase: "download" | "decode"; loaded: number; total: number }
  | { type: "ready"; manifest: Manifest }
  | { type: "result"; id: number;
      geojson: FeatureCollection /* one Feature per manifest.bands entry, same
        order; properties.band = the band value IN SECONDS (matches
        manifest.bands exactly); geometry MultiPolygon — CUMULATIVE region
        ≤ band (nested), lon/lat, 5-dp. Empty coordinates allowed. */;
      stats: { reachedLast: number /* stops reached within max(bands) */;
               walkOnly: boolean /* no connection was boarded */;
               outOfCoverage: boolean /* origin outside manifest.bbox */;
               computeMs: number } }
  | { type: "error"; id?: number; message: string; fatal: boolean };
```

Rules:

- The worker computes at most one query at a time and always the **latest**
  received (stale ids are dropped, never answered); `result.id` echoes the
  request. `query` before `ready` is queued (same latest-wins rule).
- An error raised while servicing a query carries that query's `id`; the UI
  clears pending state on either `result.id` or `error.id`.
- **Out-of-coverage**: origin outside `manifest.bbox` → `result` with empty
  features and `outOfCoverage: true`. The pin stays where the user tapped;
  no silent clamping, ever.
- **Deploy-race recovery**: if the artifact or a sidecar fetch returns 4xx
  (a cached manifest pointing at a previous deployment's hashed file), the
  worker refetches `manifest.json` with `cache: "reload"` exactly once and
  retries; only then does it emit `{ fatal: true }`.
- The UI renders rings as band[i] minus band[i−1] (presentation concern,
  docs/ux.md §5); any band count works — nothing hardcodes four.

## 4. City config — `config/city.ts`

```ts
export interface CityConfig {
  id: string;                 // "chennai" — artifact directory name
  name: string; subtitle: string;
  feed: { url: string; name: string; publisher: string;
          license: string; licenseUrl: string; attributionHtml: string };
  timezone: string; tzLabel: string;
  referenceDate: string;      // ISO date anchoring representative weekdays (ADR-006) — part of configHash
  defaultView: { lat: number; lon: number; weekday: number; depSec: number; zoom: number };
  walking: { speedMps: number; detour: number;
             transferRadiusM: number; minTransferSec: number };
  // origin seeding has no radius cap: every stop within the walk horizon
  // (max(bands) × effective speed) is a legal first boarding (ADR-005).
  // NOTE: no bbox field — coverage bbox is DERIVED at build (stop bbox +
  // walk-horizon pad) and published in the manifest, so a stale hand-typed
  // bbox can never truncate the raster frame.
  bands: number[];            // seconds, ascending — [900, 1800, 2700, 3600]
  gridCellM: number;          // 200
  indexCellM: number;         // 500
  mapStyleUrl: string;
  mapStyleFallback: string | null;   // pmtiles style or null
  excludeServiceIds: string[];       // evidence-based exclusions, logged in manifest
  dataNotes: string[];               // rendered verbatim in the ⓘ panel
}
```

The browser never imports this module; everything it needs arrives via the
manifest. The pipeline embeds a `configHash` so a config change forces new
artifact hashes.

## 5. Serving

| Path | Cache-Control | Notes |
|---|---|---|
| `/data/<city>/manifest.json` | `public, max-age=300, must-revalidate` | only mutable entry point |
| `/data/<city>/*.<sha8>.*` | `public, max-age=31536000, immutable` | content-hashed |
| app pages/chunks | Next.js defaults | |

Headers set in `next.config.ts` `headers()`. No API routes, no middleware,
no functions on any hot path.
