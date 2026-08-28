/**
 * The ONE city-specific file (ADR-009). The pipeline, engine tests, and
 * poster renderer read this directly; the browser never imports it —
 * everything the client needs ships in the generated manifest
 * (docs/contracts.md §2).
 */

export interface CityConfig {
  /** artifact directory name under public/data/ */
  id: string;
  name: string;
  subtitle: string;
  feed: {
    url: string;
    name: string;
    publisher: string;
    license: string;
    licenseUrl: string;
    /** developer-authored, trusted HTML (the one sanitization-exempt string) */
    attributionHtml: string;
  };
  timezone: string;
  tzLabel: string;
  /**
   * ISO date anchoring representative weekdays (ADR-006). Part of the
   * config hash: builds are a pure function of (feed bytes, this config),
   * never of the build clock.
   */
  referenceDate: string;
  defaultView: { lat: number; lon: number; weekday: number; depSec: number; zoom: number };
  walking: { speedMps: number; detour: number; transferRadiusM: number; minTransferSec: number };
  /** band thresholds in seconds, ascending; scan horizon = max(bands) */
  bands: number[];
  /** isochrone raster cell size (ADR-004) */
  gridCellM: number;
  /** spatial-bucket index cell size (contract §1) */
  indexCellM: number;
  mapStyleUrl: string;
  mapStyleFallback: string | null;
  /** evidence-based service exclusions; logged in manifest.skipped */
  excludeServiceIds: string[];
  /**
   * gtfs-validator ERROR codes accepted for this feed because the pipeline
   * deterministically skips-and-counts the offending rows. Any other ERROR
   * fails the build.
   */
  validatorErrorAllowlist: string[];
  /** rendered verbatim (as text) in the ⓘ data note */
  dataNotes: string[];
}

export const city: CityConfig = {
  id: "chennai",
  name: "Chennai",
  subtitle: "MTC bus + CMRL metro",
  feed: {
    url: "https://raw.githubusercontent.com/ungalsoththu/ChennaiGTFS/main/data/chennai-unified-gtfs.zip",
    name: "chennai-unified-gtfs",
    publisher: "UngalSoththu / Ithu Ungal Soththu",
    license: "ODbL",
    licenseUrl: "https://opendatacommons.org/licenses/odbl/",
    attributionHtml:
      'Transit data © <a href="https://github.com/ungalsoththu/ChennaiGTFS" target="_blank" rel="noopener">UngalSoththu</a> (ODbL)',
  },
  timezone: "Asia/Kolkata",
  tzLabel: "IST",
  referenceDate: "2026-09-01",
  defaultView: { lat: 13.0827, lon: 80.2757, weekday: 1, depSec: 30600, zoom: 11 },
  walking: { speedMps: 1.33, detour: 1.3, transferRadiusM: 300, minTransferSec: 60 },
  bands: [900, 1800, 2700, 3600],
  gridCellM: 200,
  indexCellM: 500,
  mapStyleUrl: "https://tiles.openfreemap.org/styles/positron",
  mapStyleFallback: null,
  excludeServiceIds: [],
  validatorErrorAllowlist: ["invalid_row_length", "invalid_integer"],
  dataNotes: [
    "Unofficial community feed: MTC data collected from the MTC mobile app; CMRL schedules derived from published headways.",
    "Suburban rail is not included.",
    "Door-to-door times assume 4.8 km/h walking with a 1.3 detour factor; transfers up to 300 m.",
    "A small number of malformed feed rows are skipped; exact counts are in the build manifest.",
  ],
};
