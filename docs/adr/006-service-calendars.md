# ADR-006: Per-weekday trip bitsets + raw >24:00 times

**Status:** Accepted · **Date:** 2026-08-29 · **Deciders:** Architect (stage 5)

## Context

The picker selects a weekday + time, not a date (PRD). The Chennai calendar
holds 9 service rows, only two of which carry trips (`Regular` 46,973 all
days; `HSC` 74 Mon–Sat); two are junk (`"test "`, an XSS-payload id) with
zero trips; windows differ per service. 1,780 connections depart ≥ 24:00 —
after-midnight service is real. GTFS times are service-day-relative and may
exceed 24:00:00.

## Decision

- **Build time:** expand calendar.txt (+calendar_dates.txt when present)
  over the validity window; for each weekday pick the first occurrence **on
  or after `config.referenceDate`** as the representative date (recorded in
  the manifest). Anchoring to a config value rather than the build clock
  keeps builds byte-reproducible (ADR-003): an unchanged feed + unchanged
  config rebuilds to identical bytes on any day. The build still hard-fails
  if `referenceDate` falls outside the feed validity window; emit
  **7 per-weekday active-trip bitsets** (7 × ⌈47,047/8⌉ ≈ 41 KB) baked into
  the artifact. Service ids never ship — they are provenance, in the
  manifest only, sanitized.
- **Times stay raw**: seconds since service-day midnight, values > 86,400
  preserved end-to-end.
- **Query time:** the scan covers two stored-time windows — `[T, T+3600)`
  against `bits[weekday]` (today) and `[T+86400, T+90000)` against
  `bits[(weekday+6) % 7]` (yesterday's >24:00 service, modular so Monday
  reads Sunday) — **merged into ONE ascending pass by effective departure
  time** (`depTime` vs `depTime − 86400`), two cursors, each frame with its
  own trip-boarded flags. Two sequential passes would break CSA's
  non-decreasing-departure invariant: an arrival produced by yesterday's
  29:15 trip at effective 05:20 must still be able to board today's 05:30
  connection. Yesterday's 25:10 trip is thus correctly visible to a 01:10
  query with zero normalization, *and* its riders can transfer onward.
- **Staleness guards (hard build failures):** build date outside feed
  validity; any weekday's active-trip count < 30% of the max weekday.

## Options Considered

| Option | Verdict |
|---|---|
| Weekday bitsets (chosen) | O(1) per-connection activity test; whole calendar = 41 KB; junk services vanish naturally (zero trips ⇒ zero bits) |
| Ship services + resolve in client | More moving parts in the worker, ships attacker-controlled service-id strings; rejected |
| Normalize >24:00 to next-day 01:10 | Duplicates trips across day boundaries or time-travels — the classic transit bug class; rejected |
| Modal service set per weekday | Designed for holiday-polluted calendars; this feed's windows are uniform so next-occurrence ≡ modal here. Kept as the documented upgrade path if a future feed has calendar_dates exceptions |

## Consequences

- Easier: day handling costs 41 KB, junk services need no special-casing,
  after-midnight correctness is testable with fixtures (including the two
  regression cases the adversarial review demanded: Monday-01:10 reading
  Sunday's bitset, and a yesterday-arrival transferring to a today-departure).
- Harder: date-specific exceptions (a holiday Tuesday) are out of scope by
  design — the PRD's weekday picker states exactly what the data models.
- Revisit if: a feed with heavy calendar_dates exceptions is adopted
  (switch representative-date to modal-set resolution).
