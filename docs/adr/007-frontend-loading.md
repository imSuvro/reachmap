# ADR-007: Poster-image LCP and three-tier deferred loading

**Status:** Accepted · **Date:** 2026-08-29 · **Deciders:** Architect (stage 5)

## Context

Success criterion S3: Lighthouse performance ≥ 90 on the map page — while
the page ultimately loads MapLibre GL (~230 KB gz), basemap tiles, and a
multi-MB timetable artifact. Critical platform fact: **a `<canvas>` is not
an LCP candidate** in Lighthouse — a page whose largest content is the map
canvas gets its LCP from whatever incidental element qualifies, making the
score fragile by accident.

## Decision

Three tiers, with hard budgets (initial JS ≤ 100 KB br, TBT ≤ 150 ms, CLS 0):

1. **Tier 1 — what Lighthouse measures.** Statically prerendered App Router
   shell; the LCP element is a **build-time WebP poster of the default
   isochrone**, explicit width/height, `fetchpriority=high`, in a
   fixed-dimension container (zero CLS). The poster is rendered **in plain
   Node with no GL and no browser**: the pipeline rasterizes the already-
   computed `default-iso` bands + origin pin over a flat `--map-base`
   rectangle via `sharp` (SVG → WebP). Deterministic, prebuilt-binary-only,
   no tile fetches on any build path — a headless-MapLibre snapshot was
   rejected because native GL bindings need system libraries a $0 build
   image lacks, and a Chromium screenshot would put a live tile fetch on
   the deploy's critical path. The poster is honestly the real default
   isochrone (minus streets) for the ~1 s before the map cross-fades in at
   the **same camera** (`defaultView.zoom` shared via the manifest).
   Self-hosted fonts via `next/font`. No third-party JS.
2. **Tier 2 — post-hydration.** Dynamic-import MapLibre (`ssr:false`, own
   chunk); map initializes in the same box and cross-fades over the poster;
   the precomputed `default-iso.<hash>.geojson` (tens of KB) renders a real
   isochrone with zero interaction by ~2–3 s.
3. **Tier 3 — idle or first pointerdown, whichever first.** Spawn the
   worker; fetch + inflate + decode the timetable artifact off-main-thread.
   Clicks before ready queue in the worker (pin drops immediately,
   determinate progress ring).

Caching: content-hashed artifacts, `Cache-Control: public,
max-age=31536000, immutable`; `manifest.json` is the only short-cache entry
point (5 min).

## Options Considered

| Option | Verdict |
|---|---|
| Node-rendered poster LCP + tiers (chosen) | The only arrangement where neither basemap latency nor artifact size can touch the measured window; toolchain is plain Node |
| Headless-MapLibre/Chromium snapshot | Native GL bindings or a ~150 MB browser on the build path, plus live tile fetches during deploy; rejected |
| Let the map canvas be the hero | A `<canvas>` is not an LCP candidate (see research.md §5) — score depends on accidents; rejected |
| Load artifact eagerly with the page | Multi-MB on the critical path; TBT + LCP both suffer; rejected |
| Inline band SVG as the hero | Inline SVG shapes are not LCP candidates either (research.md §5) — same fragility as canvas; the `<img>` poster is the qualifying element |

**Where the pipeline runs:** locally (`pnpm build:data`), and
`public/data/<city>/` — artifacts, sidecars, poster — is **committed to the
repo**. Vercel's build is just `next build` over committed statics: no feed
download, no Java, no tile fetch can ever fail a deploy. The build asserts
poster/GeoJSON/manifest consistency (hashes cross-referenced) so committed
outputs cannot drift from config silently.

## Consequences

- Easier: Lighthouse stability (verified as a stage-12 CI gate), instant
  first paint, honest zero-interaction default state (PRD S4).
- Harder: the pipeline owns poster rendering (sharp SVG→WebP, stage 8), and
  data updates require a local `pnpm build:data` + commit — acceptable for a
  feed that updates a few times a year.
- Revisit if: lighthouse-ci shows the poster > ~100 KB (re-encode/resize).
