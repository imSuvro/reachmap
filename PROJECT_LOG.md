# ReachMap — Project Log

Transit reachability engine: "where can I reach in N minutes by public transit
from point X, departing at time T on day D?" — isochrone bands on an interactive
map. Next.js + TypeScript + MapLibre GL JS, deployed to Vercel. $0 budget.

Full plan of record: 14 stages, one branch per stage (`stage-NN-slug`),
conventional commits, merge to `main`, annotated tag `stage-NN` on completion.

## Stage board

| # | Stage | Role | Status | Tag |
|---|---|---|---|---|
| 1 | Research | Product Owner | **done** 2026-08-29 | stage-01 |
| 2 | Product definition (PRD) | Product Owner | **done** 2026-08-29 | stage-02 |
| 3 | Feasibility spike | Architect | in progress | |
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
- ~~Open Transit Data Delhi portal access~~ **Resolved 2026-08-29 — moot.**
  Delhi was rejected on license (DoT terms are not open; modification is a
  stated copyright violation) before the form gate mattered. No action needed.
- *(optional, only if a Bengaluru switch is ever wanted)* **BMTC feed license.**
  `Vonter/bmtc-gtfs` has the best data quality of all candidates but no
  license (default copyright). If the user emails the maintainer
  (`me@vonter.in`, from feed_info.txt) and obtains a grant, switching city is
  a one-file `config/city.ts` change. Not required for the MVP — Chennai is
  ODbL-licensed and selected.

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

### Stage 2 — PRD (done 2026-08-29, tag stage-02)

`docs/PRD.md`. Core question, two audiences (Chennai residents making
location decisions; engineers reading the portfolio), MVP scope (one city,
click-anywhere, day+time picker, 15/30/45/60 bands, zero-interaction default
state at Chennai Central weekday 08:30 IST), seven measurable success
criteria mapped to stage gates, and an explicit out-of-scope list. Product
decisions recorded: bands are door-to-door, day picker is a weekday selector
(matches what the data actually models), honesty footer with ODbL
attribution and known gaps.

### Stage 1 — Research (done 2026-08-29, tag stage-01)

Full findings + sources in `docs/research.md`. Executive summary:

- **Kolkata: no feed exists** — proven negative (catalog zero + GitHub sweep:
  one empty scaffold repo, one single-metro-line toy with a fake agency URL).
  Fallback ladder engaged per the brief.
- **Delhi: rejected on license.** OTD terms reserve DoT copyright, permission
  is discretionary/purpose-scoped, modification is a stated violation — and
  OTD's own docs admit bus stop_times are synthetic (constant-speed
  estimates). The only no-signup mirror expired 2024-01-01 with no shapes.
- **City = Chennai** (`ungalsoththu/ChennaiGTFS` unified MTC bus + CMRL
  metro): the only candidate with an explicit open license (**ODbL**) and a
  calendar valid today (2024→2030). 5,625 stops / 47,149 trips / 1.36M
  stop_times. Defects logged for the pipeline: 146 malformed rows (0.01%),
  a `"test "` service to evaluate in the spike, headway-derived CMRL times,
  feed_info/calendar window mismatch — all disclosed, never filled.
- **Bengaluru (BMTC) = runner-up**: zero validator errors, freshest calendar,
  but no license on the repo → cannot cleanly redistribute a derived artifact.
- **Basemap: OpenFreeMap positron** primary (keyless, no limits, production
  OK), self-hosted PMTiles Chennai extract as fallback, graticule as tertiary.
- **Vercel Hobby facts that shaped the design:** `.bin` is never compressed
  (MIME allowlist) and self-served `Content-Encoding` is unreliable → the
  artifact ships as an opaque `.bin.gz` inflated in-browser via
  `DecompressionStream('gzip')`. No total deployment cap; 100 MB/file; 100 GB
  bandwidth with pause-not-bill overage; functions capped at 4.5 MB response
  (moot — zero functions on the hot path).
- Validator runs (official gtfs-validator v8.0.1, local Java 17): Delhi
  archive 8 ERRORs; **BMTC-2595 0 ERRORs**; BMTC-2013 38,893 ERRORs;
  Chennai 149 ERRORs (row-level, skippable). Reports in
  `pipeline/.cache/validator/`.
