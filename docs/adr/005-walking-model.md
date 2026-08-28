# ADR-005: Uniform crow-fly walking model, one-hop footpath relaxation

**Status:** Accepted · **Date:** 2026-08-29 · **Deciders:** Architect (stage 5)

## Context

The feed has **no transfers.txt**. Walking appears in three places: origin →
stops, stop → stop transfers, and stop → surrounding area (walk-out). A
street-network walking model (OSM routing) would be more precise but adds a
large data + code dependency to every query.

## Decision

One uniform model, all constants in the city config: crow-fly (haversine)
distance × **1.3 detour factor** at **1.33 m/s** (4.8 km/h) — an effective
straight-line speed of ~1.0 m/s.

- **Origin seeding:** every stop within the **walk horizon** (max band ×
  effective speed ≈ 3.3 km) via the artifact's spatial bucket index; seed
  time = T + dist·1.3/1.33 (stops whose seed exceeds the horizon drop out
  arithmetically). No arbitrary radius cap: walk-in and walk-out use the
  same model, so the map can never paint a stop as walk-reachable while the
  engine refuses to board there. The origin also stamps the raster field
  directly, so a transit-desert click renders honest walk-only bands.
- **Transfers:** generated symmetric footpaths between stop pairs ≤ 300 m,
  `walkSec = max(60, dist·1.3/1.33)`; **exactly one footpath hop is relaxed
  per arrival improvement** during the scan.
- **Walk-out:** the grid stamp with the full remaining budget (ADR-004).

## Options Considered

| Option | Verdict |
|---|---|
| Crow-fly × detour (chosen) | Standard practice (OTP-defensible constants); zero extra data; measured 14,050 generated edges, max degree 13 |
| OSM street-network walking | Precise but drags a routable street graph into the artifact and a second router into the worker; disproportionate at these distances |
| Capped origin radius (e.g. 800 m) | Self-contradictory rendering: the 15-min band alone walks 900 m, so the map would paint stops as foot-reachable that the engine refuses to board. Rejected by adversarial review |
| Full transitive closure of footpaths | Urban stops chain along roads — closure of connected components can cascade far beyond 300 m and double-counts nothing only if done perfectly; capped one-hop relaxation bounds walk chains **by construction** |

## Trade-off Analysis

The known bias: a multi-hop walking chain to a distant boarding (300–600 m
via two hops) is not found, slightly under-estimating reach; the walk-out
grid still paints the *area* honestly. This bounded under-estimate is
preferred over closure's unbounded chain-growth and its double-counting bug
class. Constants are disclosed in the UI data note.

## Consequences

- Easier: determinism, testability (a 3-stop walking-chain fixture asserts
  the one-hop bound), no OSM dependency.
- Harder: hyper-local precision claims — explicitly not made.
- Revisit if: a feed ships transfers.txt (its min_transfer_time then
  overrides generated values for those pairs — already specified).
