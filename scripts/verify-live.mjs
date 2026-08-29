/**
 * Stage-13 production verification: drives the LIVE deployment and proves
 * isochrones render from three distinct origins (the goal condition), plus
 * the serving-contract spot checks. Screenshots land in test-results/.
 *
 *   node scripts/verify-live.mjs [base-url]     (default https://reachmap.vercel.app)
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.argv[2] ?? "https://reachmap.vercel.app";
const ORIGINS = [
  { name: "chennai-central", lat: 13.0827, lon: 80.2757, label: "Chennai Central (default)" },
  { name: "t-nagar", lat: 13.0418, lon: 80.2341, label: "T. Nagar" },
  { name: "tambaram", lat: 12.9249, lon: 80.1, label: "Tambaram" },
];

mkdirSync("test-results", { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));

let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed = true;
};

console.log(`verifying ${BASE}\n`);
await page.goto(BASE, { waitUntil: "load" });
await page.mouse.move(500, 300); // first intent mounts the map

// live engine answers the default view
await page.waitForFunction(
  () => document.querySelector(".readout")?.textContent?.includes("stops in 60 min"),
  null,
  { timeout: 60000 },
);
await page.waitForFunction(
  () => document.querySelector(".poster")?.classList.contains("poster-hidden"),
  null,
  { timeout: 20000 },
);
// let tiles + rings settle for honest screenshots
await page.waitForTimeout(2500);

for (const [i, o] of ORIGINS.entries()) {
  if (i > 0) {
    await page.evaluate(([lat, lon]) => window.__rmSelect(lat, lon), [o.lat, o.lon]);
    await page.waitForFunction(
      (frag) => document.querySelector(".readout")?.textContent?.includes(frag),
      o.lat.toFixed(4),
      { timeout: 15000 },
    );
    await page.waitForTimeout(1500);
  }
  const state = await page.evaluate(() => window.__rmState());
  const readout = await page.evaluate(() => document.querySelector(".readout")?.textContent);
  const bandsOk = state.bandPolys && state.bandPolys.every((n) => n > 0);
  check(
    `origin ${o.label}: isochrone renders`,
    Boolean(state.stats && !state.stats.outOfCoverage && state.stats.reachedLast > 100 && bandsOk),
    `${state.stats?.reachedLast} stops, bands ${state.bandPolys?.join("/")}`,
  );
  console.log(`      readout: ${readout?.slice(0, 60)}`);
  await page.screenshot({ path: `test-results/live-${o.name}.png` });
}

check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));

// serving-contract spot checks on the live edge
const manifest = await (await fetch(`${BASE}/data/chennai/manifest.json`)).json();
const artUrl = `${BASE}${manifest.artifact.url}`;
const head = await fetch(artUrl, { method: "HEAD" });
check(
  "artifact served opaque + immutable",
  head.status === 200 &&
    head.headers.get("content-encoding") === null &&
    (head.headers.get("cache-control") ?? "").includes("immutable"),
  `${head.status} ce=${head.headers.get("content-encoding")} cc=${head.headers.get("cache-control")}`,
);
const range = await fetch(artUrl, { headers: { Range: "bytes=0-16383" } });
check("Range request answers 206", range.status === 206, `status ${range.status} (ADR-008 precondition)`);
const poster = await fetch(`${BASE}${manifest.poster.url}`, { method: "HEAD" });
check("poster served", poster.status === 200);

await browser.close();
console.log(failed ? "\nLIVE VERIFICATION FAILED" : "\nLIVE VERIFICATION PASSED");
process.exit(failed ? 1 : 0);
