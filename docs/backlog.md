# Backlog

**Stage 6 · Product Owner · 2026-08-29.** Milestones derived from the PRD's
success criteria and the ADRs; strictly dependency-ordered — each milestone
is deployable/verifiable on its own. Items reference the contract
(docs/contracts.md) and ADRs rather than restating them.

## M0 — Repo, CI, deploy rails *(stage 7)*

- [ ] Next.js (App Router, TS, pnpm) scaffold; typecheck/lint/test/build wired
- [ ] Public GitHub repo `imSuvro/reachmap`; full history + tags pushed
- [ ] GitHub Actions: one required job `ci` (typecheck + lint + vitest + build) on PR
- [ ] Branch protection on `main` (PRs + required `ci`)
- [ ] Vercel project linked to the repo: preview per PR, production on main
- Depends on: stages 1–5 docs (done). Exit: green CI on a trivial PR; a
  preview URL renders the scaffold.

## M1 — Data pipeline emits contract-true artifacts *(stage 8)*

- [ ] `config/city.ts` per contract §4 (Chennai values; referenceDate pinned)
- [ ] Download + cache feed zip (sha256 recorded)
- [ ] Validator gate: gtfs-validator ERROR ⇒ fail (skippable only via explicit flag, logged)
- [ ] Parse/normalize with skip counters (malformed rows, dangling refs, blank times, negative rides)
- [ ] Trip renumbering by first departure; per-weekday bitsets (referenceDate-anchored)
- [ ] Footpath generation (300 m, symmetric, min 60 s) + spatial index (contract cell formula)
- [ ] Container writer (magic, section table, alignment, configHash) + gzip
- [ ] Sidecars: stopnames.json, default-iso.geojson (via the engine), poster.webp (sharp), manifest.json — each self-hashed
- [ ] Determinism test: rebuild ⇒ byte-identical
- [ ] Malformed-feed fixtures: missing files, >24:00, blank times, dangling refs, expired calendar, calendar_dates-only, XSS service ids
- Depends on: M0 (CI runs its tests), contract. Exit: `pnpm build:data`
  produces committed `public/data/chennai/*`; all pipeline tests green;
  measured gz size recorded in manifest + PROJECT_LOG.
- Note: default-iso.geojson depends on the engine core (M2) — build M1's
  writer/parsers first, wire the default-isochrone emission after M2 lands
  (the two stages interleave by design).

## M2 — Engine correct and fast *(stage 9)*

- [ ] Isomorphic core (`src/engine/`): decoder (container → views), CSA with
      merged two-cursor after-midnight scan (ADR-006), walk-horizon seeding
      (ADR-005), grid fill + d3-contour bands (ADR-004)
- [ ] Property tests: no arrival < departure (10k random queries); band
      membership monotone (5k sampled cells × queries); 15⊆30⊆45⊆60 stop sets
- [ ] Oracle tests: sampled trips from raw stop_times arrive ≤ schedule;
      Monday-01:10 reads Sunday bitset; yesterday-arrival boards today-departure
- [ ] Determinism: same query ⇒ identical GeoJSON bytes
- [ ] Perf assertion in CI: query + bands < 250 ms on the real artifact
- Depends on: M1 parsers/decoder. Exit: all tests green in CI; default-iso +
  poster regenerated through the real engine.

## M3 — The product *(stages 10–11)*

- [ ] Tier-1 shell: poster LCP, dial skeleton, brand chip (ADR-007 budgets)
- [ ] Tier-2: MapLibre dynamic import, cross-fade at manifest zoom, default-iso layer
- [ ] Tier-3: worker (protocol §3) — init/progress/query/result/error, latest-wins
- [ ] Ring rendering (band[i] − band[i−1]), Marina-sunset tokens (ux.md §5)
- [ ] The dial: day chips, time slider+input, ruler legend w/ highlight, readout, ⓘ note
- [ ] States: loading progress, computing, walk-only, out-of-coverage, basemap-outage graticule
- [ ] Mobile bottom sheet; keyboard + aria per ux.md §6
- [ ] Serving headers (contract §5) in next.config; verify compression story on a preview deploy (`curl --compressed`)
- Depends on: M2 artifacts + worker core; stage-4 mockup review feedback (if any).
  Exit: local prod build renders the full flow; S4 zero-interaction state ≤ ~3 s.

## M4 — Proven *(stage 12)*

- [ ] engineering:testing-strategy pass → close coverage gaps
- [ ] Playwright e2e: click → bands; time change → bands update; day toggle;
      desert click; mobile sheet
- [ ] lighthouse-ci ≥ 90 perf on the map page (prod build) as a CI gate
- [ ] Artifact size budget check in CI
- [ ] engineering:code-review over the codebase; findings fixed
- Exit: all gates green in CI on main.

## M5 — Live *(stages 13–14)*

- [ ] engineering:deploy-checklist (rollback items skipped)
- [ ] Production deploy; verify 3 origins render on the live URL
- [ ] Range-request check (`curl -H "Range: bytes=0-16383"`) recorded (ADR-008 precondition)
- [ ] Recruiter-facing README: what/why/how, mermaid architecture diagram,
      screenshots from the live site, live URL; engineering:documentation pass
- Exit: goal condition — live URL + green CI + tags + README.

## Deliberately not in any milestone

Point-to-point routing, realtime, fares, URL share-state, Tamil labels,
cursor time-readout (stage-12 stretch), PMTiles fallback build (contingency,
gated), multi-city UI.
