# ReachMap — Product Requirements

**Stage 2 · Product Owner · 2026-08-29**

## The core question

> **"Where can I reach in N minutes by public transit from point X, departing
> at time T on day D?"**

Answered visually: click anywhere on a map of Chennai, pick a departure day
and time, and see four nested isochrone bands — the areas reachable within
15, 30, 45, and 60 minutes door-to-door (walk + MTC bus + CMRL metro + walk),
computed from the real published timetable.

## Target users

1. **Primary — Chennai residents and newcomers** making location decisions:
   "If I take this flat, what does my 8:30 AM commute reach?" · "Which
   neighbourhoods can visit me within half an hour on a Sunday?" Today this
   takes repeated point-to-point queries in a journey planner; the isochrone
   answers it in one glance.
2. **Secondary — engineers and hiring managers** reading the repo: the
   product doubles as a portfolio piece, so the live demo must communicate
   its engineering (data pipeline, routing, zero-server architecture) through
   the README and its own responsiveness.

## MVP scope

- **One city: Chennai** (selected in `docs/research.md` — the only candidate
  feed with an open license and a currently valid calendar).
- **Click-anywhere origin** — any point in the service area, not just stops.
  Clicking in a transit desert still shows honest walk-only reachability.
- **Departure day + time picker** — day-of-week (the feed differentiates
  weekday/weekend/hybrid services) and time-of-day in IST, minute precision.
- **Fixed bands: 15 / 30 / 45 / 60 minutes**, drawn as nested translucent
  fills with a legend.
- **Zero-interaction default state** — first load shows a complete, real
  isochrone (default origin: Chennai Central hub, weekday 08:30 IST) before
  the visitor touches anything.

## Success criteria (measurable)

| # | Criterion | Gate |
|---|---|---|
| S1 | Live production URL on Vercel renders isochrones from any clicked origin | stage-13 verification, 3 distinct origins |
| S2 | Perceived response: click → bands < 1 s on a mid-range laptop (engine query p95 < 250 ms in the worker) | stage-3 spike gates + stage-12 e2e |
| S3 | Lighthouse performance ≥ 90 on the map page (production build) | stage-12 CI gate |
| S4 | Default isochrone visible with zero interaction ≤ ~3 s on broadband | stage-12 e2e |
| S5 | Correctness properties hold: no arrival before departure; 15⊆30⊆45⊆60; engine arrivals match the feed's own timetable on sampled trips | CI property/oracle tests |
| S6 | Data provenance + license visibly disclosed in the UI (ODbL attribution, feed version, known gaps) | stage-10/14 review |
| S7 | No signup, no cookies banner, no keys — the page just works | by construction |

## Explicitly out of scope (MVP)

- Point-to-point journey planning / turn-by-turn directions.
- Realtime positions, delays, or service alerts (static timetable only).
- Fares, accessibility (step-free) routing, bicycle legs.
- Multi-city UI (the *core* is feed-agnostic by ADR-009; the UI ships one city).
- Suburban rail (not in the feed — disclosed as a data gap, not filled).
- Route/line visualisation, stop timetable browsing.
- Accounts, saved places, sharing links (a URL-encoded view state is a
  post-MVP nicety, not MVP).

## Product decisions

- **Bands communicate door-to-door time**, including initial walk, waiting
  implied by the timetable, riding, transfers, and final walk. No hidden
  "plus waiting" asterisk — what the timetable implies is what renders.
- **Day picker is a weekday selector** (Mon–Sun), not a date picker: the feed
  models service by day-type; a date picker would imply calendar-exception
  precision the data does not carry. The mapping day→services is resolved at
  build time and recorded in the artifact manifest.
- **Time picker defaults to 08:30 IST** — morning peak, the most
  decision-relevant hour; a slider + numeric input, minute-granular.
- **Honesty over polish**: a footer line carries feed name, version, ODbL
  attribution, and a "known gaps" link (unofficial community feed,
  headway-derived metro times, no suburban rail, skipped malformed rows).

## Dependencies & risks (carried from research)

- Feed defects handled in the pipeline (skip + count malformed rows; evaluate
  the `"test "` service in the spike; calendar/feed_info mismatch → calendar
  governs). Any change in the upstream feed re-runs the same gates.
- OpenFreeMap basemap has no SLA → MVP mitigation is the graticule-only
  mode (ADR-008); a PMTiles self-host is a documented, unbuilt contingency
  gated on the stage-13 Range-request check.
- All platform limits verified against Vercel Hobby (see research §3); the
  design keeps the hot path 100% static.
