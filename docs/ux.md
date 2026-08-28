# ReachMap — UX specification

**Stage 4 · UX Designer · 2026-08-29**

Companion artifacts (published for review; sources in `docs/design/`):
**Wireframes** (flows + layout skeletons) and **Hi-fi mockup** (visual target
for stage 10). The hi-fi mockup is the reference for look-and-feel; this
document is the reference for behavior. Where they conflict, this document
wins.

---

## 1. Design stance

The map is the product; everything else is an instrument panel on top of it.
No page chrome, no hero section, no dashboard grid — one full-viewport map,
one control card, one brand chip. The personality lives in three choices:

1. **The "Marina sunset" band ramp** — travel time rendered as four nested
   rings: marigold (≤15) → vermilion (≤30) → silk magenta (≤45) → deep
   violet (≤60). Monotonically darkening, so the eye reads "brighter =
   closer" without the legend. Deliberately not the blue/teal every
   isochrone demo uses.
2. **One type family, three cuts** (IBM Plex): Sans Condensed for the
   brand/headings (bus-signage feel), Sans for UI copy, **Mono for every
   number** — times, coordinates, counts. Numbers are data; they dress like
   data. (Plex also ships a Tamil companion — a real path to a bilingual UI
   later.)
3. **The dial** — the signature element: one bottom-left card fusing the
   day picker, the departure-time readout/slider, and the band legend into a
   single instrument. The legend *is* the time scale: a four-segment ruler,
   0→60 min. There is no separate legend box anywhere.

## 2. User flows

### F1 — First load (zero interaction)
1. Page paints: basemap + **default isochrone already rendered** (Chennai
   Central, Tuesday 08:30 IST) with the origin pin planted.
2. The dial shows the defaults; a one-line hint sits above it:
   **"Tap anywhere on the map to move the origin."**
3. Engine (timetable artifact) loads in the background — see States.

### F2 — Move the origin
1. Click/tap anywhere on the map → pin moves there instantly; bands fade to
   35% opacity while the worker computes (typically < 150 ms).
2. New bands crossfade in (~200 ms). The dial's readout row updates:
   origin coordinates (mono, 4 decimals) and "≈ N stops reachable in 60 min".
3. Clicking a transit desert still works: bands collapse to the walk-only
   disc and the readout says **"Walk-only from here — no stop within 800 m."**
   Never an error state; an honest small answer.

### F3 — Change departure time
1. Drag the time slider (00:00–23:59, 5-min steps) or type into the
   HH:MM field (minute precision). Day chips: single-select Mon–Sun.
2. Recompute on release / valid entry, same fade-crossfade as F2.
3. Sundays run slightly thinner service (the feed's HSC trips pause) — no
   special UI, the bands simply tell the truth.

### F4 — Read the bands
1. Hovering a ruler segment (desktop) dims the other three rings to 15%
   opacity — instant "which ring is 30 min?" answer. Touch: tapping a
   segment toggles the same highlight.
2. The rings themselves are non-interactive (no click targets over the map's
   click-to-set-origin surface).

## 3. Layout

### Desktop (≥ 768 px)

```
┌──────────────────────────────────────────────────────┐
│ ┌───────────────┐                        (map, full) │
│ │ ReachMap      │                                    │
│ │ Chennai·bus+metro │                            ◎ ← origin pin
│ └───────────────┘        ~ nested bands ~            │
│                                                      │
│ ┌─ THE DIAL ────────────────┐                        │
│ │ M T W T F S S   (chips)   │                        │
│ │ depart  08:30  [slider]   │                        │
│ │ █15█ █30█ █45█ █60█ ruler │                        │
│ │ 13.0827,80.2757 · ≈2.9k stops │                    │
│ └───────────────────────────┘   © attribution (btm-r)│
└──────────────────────────────────────────────────────┘
```

- Brand chip top-left: wordmark + "Chennai · MTC bus + CMRL metro".
- The dial bottom-left, 320 px wide, never overlapping attribution.
- Attribution bottom-right (MapLibre default control), always visible —
  includes feed credit: "Transit data © UngalSoththu (ODbL)".

### Mobile (< 768 px)

- The dial becomes a **bottom sheet**: collapsed state is one row —
  `Tue · 08:30 · [mini ruler]` — with a drag handle; expanding reveals day
  chips + slider + readout. Collapsed by default after first interaction.
- Brand chip shrinks to the wordmark. Hint appears once, dismissed on first
  map tap.
- Map interactions: single tap = set origin; pinch/drag = navigate (no
  long-press semantics). Controls sit in the thumb zone; nothing within
  16 px of screen edges except the sheet itself.

## 4. States

| State | Treatment |
|---|---|
| Engine loading (tier 3) | Dial shows a slim progress line: "Loading timetable · 4.9 MB" with real progress. Map fully interactive for pan/zoom; clicks queue (pin drops immediately, bands render when ready — determinate spinner ring around the pin). |
| Computing | Bands at 35% opacity + pin pulse (≤ 150 ms typical, so this mostly isn't seen). Respect `prefers-reduced-motion`: no pulse, opacity step only. |
| Transit desert | Walk-only disc + readout line as in F2.3. |
| Basemap outage | Style falls back per research (PMTiles extract → graticule). Bands and controls unaffected. A quiet toast: "Base map unavailable — showing reachability only." |
| Data note | An ⓘ button on the dial opens a small panel: feed name/version/date, ODbL attribution, known gaps (community feed, headway-derived metro times, no suburban rail, N skipped rows), and the walking-model constants. Honesty is a feature. |

## 5. Design tokens

```
Color
  --ink        #1B1B2F   text, pin, chart axis
  --paper      #FBF9F5   card surfaces (warm white)
  --map-base   positron gray (from style)
  --band-15    #FFB300   marigold      fill 44% / ring line 90%
  --band-30    #F4511E   vermilion     fill 40% / ring line 90%
  --band-45    #C2185B   silk magenta  fill 36% / ring line 90%
  --band-60    #4527A0   deep violet   fill 30% / ring line 90%
  --accent     #00897B   CMRL teal — links, focus ring, ⓘ affordances only
  --muted      #6E6E85   secondary text
Bands render as *rings* (set-difference), light-to-dark outward, each with a
1.5 px darker stroke of its own hue; overlap ambiguity never arises.

Type (self-hosted via next/font in production)
  display  IBM Plex Sans Condensed 600/700 — wordmark, sheet titles
  ui       IBM Plex Sans 400/500/600 — labels, copy, chips
  data     IBM Plex Mono 500 — HH:MM readout (28 px), coords, counts, ruler numerals
  scale    12 / 13 / 15 / 20 / 28 px; line-height 1.4 UI, 1.0 data readout

Space & shape
  spacing unit 4 px; card padding 16 px; card radius 14 px; chip radius full
  shadow: 0 2px 12px rgba(27,27,47,.14) — one elevation, cards only
  focus: 2 px --accent outline, 2 px offset, never removed

Motion
  band crossfade 200 ms ease-out; sheet 240 ms; pin pulse 1 s loop
  all gated by prefers-reduced-motion (fallback: opacity steps, no loops)
```

## 6. Accessibility

- Every control keyboard-reachable: chips are radiogroup arrows-navigable;
  slider has arrow-key steps (5 min) + Home/End; time field is a real
  `<input>`; the map container documents its interaction
  (`aria-label="Map. Use the search-free controls; click to set origin"`).
- Band colors are never the only channel: the ruler carries numeric labels;
  the readout states the 60-min stop count in text.
- Contrast: ink on paper 14.9:1; muted on paper 4.6:1; white on band-60
  ring 8.6:1. All AA+.
- `aria-live="polite"` on the readout row announces recompute results.
- Hit targets ≥ 44 px on touch.

## 7. Out of scope for stage 10 (recorded for later)

- Cursor travel-time readout (hover shows "≈ 37 min" sampled from the grid
  field) — cheap and delightful; build if stage-12 perf budget allows.
- URL-encoded view state for sharing; bilingual (Tamil) labels via Plex Tamil.
