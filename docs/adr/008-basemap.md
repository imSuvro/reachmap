# ADR-008: OpenFreeMap primary, self-hosted PMTiles fallback

**Status:** Accepted · **Date:** 2026-08-29 · **Deciders:** Architect (stage 5)

## Context

$0 budget, no keys, no signup wall, MapLibre GL renderer. Research
(docs/research.md §2) verified: OpenFreeMap's public instance is keyless
with no request limits and explicit production blessing, donation-funded
with no SLA; Protomaps publishes free daily planet builds extractable per
bbox; Vercel honors Range requests in practice but undocumented.

## Decision

- **Primary:** OpenFreeMap `positron` style
  (`https://tiles.openfreemap.org/styles/positron`) — a muted gray ground
  that keeps the band ramp legible. Style URL lives in `config/city.ts`.
- **Shipped fallback (MVP):** no basemap — bands over a plain graticule
  with a quiet toast (docs/ux.md). The MVP mitigation ladder is therefore
  **OpenFreeMap → graticule**, and the product's core answer survives a
  total basemap outage.
- **Documented contingency (not built in MVP):** a self-hosted PMTiles
  extract of the Chennai bbox (z0–14, `pmtiles extract` against the
  Protomaps build — estimated 30–80 MB, must stay < 100 MB per Vercel/git
  file caps), served same-origin via the `pmtiles://` protocol, styled with
  `@protomaps/basemaps`. **Precondition before ever activating it:** the
  stage-13 deploy verification includes
  `curl -H "Range: bytes=0-16383"` against a deployed static file — Vercel
  Range support is real in practice but undocumented, and this contingency
  is only viable if that check passes.

## Options Considered

| Option | Verdict |
|---|---|
| OpenFreeMap (chosen primary) | Keyless, unlimited, production-permitted, survived a documented 100k req/s spike; no SLA hence fallback |
| PMTiles self-host as primary | 30–80 MB in the repo + Range-request dependency as the default path; better as insurance than as default |
| CARTO / demotiles / VersaTiles | Keys signposted / no streets / policy unspecified (research §2) |
| Any billed provider | Violates the brief. Excluded |

## Consequences

- Easier: zero configuration, zero keys, attribution auto-injected from the
  style (plus our ODbL feed credit appended).
- Harder: outage risk is real if small — the shipped mitigation is the
  graticule mode; the poster LCP (ADR-007) means even total basemap loss
  cannot break first paint, and PMTiles remains a documented upgrade.
- Revisit if: OpenFreeMap announces sunset/limits (swap = one config line).
