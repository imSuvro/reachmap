# Architecture Decision Records

Decisions were drafted via a three-proposal judge panel (independent designs
biased simplest / performance / correctness, scored and synthesized), then
ratified against the stage-3 spike on the real Chennai feed. Real measured
numbers appear in each ADR; the spike's full output is in PROJECT_LOG.md.

| ADR | Decision |
|---|---|
| [001](001-csa-over-raptor.md) | Connection Scan Algorithm over RAPTOR |
| [002](002-client-side-routing.md) | Client-side routing over a static compiled artifact; zero serverless |
| [003](003-artifact-format.md) | Sectioned fixed-width binary, shipped as opaque `.bin.gz` |
| [004](004-isochrone-generation.md) | Isochrones as marching-squares level sets of one scalar field |
| [005](005-walking-model.md) | Uniform crow-fly walking model, one-hop footpath relaxation |
| [006](006-service-calendars.md) | Per-weekday trip bitsets + raw >24:00 times |
| [007](007-frontend-loading.md) | Poster-image LCP and three-tier deferred loading |
| [008](008-basemap.md) | OpenFreeMap primary, self-hosted PMTiles fallback |
| [009](009-feed-agnostic-config.md) | Feed-agnostic core, single city-config file |
| [010](010-spike-gates.md) | Spike gates precede engine construction |

Data contracts (artifact container, manifest, worker protocol, city config):
[../contracts.md](../contracts.md).
