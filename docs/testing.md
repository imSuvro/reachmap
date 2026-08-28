# Test strategy

**Stage 12 · QA · 2026-08-30.** The pyramid, mapped to what each layer is
uniquely able to prove. Everything below runs in CI on every PR (one job,
`ci`, required on `main`).

## Unit + property + oracle (fast, many) — 51 tests

| Area | What is proven | Where |
|---|---|---|
| CSV/time/date primitives | quoting, BOM/CRLF, >24:00 raw, sanitize keeps punctuation & round-trips ids | `tests/gtfs.test.ts` |
| Container codec | round-trip identity, 4-byte alignment (zero-copy views legal), magic/truncation rejection | `tests/container.test.ts` |
| Compile transform | skip counters exact; blank-time interpolation; trip renumbering + bitset domain; calendar_dates add/remove; frequencies expansion (incl. the dropped-first-row anchor regression); transfers overrides (incl. the empty-cell regression); parent_station collapse; spatial-index round-trip via the contract formula; stale-calendar + anemic-weekday guards; **byte-identical determinism** | `tests/compile.test.ts` |
| Validator gate | allowlist semantics with exact counts | `tests/validate.test.ts` |
| Manifest | contract URLs/dates/keep-set | `tests/manifest.test.ts` |
| Engine | no-time-travel (200 random queries); stop-set nesting; **polygon nesting via 500-point ray-cast sampling** (caught a real band-label bug); timetable oracles; weekday gating; walk-only + out-of-coverage honesty; determinism; **merged after-midnight scan** (Monday reads Sunday; yesterday-arrival boards today-departure — distances chosen so walking cannot mask transit); real-artifact gates (< 250 ms, > 2,000 stops, band ≡ manifest.bands) | `tests/engine.test.ts` |

## Integration (some)

The "real Chennai artifact" tests double as integration: the committed
6.36 MB artifact is decoded and queried by the same engine module the
worker ships — pipeline output and engine input meet in CI on every PR.

## E2E (few, high confidence) — Playwright, desktop + mobile

The oracle for "the app works" is the readout switching to a live stop
count: it can only happen if the worker downloaded, inflated with
DecompressionStream, decoded the container, ran CSA, and posted a result.

- Zero-interaction first load: poster present with explicit dimensions →
  live engine answers the default view (> 2,000 stops, all bands non-empty)
- Click → origin moves, bands recompute, hint dies
- Time change (23:30) → reach collapses (< 1,500 stops — real thin service)
- Day toggle → label + service change
- Desert + out-of-coverage answers via the deterministic e2e seam
  (`__rmSelect`) — a pixel click cannot reliably hit either
- Ruler highlight, data note (ODbL visible), **zero console errors**
- Mobile (Pixel 7): bottom sheet collapses/expands
- Screenshots written to `test-results/` for visual review

## Non-functional gates

- **Lighthouse performance ≥ 90** (`scripts/lighthouse-gate.mjs`, PRD S3):
  self-contained (starts `next start`, measures with Playwright's Chromium),
  prints FCP/LCP/TBT/CLS and the actual LCP element (must be the poster
  `<img>` — ADR-007's whole premise), fails CI below 90.
- **Size budgets** (`scripts/check-budgets.mjs`): artifact gz ≤ 8 MB,
  default-iso ≤ 300 KB, poster ≤ 100 KB, stopnames ≤ 500 KB, manifest
  contract-complete, output dir exactly the referenced file set.

## Deliberately not built

Visual-regression golden diffs (one page, screenshots reviewed instead);
load testing (static files on a CDN); cross-browser matrix (MapLibre +
DecompressionStream baseline is Chromium/Firefox/Safari ≥ 2023 — noted, not
gated at $0).
