/**
 * Size budgets (ADR-003/004/007). Exits non-zero on any breach — wired into
 * CI so a regressing artifact fails the pipeline, never ships silently.
 */
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(process.cwd(), "public", "data", "chennai");
const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));

const checks = [];
const file = (url) => join(dir, url.split("/").pop());

// contract-completeness FIRST: a partial build must fail this check, not
// crash on a null dereference below it
const complete = manifest.defaultIsochrone !== null && manifest.poster !== null;
checks.push(["manifest is contract-complete (no null sidecars)", complete]);
checks.push(["artifact gz <= 8 MB", statSync(file(manifest.artifact.url)).size <= 8e6]);
checks.push(["stopnames <= 500 KB", statSync(file(manifest.stopNames.url)).size <= 500e3]);
if (complete) {
  checks.push(["default-iso <= 300 KB", statSync(file(manifest.defaultIsochrone.url)).size <= 300e3]);
  checks.push(["poster <= 100 KB", statSync(file(manifest.poster.url)).size <= 100e3]);
}
checks.push([
  "output dir holds exactly the referenced set",
  readdirSync(dir).length === 5,
]);

let ok = true;
for (const [name, pass] of checks) {
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  if (!pass) ok = false;
}
process.exit(ok ? 0 : 1);
