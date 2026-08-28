# ADR-010: Spike gates precede engine construction

**Status:** Accepted (gates passed 2026-08-29) · **Date:** 2026-08-29 · **Deciders:** Architect

## Context

The plan's riskiest assumptions were quantitative: query latency, build
time, memory, feed quality. Building the engine before measuring them on
the real feed would risk architecting around fiction.

## Decision

No engine code before a throwaway spike (`spike/csa-spike.ts`) passes
pre-committed gates on the real feed, with fail responses decided **in
advance** (no post-hoc rationalization):

| Gate | Threshold | Measured (2026-08-29) |
|---|---|---|
| Query p95 (300 queries) | < 250 ms (hard fail 1 s) | **0.9 ms** |
| Parse + build | < 120 s | 1.7 s |
| RSS | < 1.5 GB | 255 MB |
| Connections | 0.5–5 M | 1,313,396 |
| Central 60-min reach | ≥ 300 stops | 2,737 |
| Time travel / nesting / oracle fails | 0 | 0 / 0 / 0 |

A second micro-spike (`spike/iso-spike.ts`, stage 3b — added after the
adversarial review caught ADR-004 resting on an estimate) measured the
isochrone half of the click budget on the same feed: at 200 m cells
(327×524 grid, 2,909 reached stops) fill 10 ms + contour 20 ms + serialize
2 ms ≈ **32 ms**, GeoJSON 84 KB raw / 17 KB gz. ADR-001..004 are therefore
all ratified by measurement.

Pre-committed fail responses (not needed): p95 250 ms–1 s → mandate 4-hour
sharding; > 1 s or RSS blowout → redesign before engine code; oracle failure
→ feed bug, demote in the city rubric.

## Consequences

- The architecture in ADR-001..004 is ratified by measurement, not estimate
  (stage 3 for parsing/CSA; stage 3b for raster/contour).
- The spikes stay in the repo as a record (excluded from builds); their
  logic is re-implemented properly, with tests, in stages 8–9 — the spikes
  themselves are not production code. Known spike shortcuts that the real
  engine must NOT inherit: the two-pass after-midnight scan (ADR-006
  mandates a merged ascending scan) and iso-spike's active-all-trips
  approximation.
