# ReachMap — Project Log

Transit reachability engine: "where can I reach in N minutes by public transit
from point X, departing at time T on day D?" — isochrone bands on an interactive
map. Next.js + TypeScript + MapLibre GL JS, deployed to Vercel. $0 budget.

Full plan of record: 14 stages, one branch per stage (`stage-NN-slug`),
conventional commits, merge to `main`, annotated tag `stage-NN` on completion.

## Stage board

| # | Stage | Role | Status | Tag |
|---|---|---|---|---|
| 1 | Research | Product Owner | in progress | |
| 2 | Product definition (PRD) | Product Owner | pending | |
| 3 | Feasibility spike | Architect | pending | |
| 4 | UX | UX Designer | pending | |
| 5 | Architecture (ADRs) | Architect | pending | |
| 6 | Planning (backlog) | Product Owner | pending | |
| 7 | Repo + CI | DevOps | pending | |
| 8 | Data pipeline | Dev | pending | |
| 9 | Core engine | Dev | pending | |
| 10 | Frontend | Dev | pending | |
| 11 | API/glue (serving) | Dev | pending | |
| 12 | Testing | QA | pending | |
| 13 | Deploy | DevOps | pending | |
| 14 | Launch | Product Owner | pending | |

## NEEDS-HUMAN

Auth/account/permission items logged here; work continues around them.

- **Vercel CLI not installed locally.** The Vercel MCP connector is
  authenticated (team `suvros-projects`, hobby plan) and covers project
  creation + deploys, so this blocks nothing. If a local CLI is ever wanted:
  `pnpm add -D vercel` then `vercel login` (interactive).
- *(pending verification in stage 1)* **Open Transit Data Delhi portal
  (otd.delhi.gov.in)** may require free registration for the current static
  GTFS. Workaround in use: no-auth archived copies hosted by the Mobility
  Database (`mdb-latest` bucket). If fresher data is wanted later, a free OTD
  account gets it; the pipeline takes any zip URL from `config/city.ts`.

## Decisions

- 2026-08-28 — Name **reachmap** (user's first preference; collision-checked:
  no same-concept app, Vercel subdomain free, `imSuvro/reachmap` free).
- 2026-08-28 — Conventional commits, **no AI attribution trailers** (user).
- 2026-08-28 — Architecture selected via a 3-proposal judge panel (all three
  independently converged on client-side CSA over a compiled static binary
  artifact; correctness-first variant won). Ratified by the stage-3 spike;
  written as ADRs in stage 5.

## Stage log

### Stage 0 — Setup (2026-08-28)

Repo created at `D:\Personal\reachmap`, git initialized on `main`.
Environment verified: Node 22.22.3 (nvm4w), pnpm, git 2.54, gh CLI
authenticated as imSuvro (scopes repo+workflow), Java 17 (runs the official
MobilityData gtfs-validator), Docker available. Vercel via authenticated MCP
connector (team `suvros-projects`, hobby).

### Stage 1 — Research (in progress)

Pre-research from the planning session (to be verified and written into
`docs/research.md`):

- Kolkata: **zero GTFS feeds** in the Mobility Database catalog (code search
  of `MobilityData/mobility-database-catalogs` returns 0 for "Kolkata").
- Delhi: two DTC schedule feeds in the catalog (`...-gtfs-1262`, `...-gtfs-3139`),
  both archival (transitland copies, ~2022 vintage), hosted no-auth on the
  `mdb-latest` bucket. Live feed lives on the OTD portal (access TBD).
- Chennai: `mdb-3360` (Chennai/Metropolitan Transport Corporation) exists.
- Bengaluru: not yet checked.
