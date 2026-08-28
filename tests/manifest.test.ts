import { describe, expect, it } from "vitest";
import { compileFeed } from "../pipeline/compile";
import { assembleManifest, keepSet, type ManifestInputs } from "../pipeline/manifest";
import { baseFeed, testConfig } from "./fixture";

const cfg = testConfig();

function inputs(overrides: Partial<ManifestInputs> = {}): ManifestInputs {
  return {
    cfg,
    compiled: compileFeed(baseFeed(), cfg),
    configHash: "cfg-hash",
    artifact: { name: "timetable.abcd1234.bin.gz", gzBytes: 100, rawBytes: 300, sha256: "a".repeat(64) },
    stopNames: { name: "stopnames.ee11aa22.json", bytes: 10, sha256: "b".repeat(64) },
    defaultIso: null,
    poster: null,
    feed: { version: "v1", downloadedAt: "2026-08-30T00:00:00Z", sha256: "c".repeat(64) },
    validator: null,
    builtAt: "2026-08-30T00:00:00Z",
    git: "abc123",
    ...overrides,
  };
}

describe("assembleManifest", () => {
  it("emits contract-true URLs, ISO calendar dates, and explicit horizon", () => {
    const m = assembleManifest(inputs());
    expect(m.artifact.url).toBe("/data/testville/timetable.abcd1234.bin.gz");
    expect(m.stopNames.url).toBe("/data/testville/stopnames.ee11aa22.json");
    expect(m.feed.calendarStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(m.feed.calendarEnd).toBe("2026-12-31");
    expect(m.calendar.representativeDates).toHaveLength(7);
    expect(m.calendar.representativeDates[1]).toBe("2026-09-01"); // Tue anchor
    expect(m.horizonSec).toBe(3600);
    expect(m.defaultIsochrone).toBeNull();
    expect(m.poster).toBeNull();
    expect(m.map.styleUrl).toBe(cfg.mapStyleUrl);
    expect(m.dataNotes).toBe(cfg.dataNotes);
    expect(m.build.configHash).toBe("cfg-hash");
  });

  it("keepSet lists exactly the referenced files", () => {
    const partial = keepSet(assembleManifest(inputs()));
    expect([...partial].sort()).toEqual([
      "manifest.json",
      "stopnames.ee11aa22.json",
      "timetable.abcd1234.bin.gz",
    ]);
    const full = keepSet(
      assembleManifest(
        inputs({
          defaultIso: { name: "default-iso.11112222.geojson", bytes: 5, sha256: "d".repeat(64) },
          poster: { name: "poster.33334444.webp", width: 1200, height: 630 },
        }),
      ),
    );
    expect(full.has("default-iso.11112222.geojson")).toBe(true);
    expect(full.has("poster.33334444.webp")).toBe(true);
    expect(full.size).toBe(5);
  });
});
