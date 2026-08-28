"use client";
/** The dial (docs/ux.md §1.3): day chips + departure readout/slider + the
 *  band ruler that doubles as the legend + readout row. Mobile: bottom sheet. */
import { useCallback, useId, useState } from "react";
import type { EngineUiState } from "./App";

const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export interface DialProps {
  bands: number[];
  tzLabel: string;
  weekday: number;
  depSec: number;
  onChange(weekday: number, depSec: number): void;
  highlight: number;
  onHighlight(i: number): void;
  engineState: EngineUiState;
  artifactMb: number;
  readout: { coords: string; note: string };
  onInfo(): void;
}

function hhmm(depSec: number): string {
  const h = Math.floor(depSec / 3600);
  const m = Math.floor((depSec % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function Dial(p: DialProps) {
  const sliderId = useId();
  const [expanded, setExpanded] = useState(true);
  const [timeText, setTimeText] = useState<string | null>(null);

  const commitTime = useCallback(
    (text: string) => {
      setTimeText(null);
      const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
      if (!m) return;
      const h = Number(m[1]);
      const min = Number(m[2]);
      if (h > 23 || min > 59) return;
      p.onChange(p.weekday, h * 3600 + min * 60);
    },
    [p],
  );

  const loading = p.engineState.phase === "loading" || p.engineState.phase === "decoding";
  const pct =
    p.engineState.total > 0 ? Math.round((p.engineState.loaded / p.engineState.total) * 100) : 0;

  return (
    <section className={`dial${expanded ? "" : " collapsed"}`} aria-label="Departure controls and legend">
      <button
        className="sheet-handle"
        aria-label={expanded ? "Collapse controls" : "Expand controls"}
        onClick={() => setExpanded((v) => !v)}
      />
      <div className="days" role="radiogroup" aria-label="Day of week">
        {DAY_LABELS.map((d, i) => (
          <button
            key={i}
            role="radio"
            aria-checked={p.weekday === i}
            aria-label={DAY_NAMES[i]}
            className={p.weekday === i ? "on" : ""}
            onClick={() => p.onChange(i, p.depSec)}
          >
            {d}
          </button>
        ))}
      </div>
      <div className="timerow">
        <label htmlFor={sliderId}>Depart</label>
        <input
          className="time"
          value={timeText ?? hhmm(p.depSec)}
          onChange={(e) => setTimeText(e.target.value)}
          onBlur={(e) => commitTime(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitTime((e.target as HTMLInputElement).value);
          }}
          inputMode="numeric"
          aria-label="Departure time (HH:MM)"
        />
        <span className="ist">
          {p.tzLabel} · {DAY_NAMES[p.weekday]}
        </span>
      </div>
      <div className="sliderwrap">
        <input
          id={sliderId}
          className="slider"
          type="range"
          min={0}
          max={1435}
          step={5}
          value={Math.round(p.depSec / 60)}
          onChange={(e) => p.onChange(p.weekday, Number(e.target.value) * 60)}
          aria-label="Departure time"
          aria-valuetext={`${hhmm(p.depSec)} ${p.tzLabel}`}
        />
      </div>
      <div className="ruler" aria-label="Travel-time bands, minutes">
        {p.bands.map((b, i) => (
          <button
            key={b}
            className={`seg seg-${i}${p.highlight !== -1 && p.highlight !== i ? " dim" : ""}`}
            onMouseEnter={() => p.onHighlight(i)}
            onMouseLeave={() => p.onHighlight(-1)}
            onClick={() => p.onHighlight(p.highlight === i ? -1 : i)}
            aria-label={`Highlight the ${Math.round(b / 60)}-minute band`}
          >
            {Math.round(b / 60)}
          </button>
        ))}
      </div>
      {loading && (
        <div className="progress" role="status">
          <span
            className="progress-bar"
            style={{ width: `${p.engineState.phase === "loading" ? pct : 100}%` }}
          />
          <span className="progress-text">
            {p.engineState.phase === "loading"
              ? `Loading timetable · ${p.artifactMb.toFixed(1)} MB · ${pct}%`
              : "Preparing the network…"}
          </span>
        </div>
      )}
      {p.engineState.phase === "failed" && (
        <div className="progress error" role="alert">
          Timetable failed to load — reload the page to retry.
        </div>
      )}
      <div className="readout" aria-live="polite">
        <span>
          <span className="mono">{p.readout.coords}</span> · <b>{p.readout.note}</b>
        </span>
        <button className="info" onClick={p.onInfo} aria-label="About this data">
          i
        </button>
      </div>
    </section>
  );
}
