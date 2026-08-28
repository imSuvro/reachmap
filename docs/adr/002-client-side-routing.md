# ADR-002: Client-side routing over a static compiled artifact; zero serverless

**Status:** Accepted · **Date:** 2026-08-29 · **Deciders:** Architect (stage 5)

## Context

The brief mandates "precomputed reachability artifacts served statically"
with a click-anywhere origin and any departure minute on any weekday, on
Vercel Hobby ($0). The origin is continuous, so the query space cannot be
enumerated.

## Decision

The precomputed artifact is the **compiled reachability graph** (sorted
connections + footpaths + spatial index + per-weekday trip bitsets), built
once by a Node pipeline and served as a content-hashed static file. Exact
answers are computed on demand **in a Web Worker in the browser**. Nothing
on the hot path touches a server: Vercel serves only static bytes.

## Options Considered

### Option A: Compiled graph + client-side CSA
| Dimension | Assessment |
|---|---|
| Feasibility | Proven: 1.7 s build, 0.9 ms p95 query, 255 MB build RSS (spike) |
| Cost | $0 — static files only; immutable caching makes repeats free |
| Latency | **~33 ms per click, measured** (0.9 ms CSA p95 + 32 ms fill/contour/serialize at 200 m, stage-3b) after a one-time download (gz size measured at stage 8) |
| Vercel fit | No function limits apply; 4.5 MB function-response cap is moot |

### Option B: Full precompute of answers
90k origin cells × 1,440 minutes × 7 days × 4 bands ≈ **3.6×10⁹ polygon
sets** (tens of TB). Bucketing departure time to shrink it introduces
up-to-headway errors — showing a bus the user just missed. Rejected as
combinatorially infeasible *and* systematically wrong.

### Option C: Per-stop bucketed reachability tables
Same bucket error as B, hundreds of MB, plus a client-side composition step
harder to test than running the real algorithm. Rejected.

### Option D: Serverless/edge function per query
Cold-start loads a ~20 MB timetable per instance; per-click network latency;
counts against function limits; burns bandwidth versus one immutable
download. Rejected.

## Trade-off Analysis

The one real cost of A is the initial artifact download (measured raw
18.4 MB → gzip, see ADR-003). Tiered loading (ADR-007) keeps it off the
critical path, and every query after that is local and offline-replayable —
which is also what makes the engine property-testable in CI: the identical
module runs in Node.

## Consequences

- Easier: testing (Node ≡ browser engine), $0 scaling, offline replay.
- Harder: initial-load choreography (ADR-007 owns it).
- Revisit if: artifact wire size exceeds 8 MB (ADR-003 sharding contingency).
