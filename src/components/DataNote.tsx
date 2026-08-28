"use client";
/** The ⓘ panel: provenance, license, known gaps, model constants — honesty
 *  as a feature (docs/ux.md §4). Feed strings render as TEXT; the one
 *  trusted-HTML field is the developer-authored attribution. */
import type { Manifest } from "../engine/types";

export function DataNote({ manifest, onClose }: { manifest: Manifest; onClose(): void }) {
  const f = manifest.feed;
  const skippedTotal =
    manifest.skipped.stopRows +
    manifest.skipped.tripRows +
    manifest.skipped.stopTimeRows +
    manifest.skipped.danglingRefs;
  return (
    <aside className="note" aria-label="About this data">
      <h2>About this data</h2>
      <p className="mono">
        {f.name} · {f.version ? `v${f.version} · ` : ""}
        {f.license}
      </p>
      <p dangerouslySetInnerHTML={{ __html: f.attributionHtml }} />
      <ul>
        {manifest.dataNotes.map((n, i) => (
          <li key={i}>{n}</li>
        ))}
        {skippedTotal > 0 && (
          <li>
            {skippedTotal.toLocaleString("en-IN")} malformed feed rows were skipped during the
            build (of {manifest.counts.connections.toLocaleString("en-IN")} connections kept).
          </li>
        )}
      </ul>
      <p className="mono small">
        timetable {f.calendarStart} → {f.calendarEnd} · built {manifest.build.at.slice(0, 10)} ·{" "}
        {manifest.counts.stops.toLocaleString("en-IN")} stops ·{" "}
        {manifest.counts.trips.toLocaleString("en-IN")} trips
      </p>
      <button className="close" onClick={onClose}>
        Close
      </button>
    </aside>
  );
}
