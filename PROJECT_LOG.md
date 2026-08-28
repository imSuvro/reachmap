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
| 9 | Core engine | Dev | in progress | |
| 10 | Frontend | Dev | pending | |
| 11 | API/glue (serving) | Dev | pending | |
| 12 | Testing | QA | pending | |
| 13 | Deploy | DevOps | pending | |
| 14 | Launch | Product Owner | pending | |

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
