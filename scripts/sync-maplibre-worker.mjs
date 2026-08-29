/**
 * MapLibre v6 computes its worker URL at runtime relative to import.meta.url,
 * which under webpack resolves into /_next/static/chunks/ — a 404. The map
 * then silently never fetches a single tile (the worker owns tile fetching).
 * Official fix: serve dist/maplibre-gl-worker.mjs (+ the shared module it
 * imports) as plain statics and point setWorkerUrl() at them. This script
 * runs as `prebuild`, so local and Vercel builds always serve the copies
 * matching the installed maplibre-gl version.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const pkg = require("maplibre-gl/package.json");
const dist = join(dirname(require.resolve("maplibre-gl/package.json")), "dist");
const out = join(process.cwd(), "public", "maplibre");
mkdirSync(out, { recursive: true });
for (const f of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(join(dist, f), join(out, f));
}
writeFileSync(join(out, "VERSION"), pkg.version + "\n");
const bytes = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]
  .map((f) => `${f} ${readFileSync(join(out, f)).length}B`)
  .join(", ");
console.log(`maplibre worker synced (v${pkg.version}): ${bytes}`);
