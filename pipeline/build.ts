/**
 * Pipeline orchestrator: download -> validate -> compile -> emit artifacts.
 *
 *   pnpm build:data [--refresh] [--skip-validator]
 *
 * Output: public/data/<city>/ — committed to the repo (ADR-007: Vercel's
 * build is just `next build` over committed statics). Content-hashed files
 * are pruned to exactly the set the new manifest references.
 * When the engine sidecar module is present (stage 9+), also emits the
 * default isochrone + poster; until then writes a PARTIAL manifest (nulls).
 */
import { execSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { city } from "../config/city";
import { encodeContainer } from "../src/engine/container";
import { compileFeed } from "./compile";
import { downloadFeed, sha256Hex } from "./download";
import { runValidator, type ValidatorSummary } from "./validate";
import { readTable, splitCsv, sanitizeFeedString } from "./gtfs";
import { assembleManifest, keepSet } from "./manifest";

const args = new Set(process.argv.slice(2));
const OUT = join(import.meta.dirname, "..", "public", "data", city.id);

interface SidecarsModule {
  renderSidecars(
    artifact: ArrayBuffer,
    cfg: typeof city,
    bbox: [number, number, number, number],
  ): Promise<{ geojson: Uint8Array; poster: Uint8Array; width: number; height: number }>;
}

async function loadSidecarsModule(): Promise<SidecarsModule | null> {
  // non-literal specifier: the module arrives in stage 9; its absence is a
  // supported (partial-build) state, so TS must not resolve it statically.
  // Only the import itself is guarded — a FAILURE inside the module or its
  // renderer must fail the build loudly, never masquerade as "partial".
  const spec = "./" + "sidecars";
  try {
    return (await import(spec)) as SidecarsModule;
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (err.code === "ERR_MODULE_NOT_FOUND" && (err.message ?? "").includes("sidecars")) {
      return null;
    }
    throw e;
  }
}

async function main() {
  const t0 = performance.now();
  const log = (m: string) => console.log(`[${((performance.now() - t0) / 1000).toFixed(1)}s] ${m}`);

  const configHash = sha256Hex(new TextEncoder().encode(JSON.stringify(city)));

  log(`downloading feed: ${city.feed.url}`);
  const feed = await downloadFeed(city.feed.url, city.feed.name, args.has("--refresh"));
  log(`feed cached: ${(feed.bytes / 1e6).toFixed(1)} MB sha256 ${feed.sha256.slice(0, 12)}…`);

  let validator: ValidatorSummary | null = null;
  if (!args.has("--skip-validator")) {
    log("running gtfs-validator (Java)…");
    validator = await runValidator(feed.path, city.validatorErrorAllowlist);
    log(
      `validator: ${validator.errors} errors (all allowlisted: ${validator.allowlisted.join(", ") || "none"}), ${validator.warnings} warnings`,
    );
  } else {
    log("validator SKIPPED (--skip-validator)");
  }

  log("unzipping…");
  const zipped = unzipSync(readFileSync(feed.path));
  const files = new Map<string, string>();
  const dec = new TextDecoder();
  for (const [name, data] of Object.entries(zipped)) {
    if (name.endsWith(".txt")) files.set(name.split("/").pop()!, dec.decode(data));
  }

  log("compiling…");
  const compiled = compileFeed(files, city);
  log(
    `compiled: ${compiled.counts.stops} stops, ${compiled.counts.trips} trips, ` +
      `${compiled.counts.connections} connections, ${compiled.counts.footpaths} footpath edges`,
  );

  const raw = encodeContainer(compiled.sections, compiled.counts, configHash);
  const rawSha = sha256Hex(raw);
  const gz = gzipSync(raw, { level: 9 });
  const artifactName = `timetable.${rawSha.slice(0, 8)}.bin.gz`;
  log(
    `container: ${(raw.length / 1e6).toFixed(2)} MB raw -> ${(gz.length / 1e6).toFixed(2)} MB gz ` +
      `(${((gz.length / raw.length) * 100).toFixed(0)}%)`,
  );

  const stopNamesJson = new TextEncoder().encode(JSON.stringify({ names: compiled.stopNames }));
  const stopNamesName = `stopnames.${sha256Hex(stopNamesJson).slice(0, 8)}.json`;

  const sidecarsMod = await loadSidecarsModule();
  let defaultIso: { name: string; bytes: Uint8Array } | null = null;
  let poster: { name: string; bytes: Uint8Array; width: number; height: number } | null = null;
  if (sidecarsMod) {
    log("rendering default isochrone + poster…");
    const side = await sidecarsMod.renderSidecars(
      raw.buffer.slice(0) as ArrayBuffer,
      city,
      compiled.bbox,
    );
    defaultIso = {
      name: `default-iso.${sha256Hex(side.geojson).slice(0, 8)}.geojson`,
      bytes: side.geojson,
    };
    poster = {
      name: `poster.${sha256Hex(side.poster).slice(0, 8)}.webp`,
      bytes: side.poster,
      width: side.width,
      height: side.height,
    };
  } else {
    log("PARTIAL BUILD: pipeline/sidecars.ts absent (pre-engine stage) — defaultIsochrone/poster = null");
  }

  // feed_info version (optional file)
  const fi = readTable(files, "feed_info.txt");
  let feedVersion = "";
  if (fi && fi.lines.length > 0) {
    const f = splitCsv(fi.lines[0]!);
    if (fi.col.feed_version !== undefined) feedVersion = sanitizeFeedString(f[fi.col.feed_version] ?? "");
  }

  let git = "unknown";
  try {
    git = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    /* fine outside a repo */
  }

  const manifest = assembleManifest({
    cfg: city,
    compiled,
    configHash,
    artifact: { name: artifactName, gzBytes: gz.length, rawBytes: raw.length, sha256: rawSha },
    stopNames: {
      name: stopNamesName,
      bytes: stopNamesJson.length,
      sha256: sha256Hex(stopNamesJson),
    },
    defaultIso: defaultIso
      ? {
          name: defaultIso.name,
          bytes: defaultIso.bytes.length,
          sha256: sha256Hex(defaultIso.bytes),
        }
      : null,
    poster: poster ? { name: poster.name, width: poster.width, height: poster.height } : null,
    feed: { version: feedVersion, downloadedAt: feed.downloadedAt, sha256: feed.sha256 },
    validator,
    builtAt: new Date().toISOString(),
    git,
  });

  // ---- write output dir: exactly the referenced set ----
  mkdirSync(OUT, { recursive: true });
  const keep = keepSet(manifest);
  for (const f of readdirSync(OUT)) {
    if (!keep.has(f)) rmSync(join(OUT, f));
  }
  writeFileSync(join(OUT, artifactName), gz);
  writeFileSync(join(OUT, stopNamesName), stopNamesJson);
  if (defaultIso) writeFileSync(join(OUT, defaultIso.name), defaultIso.bytes);
  if (poster) writeFileSync(join(OUT, poster.name), poster.bytes);
  writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));

  log(`wrote ${OUT}:`);
  for (const f of readdirSync(OUT).sort()) {
    console.log(`    ${f}  ${(statSync(join(OUT, f)).size / 1024).toFixed(1)} KB`);
  }
  const sk = compiled.skipped;
  log(
    `skips: stops ${sk.stopRows}, trips ${sk.tripRows}, stop_times ${sk.stopTimeRows}, ` +
      `dangling ${sk.danglingRefs}, negative rides ${sk.negativeRides}, clamped ${sk.clampedStops}`,
  );
  log(`active trips per weekday: ${compiled.calendar.activeTripsPerDay.join(", ")}`);
  log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
