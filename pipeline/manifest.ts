/** Pure manifest assembly (docs/contracts.md §2) — unit-testable, no I/O. */
import type { CityConfig } from "../config/city";
import type { Manifest } from "../src/engine/types";
import type { CompiledFeed } from "./compile";
import type { ValidatorSummary } from "./validate";

export interface ManifestInputs {
  cfg: CityConfig;
  compiled: CompiledFeed;
  configHash: string;
  artifact: { name: string; gzBytes: number; rawBytes: number; sha256: string };
  stopNames: { name: string; bytes: number; sha256: string };
  defaultIso: { name: string; bytes: number; sha256: string } | null;
  poster: { name: string; width: number; height: number } | null;
  feed: { version: string; downloadedAt: string; sha256: string };
  validator: ValidatorSummary | null;
  builtAt: string;
  git: string;
}

export function assembleManifest(m: ManifestInputs): Manifest {
  const { cfg, compiled } = m;
  const base = `/data/${cfg.id}`;
  return {
    version: 1,
    city: cfg.id,
    cityName: cfg.name,
    subtitle: cfg.subtitle,
    timezone: cfg.timezone,
    tzLabel: cfg.tzLabel,
    artifact: {
      url: `${base}/${m.artifact.name}`,
      gzBytes: m.artifact.gzBytes,
      rawBytes: m.artifact.rawBytes,
      sha256: m.artifact.sha256,
    },
    stopNames: {
      url: `${base}/${m.stopNames.name}`,
      bytes: m.stopNames.bytes,
      sha256: m.stopNames.sha256,
    },
    defaultIsochrone: m.defaultIso
      ? { url: `${base}/${m.defaultIso.name}`, bytes: m.defaultIso.bytes, sha256: m.defaultIso.sha256 }
      : null,
    poster: m.poster
      ? { url: `${base}/${m.poster.name}`, width: m.poster.width, height: m.poster.height }
      : null,
    map: { styleUrl: cfg.mapStyleUrl, styleFallback: cfg.mapStyleFallback },
    dataNotes: cfg.dataNotes,
    horizonSec: compiled.horizonSec,
    counts: compiled.counts,
    skipped: compiled.skipped,
    feed: {
      name: cfg.feed.name,
      publisher: cfg.feed.publisher,
      attributionHtml: cfg.feed.attributionHtml,
      sourceUrl: cfg.feed.url,
      license: cfg.feed.license,
      licenseUrl: cfg.feed.licenseUrl,
      version: m.feed.version,
      downloadedAt: m.feed.downloadedAt,
      sha256: m.feed.sha256,
      calendarStart: compiled.feedCalendar.start,
      calendarEnd: compiled.feedCalendar.end,
      validator: m.validator
        ? {
            tool: m.validator.tool,
            version: m.validator.version,
            errors: m.validator.errors,
            warnings: m.validator.warnings,
          }
        : null,
    },
    calendar: compiled.calendar,
    walking: cfg.walking,
    bands: cfg.bands,
    grid: { cellM: cfg.gridCellM },
    bbox: compiled.bbox,
    defaultView: cfg.defaultView,
    build: { at: m.builtAt, configHash: m.configHash, git: m.git },
  };
}

/** The exact file set a build may leave in the output dir (everything else is pruned). */
export function keepSet(manifest: Manifest): Set<string> {
  const names = new Set<string>(["manifest.json"]);
  const tail = (url: string) => url.split("/").pop()!;
  names.add(tail(manifest.artifact.url));
  names.add(tail(manifest.stopNames.url));
  if (manifest.defaultIsochrone) names.add(tail(manifest.defaultIsochrone.url));
  if (manifest.poster) names.add(tail(manifest.poster.url));
  return names;
}
