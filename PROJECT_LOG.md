# ReachMap — Project Log

Transit reachability engine: "where can I reach in N minutes by public transit
from point X, departing at time T on day D?" — isochrone bands on an interactive
map. Next.js + TypeScript + MapLibre GL JS, deployed to Vercel. $0 budget.

Full plan of record: 14 stages, one branch per stage (`stage-NN-slug`),
conventional commits, merge to `main`, annotated tag `stage-NN` on completion.

## Stage board

| # | Stage | Role | Status | Tag |
|---|---|---|---|---|
| 1 | Research | Product Owner | **done** 2026-08-29 | stage-01 |
| 2 | Product definition (PRD) | Product Owner | **done** 2026-08-29 | stage-02 |
| 3 | Feasibility spike | Architect | **done** 2026-08-29 | stage-03 |
| 4 | UX | UX Designer | **done** 2026-08-29 | stage-04 |
| 5 | Architecture (ADRs) | Architect | **done** 2026-08-29 | stage-05 |
| 6 | Planning (backlog) | Product Owner | **done** 2026-08-29 | stage-06 |
| 7 | Repo + CI | DevOps | **done** 2026-08-29 | stage-07 |
| 8 | Data pipeline | Dev | **done** 2026-08-30 | stage-08 |
| 9 | Core engine | Dev | **done** 2026-08-30 | stage-09 |
| 10 | Frontend | Dev | **done** 2026-08-30 | stage-10 |
| 11 | API/glue (serving) | Dev | **done** 2026-08-30 | stage-11 |
| 12 | Testing | QA | **done** 2026-08-30 | stage-12 |
| 13 | Deploy | DevOps | **done** 2026-08-30 | stage-13 |
| 14 | Launch | Product Owner | **done** 2026-08-30 | stage-14 |

## NEEDS-HUMAN

Auth/account/permission items logged here; work continues around them.

- **Vercel CLI not installed locally.** The Vercel MCP connector is
  authenticated (team `suvros-projects`, hobby plan) and covers project
  creation + deploys, so this blocks nothing. If a local CLI is ever wanted:
  `pnpm add -D vercel` then `vercel login` (interactive).
- ~~Open Transit Data Delhi portal access~~ **Resolved 2026-08-29 — moot.**
  Delhi was rejected on license (DoT terms are not open; modification is a
  stated copyright violation) before the form gate mattered. No action needed.
- *(optional, only if a Bengaluru switch is ever wanted)* **BMTC feed license.**
  `Vonter/bmtc-gtfs` has the best data quality of all candidates but no
  license (default copyright). If the user emails the maintainer
  (`me@vonter.in`, from feed_info.txt) and obtains a grant, switching city is
  a one-file `config/city.ts` change. Not required for the MVP — Chennai is
  ODbL-licensed and selected.

## Decisions

- 2026-08-28 — Name **reachmap** (user's first preference; collision-checked:
  no same-concept app, Vercel subdomain free, `imSuvro/reachmap` free).
- 2026-08-28 — Conventional commits, **no AI attribution trailers** (user).
- 2026-08-28 — Architecture selected via a 3-proposal judge panel (all three
  independently converged on client-side CSA over a compiled static binary
  artifact; correctness-first variant won). Ratified by the stage-3 spike;
  written as ADRs in stage 5.

## Stage log

### Stage 0 — Setup (2026-08-28)

Repo created at `D:\Personal\reachmap`, git initialized on `main`.
Environment verified: Node 22.22.3 (nvm4w), pnpm, git 2.54, gh CLI
authenticated as imSuvro (scopes repo+workflow), Java 17 (runs the official
MobilityData gtfs-validator), Docker available. Vercel via authenticated MCP
connector (team `suvros-projects`, hobby).

### Stage 14 — Launch (done 2026-08-30, tag stage-14)

Recruiter-facing `README.md` (engineering:documentation invoked): live URL
up top, a real production screenshot as the hero, the mermaid
build→artifact→browser diagram, the correctness story told honestly
(including the masked-map bug and how pixel-verification caught it),
measured performance table, ODbL/OpenFreeMap attribution, run-it-yourself
commands, and a repo tour. Live screenshots from the stage-13 verification
committed under `docs/screenshots/`.

Zero-interaction default state confirmed on production: the poster paints
the real Chennai Central isochrone immediately; the live vector bands and
worker engine arrive on first user intent; the readout goes live without
any interaction at all.

**All 14 stages complete.** Output check against the brief: live verified
production URL ✓ · public repo with protected main, green required CI, one
tag per stage ✓ · docs/ complete (research, PRD, ux, adr/×10, backlog,
contracts, testing) ✓ · PROJECT_LOG with full stage log + NEEDS-HUMAN ✓ ·
recruiter-facing README with live link ✓.

### Stage 13 — Deploy (done 2026-08-30, tag stage-13)

engineering:deploy-checklist invoked (rollback items skipped per brief);
production deploys via the git integration (merge to main), verified by
`scripts/verify-live.mjs` driving the real site in Chromium.

**The stage's insistence on rendered-pixel verification caught a launch-
blocking bug the entire test suite had missed:** MapLibre v6 derives its
worker URL from `import.meta.url`, which webpack points into
`/_next/static/chunks/` — the module script 404s as text/html and, since
MapLibre's worker owns tile fetching, the map silently never requested a
single tile. `load` never fired, band layers were never added, and every
band visual to date had actually been the poster doing its ADR-007 job too
well. (This also finally explains the stage-10 "module script" console
error — it was never stale-server noise.) Fix: serve
`maplibre-gl-worker.mjs` + `maplibre-gl-shared.mjs` as plain statics,
prebuild-synced to the installed version, + `setWorkerUrl()`. Camera now
also pans to origins set outside the view (found via the same screenshots).

With the map REALLY rendering, Lighthouse was re-measured honestly:
**98 on CI (calibrated ×1) / 97 local ×1 / 85 local strict ×4 mobile**
(TBT is MapLibre's genuine startup on slow hardware; earlier 91/98 scores
measured the broken map and are voided in docs/testing.md). MapLibre now
mounts on first user intent (mousemove/touch — instant for real visitors,
12 s fallback), keeping its ~600 ms of startup out of the idle window
while the poster remains the zero-interaction content.

**Final production verification (https://reachmap.vercel.app):** isochrones
render from three distinct origins — Chennai Central 2,909 stops · T. Nagar
2,626 · Tambaram 2,339 (screenshots in the repo's README assets) — zero
console errors; artifact opaque + immutable + Accept-Ranges on the live
edge; Range → 206 recorded (ADR-008 precondition); poster served. **LIVE
VERIFICATION PASSED.**

### Stage 12 — Testing (done 2026-08-30, tag stage-12)

Strategy doc: `docs/testing.md` (engineering:testing-strategy invoked).
New assets: Playwright config (desktop + Pixel-7 projects), 9 e2e scenarios,
`scripts/lighthouse-gate.mjs` (self-contained, best-of-2, Playwright's
Chromium), `scripts/check-budgets.mjs`, all wired into the required CI job.

**Gates at close: 51 unit/property/oracle · 8/8 e2e (zero console errors)
· 6/6 budgets · Lighthouse performance 91 (mobile preset).**

Getting Lighthouse over 90 surfaced real product findings, not test tuning:
the page CRASHED under the gate's `--disable-gpu` flag (MapLibre throws
without WebGL → Next error screen scored 82 as if healthy) → the app now
survives WebGL-less browsers (poster stays, toast shows); the full-viewport
poster is **excluded from LCP by Chrome's background-image heuristic**, so
LCP fell to hint text re-painted at font-swap (4.7 s) → fonts now
`display: optional` and the MapLibre mount deferred past load+idle
(TBT 670→260 ms, LCP 4.7→2.6 s). A stale `next start` serving a previous
build also explained the stage-10 "module script" console mystery — e2e
asserts zero console errors on a clean server. Playwright also caught a
genuine CSS bug: maplibre-gl.css's `.maplibregl-map{position:relative}`
beat `.map{position:absolute}` in the cascade → the map collapsed to a
clipped 1280×300 canvas; fixed with a parent-scoped selector.

**engineering:code-review (full codebase, 3 hostile reviewers → 15
verifiers over the stage-10..12 surface; pipeline/engine were reviewed at
their own stages): ~13 confirmed findings, all fixed:**

- Worker deploy-race recovery discarded the fresh manifest → new artifact
  bytes decoded under stale config, silently wrong geometry. Fixed (fresh
  manifest adopted) + a **configHash cross-check** (artifact vs manifest)
  turns any mixed deployment into a loud fatal error.
- No worker `onerror`/`onmessageerror` → eternal "Loading · 0%" on a worker
  script 404/CSP/OOM. Fixed + constructor guarded.
- Graticule fallback fired on ANY pre-load map error — including a single
  transient tile 404 (verified against maplibre-gl internals). Now gated on
  the style itself failing.
- Pre-ready clicks pinned the computing dim for the whole 6 MB download and
  double-computed at ready. Now: pre-ready interactions only move state;
  the on-ready effect dispatches the latest view exactly once.
- Poster cross-fade jumped scale on every viewport ≠ 1200×630
  (`object-fit: cover` broke the shared-camera premise) → `object-fit: none`
  keeps 1 poster px = 1 map px.
- WebGL-fail path: the 8 s poster fallback no longer strips the poster when
  the map never initialized (the poster is the honest view then).
- Worker progress posts coalesced (was one React commit per network chunk);
  duplicate Enter-then-blur time commits guarded; lighthouse-gate now kills
  its server process TREE (Windows taskkill /T) and survives a 0-score run;
  budgets check contract-completeness before dereferencing it.

Rejected by verification (recorded so they aren't re-litigated): per-chunk
progress as a TBT threat (TBT counts >50 ms tasks only), `toRings` on the
main thread (~9–20 ms, meets budget), React 19 unmount-setState (no-op),
budgets file-count semantics (existence checks already pin the set).

### Stage 11 — API/glue: serving (done 2026-08-30, tag stage-11)

No server code — by design there was nothing to build here beyond the
`next.config.ts` headers written at stage 7; this stage **verified the
whole contract §5 on the real Vercel edge** (the stage-10 PR's preview
deployment):

| Check | Result |
|---|---|
| `manifest.json` | `Cache-Control: public, max-age=300, must-revalidate` + gzip on the wire (JSON is on Vercel's compression allowlist) ✓ |
| `timetable.<sha8>.bin.gz` | **Opaque**: no `Content-Encoding`, `Content-Length: 6,358,920` (exactly the gz bytes — the DecompressionStream design confirmed), `max-age=31536000, immutable`, `Accept-Ranges: bytes` ✓ |
| Range request on the artifact | **`206 Partial Content`, `Content-Range: bytes 0-16383/6358920`** — the ADR-008 precondition for the PMTiles contingency PASSES on Vercel, recorded ✓ |
| `default-iso.geojson` / `poster.webp` | immutable year cache; geojson gzip-compressed ✓ |

The research-flagged risk (Vercel never compresses octet-stream; self-set
`Content-Encoding` unreliable) is thereby confirmed handled: the artifact
crosses the wire at 6.36 MB as opaque bytes and inflates in the worker.

### Stage 10 — Frontend (done 2026-08-30, tag stage-10)

The product UI per docs/ux.md + the stage-4 mockup, in
`src/components/{App,MapView,Dial,DataNote}.tsx`, `src/workers/iso.worker.ts`,
`src/app/app.css`:

- **Tiered loading (ADR-007):** server-rendered shell with the poster
  `<img>` as the LCP element (plus an 8 s never-stick fade fallback);
  MapLibre dynamically imported and cross-faded at the shared camera; the
  precomputed default isochrone rendered before the engine exists; worker
  spawned on idle or first interaction, whichever first.
- **Worker** implements contract §3 exactly: progress events, latest-wins
  queries, error ids, one cache-bypassing manifest refetch on a 4xx
  (deploy-race recovery), `DecompressionStream('gzip')` inflate.
- **Rings** (band[i] − band[i−1]) computed with polygon-clipping — exact
  set difference, no alpha stacking; per-band fill/line layers with the
  Marina-sunset tokens; ruler-hover dims other rings via paint properties.
- **The dial**: day chips (radiogroup), HH:MM input + slider, band ruler
  legend, live `aria-live` readout, ⓘ data-note panel with ODbL
  attribution and skipped-row counts; mobile bottom sheet; graticule
  basemap fallback wired per ADR-008.
- First-load JS 108 kB raw (≈ 37 kB br — inside the ≤100 KB brotli budget);
  MapLibre and polygon-clipping live in the deferred map chunk.

**Verified live against the production build** (browser structural checks —
the embedded pane cannot composite pixels, so visual QA lands with
Playwright screenshots in stage 12): worker loaded the 6.36 MB artifact and
answered the default view (readout "≈ 2,909 stops in 60 min" — the live
engine's number); synthetic map click moved the pin and recomputed
("≈ 2,685"); Sunday shows the honest −1-stop difference vs Tuesday (the 74
HSC trips); 23:30 collapses reach to 474 stops (real late-night service);
attribution renders the ODbL credit. One console note deferred to stage 12:
a single non-fatal "module script … text/html" error per load with zero
functional impact — suspected preview-pane injection; Playwright's clean
Chromium will confirm or refute.

### Stage 9 — Core engine (done 2026-08-30, tag stage-09)

`src/engine/{csa,isochrone,engine,geo}.ts` — the isomorphic core shared by
worker, tests, and the sidecar renderer:

- **CSA** with the ADR-006 **merged two-cursor after-midnight scan**
  (today's window against `bits[wd]` interleaved with yesterday's
  `[T+86400, …)` against `bits[(wd+6)%7]` by effective departure), epoch-
  stamped boarding flags (allocation-free queries), and ADR-005 walk-horizon
  seeding via the artifact's spatial index (no radius cap).
- **IsochroneGrid**: field fill + d3-contour, band identity taken from each
  contour's own `.value`, features sorted + asserted against config bands.
- `pipeline/sidecars.ts`: default-view isochrone + **Node-rendered poster**
  (SVG → sharp → WebP at the exact WebMercator camera of
  `defaultView.zoom`, so the map cross-fade aligns pixel-true).

**Test battery (19 new; 51 total, all green):** no-time-travel over 200
random queries; stop-set nesting; polygon nesting via 500-point ray-cast
sampling; timetable oracle; weekday gating (Saturday-only service);
walk-only desert honesty; out-of-coverage explicit-empty; determinism
across instances; **two merged-scan regressions with distances chosen so
walking cannot mask transit** (Monday-00:30 reads Sunday's 25:00 trip;
a yesterday-frame arrival boards a today-frame departure); real-artifact
gates (default view < 250 ms, > 2,000 stops reached, band property ===
manifest.bands).

**The point-sample nesting test caught a real bug on first run:**
d3-contour reorders thresholds internally, so positional band labeling
reversed the bands (the 60-min polygon labeled 15). Fixed by reading each
contour's `.value`; the same latent mislabel existed in `spike/iso-spike.ts`
(its size/latency measurements were unaffected — only labels).

**Full build now emits everything:** `default-iso.ac6ddf3b.geojson`
83.8 KB (matches the stage-3b estimate), `poster.81b029a6.webp` 35.7 KB
(1200×630, visually verified: nested Marina-sunset bands from Chennai
Central, coast honestly empty), manifest contract-complete. Artifact hash
unchanged (915b6267).

### Stage 8 — Data pipeline (done 2026-08-30, tag stage-08)

`config/city.ts` (the one city file) + `pipeline/` (gtfs.ts primitives,
compile.ts transform, validate.ts gate, download.ts, build.ts orchestrator)
+ `src/engine/{types,container}.ts` (isomorphic codec) + 32 unit tests over
handcrafted fixtures covering: blank-time interpolation, >24:00 preserved
raw, trip renumbering + bitset domain, calendar_dates add/remove on
representative dates, frequencies expansion, service exclusion,
transfers.txt override + type-3 forbid, parent_station collapse, spatial
index round-trip via the contract formula, stale-calendar and
anemic-weekday guards, byte-identical determinism, container codec
round-trip/alignment/truncation.

**Real-feed run (2026-08-30):** validator gate passed honestly (149 ERRORs,
every code allowlisted per config because the pipeline deterministically
skips those rows: 45 stop rows, 102 trip rows, 192 dangling refs, 0 blank
times, 0 negative rides). Compiled 5,580 stops / 47,047 trips / 1,313,396
connections / 14,050 footpaths — byte counts match the stage-3 spike.
**Container: 18.65 MB raw → 6.36 MB gz (34%)** — the ADR-003 open question
answered: comfortably under the 8 MB wire budget, sharding contingency
stays dormant. Output committed under `public/data/chennai/` (partial
build: default-iso/poster land with the stage-9 engine). Weekday trip
counts 47,047 ×6 + Sunday 46,973 (the −74 HSC trips).

**Pre-merge adversarial review** (2 finders → 15 independent verifiers):
17 claims, **10 confirmed** (5 rejected with trace-backed refutations), all
fixed + regression-tested:

- transfers.txt with an *empty* `min_transfer_time` cell became an override
  of 0 (`Number("") === 0`) → every bare row a 60 s teleport. Fixed: blank
  cell = no override.
- frequencies expansion anchored on the template's first row even when that
  row was a dropped leading-blank (`rDep = -1`) → clones shifted hours off.
  Fixed: anchor on first surviving row; negative-departure hard assert.
- Malformed calendar.txt dates poisoned `calStart/calEnd` to NaN, silently
  disabling the stale-calendar guard. Fixed: row-level isFinite gate.
- Excluded-service stop_times rows were miscounted as `danglingRefs`.
- Sidecar partial-build catch could swallow a transitive
  ERR_MODULE_NOT_FOUND from inside a real sidecars module. Fixed: only the
  import is guarded, and only for the sidecars specifier itself.
- Manifest calendar dates drifted from the contract (compact vs ISO) —
  contract updated to ISO; manifest assembly extracted to a pure
  `pipeline/manifest.ts` with its own tests (also closing the "no build.ts
  coverage" finding for prune/keep-set + URL/date shapes).
- `clampedStops` was declared but never incremented; validator jar cache
  now version-named + atomically installed + size-checked; dead existsSync
  removed.

All 39 tests green; rebuild after fixes produced the **identical artifact
hash** (915b6267) — the confirmed bugs were latent for this feed, which is
why review had to find them rather than the build.

### Stage 7 — Repo + CI (done 2026-08-29, tag stage-07)

- Next.js 15 (App Router, TS, pnpm) scaffold, hand-built: IBM Plex via
  `next/font`, ux.md tokens in globals.css, contract §5 cache headers
  already in `next.config.ts`. Local gates green: typecheck, lint (ESLint 9
  + eslint-config-next 15 — v10/v16 mismatches found and pinned), vitest
  (passWithNoTests until stage 8), `next build` (102 kB first-load raw
  ≈ well under the 100 KB **brotli** budget).
- Public repo **github.com/imSuvro/reachmap**; full history + tags
  stage-01..06 pushed.
- Branch protection on `main`: PRs required (0 approvals — solo repo),
  required status check `ci`, no force pushes, admin-enforce off (so tags
  and emergency pushes stay possible). Stage 7 itself was the last local
  bootstrap merge; stages 8+ merge via PRs with required CI.
- CI: one job `ci` (typecheck + lint + vitest + build) on PRs and main.
- Vercel: project `reachmap` (prj_cIhGS0XDhOuyb75BbmVMDjacABcr) created
  via the authenticated Vercel connector, **git-linked to the GitHub repo**
  — previews per PR, production on main push. First production deployment
  built READY from the stage-7 merge commit with aliases
  **https://reachmap.vercel.app** (the bare subdomain was unclaimed and
  auto-assigned), `reachmap-suvros-projects.vercel.app`; Vercel
  Authentication (deploy protection) disabled by default = no signup wall.

### Stage 6 — Backlog (done 2026-08-29, tag stage-06)

`docs/backlog.md`: six milestones (M0 rails → M1 pipeline → M2 engine →
M3 product → M4 proven → M5 live), each with an explicit exit condition and
dependency note; M1/M2 interleaving (default-iso needs the engine) called
out rather than hidden. Not-doing list carried from the PRD.

### Stage 5 — Architecture (done 2026-08-29, tag stage-05)

Ten ADRs in `docs/adr/` (see its README for the index) + full data
contracts in `docs/contracts.md` (binary container byte layout, manifest
schema, worker protocol, city-config type, serving/caching rules). Both
skills invoked (`engineering:architecture`, `engineering:system-design`).

**Adversarial verification** (two hostile review agents over the ADR set
and the contracts) surfaced **21 real findings, 4 blockers** — all fixed:

- `day.tripBits` trip-numbering domain was ambiguous → pinned to the
  post-renumbering `conn.tripIdx` domain with a build assertion. (Would
  have produced silently wrong isochrones.)
- Sidecars shared the container's content hash → each hashed file now
  hashes its own bytes; `configHash` embedded in the container.
- The two-pass after-midnight scan **broke CSA's ascending-departure
  invariant** (a Sunday 29:15 arrival could never board a Monday 05:30
  departure) → ADR-006 now mandates a merged two-cursor scan; spike noted
  as carrying the flaw so the engine must not inherit it.
- Poster-WebP LCP had no viable $0 toolchain (native MapLibre needs GL
  system libs; Chromium puts live tile fetches on the deploy path) →
  poster is now Node-rendered (sharp SVG→WebP) from the precomputed
  default isochrone; pipeline runs locally and `public/data/` is committed.
- ADR-004 rested on an estimate → closed by a **stage-3b micro-spike**
  (`spike/iso-spike.ts`) on the real feed: 200 m grid (327×524) fill 10 ms
  + contour 20 ms + serialize 2 ms ≈ **32 ms**; GeoJSON 84 KB raw/17 KB gz
  → **no simplification in v1**, nesting stays exact; total click ≈ 33 ms.
- Plus: walking asymmetry removed (origin seeds the full walk horizon, no
  800 m cap), out-of-coverage clicks answered explicitly (never clamped),
  `defaultView.zoom` added so the poster cross-fade cannot jump,
  representative dates anchored to `config.referenceDate` (build
  reproducibility), Monday-reads-Sunday modular wrap written into ADR-006,
  band units unified (seconds everywhere), worker errors carry query ids,
  deploy-race manifest retry specified, sanitization switched from lossy
  stripping to control-char removal + render-as-text, manifest gained
  map style/attribution/dataNotes/horizonSec, research.md's stale service
  count and bbox corrected, ADR-008/PRD honesty fix (MVP ladder is
  OpenFreeMap → graticule; PMTiles is unbuilt contingency).

### Stage 4 — UX (done 2026-08-29, tag stage-04)

`docs/ux.md` (behavior spec — wins on conflict) plus two published design
artifacts (sources in `docs/design/`):

- **Hi-fi mockup** — https://claude.ai/code/artifact/262689ac-f92f-470b-a9a3-caee713421d5
- **Wireframes** — https://claude.ai/code/artifact/33113d05-6ac2-4a0d-b0b4-d0d06d3bcdfa

Design identity: the map is the whole product; "Marina sunset" band ramp
(marigold → vermilion → silk magenta → deep violet, rendered as set-difference
rings, monotonic lightness); IBM Plex in three cuts (Condensed = signage,
Sans = UI, Mono = every number); signature element is **the dial** — one card
fusing day chips, departure readout/slider, and the band ruler that doubles
as the legend. Mobile: dial becomes a bottom sheet. States specified for
engine-loading, computing, transit desert, basemap outage, and the ⓘ data
note (feed provenance + ODbL + known gaps as first-class UI).

**Review protocol:** artifacts are published for the user's async review;
non-blocking for stages 5–9 per plan; any feedback lands before stage 10
(frontend build) begins. Visual QA of the mockup was limited to structural +
JS syntax checks this session (the embedded browser pane could not display
or authenticate to the artifact URL); full visual verification happens
against the real UI in stage 10.

### Stage 3 — Feasibility spike (done 2026-08-29, tag stage-03)

`spike/csa-spike.ts` (throwaway; kept for the record, excluded from any
build): full parse → connections → footpaths → one-to-all CSA with
after-midnight second window, on the real Chennai feed. **All 9 pre-committed
gates PASS**, with enormous headroom:

| Measure | Gate | Actual |
|---|---|---|
| Query p95 (300 queries: 20 central + 80 random × 3 reps) | < 250 ms | **0.9 ms** (p50 0.4, max 3.5) |
| Parse + build | < 120 s | **1.7 s** |
| RSS | < 1.5 GB | 255 MB |
| Connections | 0.5–5 M | 1,313,396 |
| Central-origin 60-min reach | ≥ 300 stops | 2,737 |
| Time travel / nesting violations / oracle fails | 0 | 0 / 0 / 0 |

Timetable oracle: 5/5, including two cases where CSA legitimately beat the
sampled trip's scheduled arrival via a faster alternative.

Feed facts the spike established (feeding stages 5 and 8):

- Calendar actually holds **9 services**; only two carry trips: `Regular`
  46,973 (all days) and `HSC` 74 (Mon–Sat). The `"test "` and XSS-payload
  services have **zero trips** — they vanish naturally; string sanitization
  still mandatory. Day-to-day service difference is therefore small (Sunday
  −74 trips) — disclosed in UI copy rather than a fake distinction.
- Row skips: 45 stop rows, 102 trip rows, 192 dangling stop_time refs,
  **0 blank times**, 0 negative rides. 1,780 connections depart ≥ 24:00 —
  the after-midnight second scan window is live behavior, not theory.
- Stop bbox is bigger than assumed: 12.61–13.49 N, 79.80–80.34 E (~97 km
  N–S). Grid sizing at 200 m ⇒ ~140k cells — still fine.
- Sharding contingency (ADR-003) almost certainly unnecessary at 0.9 ms;
  artifact ≈ 1.31 M × 14 B ≈ 18.4 MB raw before gzip.

Chennai Central Tue 08:30 band stop-counts: 245 / 1,092 / 2,006 / 2,906 —
a compelling default view confirmed.

### Stage 2 — PRD (done 2026-08-29, tag stage-02)

`docs/PRD.md`. Core question, two audiences (Chennai residents making
location decisions; engineers reading the portfolio), MVP scope (one city,
click-anywhere, day+time picker, 15/30/45/60 bands, zero-interaction default
state at Chennai Central weekday 08:30 IST), seven measurable success
criteria mapped to stage gates, and an explicit out-of-scope list. Product
decisions recorded: bands are door-to-door, day picker is a weekday selector
(matches what the data actually models), honesty footer with ODbL
attribution and known gaps.

### Stage 1 — Research (done 2026-08-29, tag stage-01)

Full findings + sources in `docs/research.md`. Executive summary:

- **Kolkata: no feed exists** — proven negative (catalog zero + GitHub sweep:
  one empty scaffold repo, one single-metro-line toy with a fake agency URL).
  Fallback ladder engaged per the brief.
- **Delhi: rejected on license.** OTD terms reserve DoT copyright, permission
  is discretionary/purpose-scoped, modification is a stated violation — and
  OTD's own docs admit bus stop_times are synthetic (constant-speed
  estimates). The only no-signup mirror expired 2024-01-01 with no shapes.
- **City = Chennai** (`ungalsoththu/ChennaiGTFS` unified MTC bus + CMRL
  metro): the only candidate with an explicit open license (**ODbL**) and a
  calendar valid today (2024→2030). 5,625 stops / 47,149 trips / 1.36M
  stop_times. Defects logged for the pipeline: 146 malformed rows (0.01%),
  a `"test "` service to evaluate in the spike, headway-derived CMRL times,
  feed_info/calendar window mismatch — all disclosed, never filled.
- **Bengaluru (BMTC) = runner-up**: zero validator errors, freshest calendar,
  but no license on the repo → cannot cleanly redistribute a derived artifact.
- **Basemap: OpenFreeMap positron** primary (keyless, no limits, production
  OK), self-hosted PMTiles Chennai extract as fallback, graticule as tertiary.
- **Vercel Hobby facts that shaped the design:** `.bin` is never compressed
  (MIME allowlist) and self-served `Content-Encoding` is unreliable → the
  artifact ships as an opaque `.bin.gz` inflated in-browser via
  `DecompressionStream('gzip')`. No total deployment cap; 100 MB/file; 100 GB
  bandwidth with pause-not-bill overage; functions capped at 4.5 MB response
  (moot — zero functions on the hot path).
- Validator runs (official gtfs-validator v8.0.1, local Java 17): Delhi
  archive 8 ERRORs; **BMTC-2595 0 ERRORs**; BMTC-2013 38,893 ERRORs;
  Chennai 149 ERRORs (row-level, skippable). Reports in
  `pipeline/.cache/validator/`.
