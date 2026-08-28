# ADR-009: Feed-agnostic core, single city-config file

**Status:** Accepted · **Date:** 2026-08-29 · **Deciders:** Architect (stage 5)

## Context

The brief requires a feed-agnostic core with all city-specific configuration
in one file. Research produced a realistic switching scenario (BMTC if its
maintainer ever grants a license; a fresh Kolkata feed if one appears).

## Decision

`config/city.ts` is the **only** file that knows the city: feed URL + name +
license/attribution, timezone + UI label, bbox, default origin/weekday/time,
walking constants, band thresholds, grid cell size, map style URL + fallback,
excluded service ids, and UI data notes. The pipeline, engine, worker, and
UI import from it (directly in Node; via the generated manifest in the
browser — the client never needs the config module itself). Schema in
docs/contracts.md.

## Options Considered

| Option | Verdict |
|---|---|
| One typed TS config (chosen) | Type-checked, greppable, one-file city swap, tree-shakes into the pipeline |
| JSON config | No types/comments; trivially convertible later if multi-city tooling wants it |
| Per-module constants | The drift generator this ADR exists to prevent |

## Consequences

- Easier: city swap = one file + `pnpm build:data` re-run, re-gated by the
  stage-1 scorecard and stage-8 validator gates.
- Harder: nothing measurable.
- Revisit if: a true multi-city UI ships (config becomes a keyed registry —
  additive change).
