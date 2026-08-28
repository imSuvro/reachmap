/** Shared contract types (docs/contracts.md). Isomorphic: no Node imports. */

export type SectionType = "u8" | "u16" | "u32" | "i32" | "f32";

export interface SectionEntry {
  name: string;
  off: number; // byte offset from the start of the DATA REGION
  len: number; // byte length
  type: SectionType;
  enc: "raw";
}

export interface ArtifactCounts {
  stops: number;
  trips: number;
  connections: number;
  footpaths: number;
}

export interface SectionTable {
  sections: SectionEntry[];
  counts: ArtifactCounts;
  configHash: string;
}

export type TypedArray = Uint8Array | Uint16Array | Uint32Array | Int32Array | Float32Array;

export interface DecodedArtifact {
  counts: ArtifactCounts;
  configHash: string;
  sections: Map<string, TypedArray>;
}

export interface FileRef {
  url: string;
  bytes?: number;
  sha256?: string;
}

export interface Manifest {
  version: 1;
  city: string;
  cityName: string;
  subtitle: string;
  timezone: string;
  tzLabel: string;
  artifact: { url: string; gzBytes: number; rawBytes: number; sha256: string };
  stopNames: FileRef;
  defaultIsochrone: FileRef | null; // null only on a partial (pre-engine) build
  poster: { url: string; width: number; height: number } | null;
  map: { styleUrl: string; styleFallback: string | null };
  dataNotes: string[];
  horizonSec: number;
  counts: ArtifactCounts;
  skipped: {
    stopRows: number;
    tripRows: number;
    stopTimeRows: number;
    danglingRefs: number;
    negativeRides: number;
    clampedStops: number;
    excludedServices: string[];
  };
  feed: {
    name: string;
    publisher: string;
    attributionHtml: string;
    sourceUrl: string;
    license: string;
    licenseUrl: string;
    version: string;
    downloadedAt: string;
    sha256: string;
    calendarStart: string;
    calendarEnd: string;
    validator: { tool: string; version: string; errors: number; warnings: number } | null;
  };
  calendar: { representativeDates: string[]; activeTripsPerDay: number[] };
  walking: { speedMps: number; detour: number; transferRadiusM: number; minTransferSec: number };
  bands: number[];
  grid: { cellM: number };
  bbox: [number, number, number, number]; // coverage: stop bbox + walk-horizon pad
  defaultView: { lat: number; lon: number; weekday: number; depSec: number; zoom: number };
  build: { at: string; configHash: string; git: string };
}

/** Worker protocol (contract §3) */
export type WorkerIn =
  | { type: "init"; manifestUrl: string }
  | { type: "query"; id: number; lat: number; lon: number; weekday: number; depSec: number };

export interface BandFeature {
  type: "Feature";
  properties: { band: number }; // seconds, matches manifest.bands
  geometry: { type: "MultiPolygon"; coordinates: number[][][][] };
}

export interface BandCollection {
  type: "FeatureCollection";
  features: BandFeature[];
}

export interface QueryStats {
  reachedLast: number;
  walkOnly: boolean;
  outOfCoverage: boolean;
  computeMs: number;
}

export type WorkerOut =
  | { type: "progress"; phase: "download" | "decode"; loaded: number; total: number }
  | { type: "ready"; manifest: Manifest }
  | { type: "result"; id: number; geojson: BandCollection; stats: QueryStats }
  | { type: "error"; id?: number; message: string; fatal: boolean };
