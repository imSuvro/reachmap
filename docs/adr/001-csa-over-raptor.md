# ADR-001: Connection Scan Algorithm over RAPTOR

**Status:** Accepted · **Date:** 2026-08-29 · **Deciders:** Architect (stage 5)

## Context

The product query is one-to-all earliest-arrival from a set of walk-seeded
stops at a fixed departure time, with a hard 60-minute horizon, over the
Chennai unified feed (5,580 stops, 47,047 trips, 1,313,396 connections). The
result feeds an isochrone rasterizer; transfer counts and Pareto sets are
irrelevant — only the earliest arrival per stop matters.

## Decision

Use the **Connection Scan Algorithm (CSA)**: one forward pass over a single
departure-time-sorted connections array, bounded to the window
`[T, T+3600)`, with trip-boarding flags and one-hop footpath relaxation.

## Options Considered

### Option A: CSA
| Dimension | Assessment |
|---|---|
| Complexity | Low — ~40-line scan loop, three state arrays |
| Query cost | **Measured: p50 0.4 ms, p95 0.9 ms, max 3.5 ms** (spike, Node, 300 queries) |
| Data structures | One sorted SoA — doubles as the wire format |
| Robustness | Never groups by route — immune to variant stop sequences per route_id |

### Option B: RAPTOR
| Dimension | Assessment |
|---|---|
| Complexity | Medium-high — route/trip grouping, per-round arrays, marked stops |
| Query cost | Faster for pruned one-to-one; no advantage for one-to-all reachability |
| Data structures | +30–50% artifact for route-grouped auxiliaries |
| Robustness | Route grouping is exactly where messy feeds (variant stop sequences on one route_id, common in Indian community feeds) silently corrupt results |

## Trade-off Analysis

RAPTOR's strengths (Pareto-optimal transfer counts, target pruning) buy
nothing here: the query is single-criterion and one-to-all by definition.
CSA's known weakness (no pruning for one-to-one) does not apply. At the
measured 0.9 ms p95 there is no performance case for anything more complex,
and the tiny auditable loop directly serves the correctness mandate — every
scan step can be hand-checked against raw `stop_times.txt`.

## Consequences

- Easier: correctness testing (timetable oracles replay trivially), the
  artifact format (the sorted connections array **is** the algorithm input).
- Harder: if a future feature needs "fewest transfers" labeling, that is a
  RAPTOR-shaped problem and would be a new ADR.
- Revisit if: a future city exceeds ~20M connections (scan window growth).

## Action Items
1. [x] Spike validates on the real feed (stage 3 — all gates passed)
2. [ ] Engine implementation shares one isomorphic module between worker,
       Node tests, and pipeline (stage 9)
