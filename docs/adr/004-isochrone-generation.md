# ADR-004: Isochrones as marching-squares level sets of one scalar field

**Status:** Accepted · **Date:** 2026-08-29 · **Deciders:** Architect (stage 5)

## Context

CSA yields earliest arrival per stop; the UI needs four nested band polygons
(15/30/45/60 min) that are door-to-door honest (walking out from stops
included) and **provably nested** — the stage-9 monotonicity test is a hard
gate. Chennai stop bbox is ~97 × 58 km (12.61–13.49 N, 79.80–80.34 E).

## Decision

Rasterize **one travel-time scalar field** on a fixed 200 m grid in a local
equirectangular meter frame, then contour it with marching squares
(d3-contour) at the four thresholds. Field fill: stamp the origin's walk
disc, then for every reached stop with remaining budget *b* = 3600 −
(arrival − T), stamp cells within radius *b*·v_eff with
`min(field, arrival − T + walkTime)`. Runs in the same worker as CSA.

## Options Considered

| Option | Verdict |
|---|---|
| Grid + marching squares (chosen) | Nesting is a mathematical property — sublevel sets of one field at increasing thresholds cannot cross. **Measured (stage-3b micro-spike, real feed, 2,909 reached stops):** at 200 m — 327×524 = 171k cells, fill 10 ms + contour 20 ms + serialize 2 ms ≈ **32 ms**; at 150 m — 304k cells, 35 ms; at 300 m — 76k cells, 29 ms |
| Circle union per band (turf.union) | O(seconds) polygon booleans over ~2,900 discs; scalloped seams; four independent unions + simplification can visibly violate nesting at edges. Rejected |
| Alpha-shapes / concave hull per band | Same nesting risk, worse worst-cases, harder to test. Rejected |
| Shipping per-cell times to the main thread and styling a heatmap | Honest but reads as noise, not bands; contradicts the PRD's band-based answer. Rejected |

## Trade-off Analysis

Grid resolution is the one knob: 200 m measured at 32 ms; 150 m at 35 ms —
either fits the budget, so 150 m is a free visual-quality upgrade if
stage-12 QA wants it. Ring rendering (set difference per band) is a
*presentation* concern: the worker emits nested polygons per threshold; the
map layer draws band *i* minus band *i−1* so translucent fills never stack
(docs/ux.md §5).

**Simplification: none in v1.** Measured GeoJSON at 200 m is 84 KB raw /
17 KB gz (4,282 vertices) — small enough to ship exact, and skipping
simplification keeps the nesting guarantee unconditional (per-band
simplification is precisely where nested contours can start crossing).
Coordinates are rounded to 5 dp only. Pre-committed response if a future
city exceeds ~300 KB gz: coarsen the cell size — never per-band
simplification.

Defense-in-depth: beyond nesting-by-construction, a property test samples
5k random cells and asserts band membership is monotone in threshold —
catching implementation bugs the theory can't.

## Consequences

- Easier: nesting guarantees, latency budget, organic band shapes.
- Harder: polygon fidelity is bounded by cell size (disclosed: ~200 m).
- Revisit if: visual QA at stage 12 rejects 200 m edges (drop to 150 m), or
  a city bbox makes the grid exceed ~500k cells (tile the fill).
