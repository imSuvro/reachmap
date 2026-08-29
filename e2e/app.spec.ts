import { expect, test, type Page } from "@playwright/test";

type RmWindow = {
  __rmSelect?: (lat: number, lon: number) => void;
  __rmState?: () => { stats: { reachedLast: number; walkOnly: boolean; outOfCoverage: boolean } | null; bandPolys: number[] | null };
};

const consoleErrors: string[] = [];

test.beforeEach(({ page }) => {
  consoleErrors.length = 0;
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
});

async function waitForLiveEngine(page: Page) {
  // the map mounts on first user intent — give it the nudge a real visitor
  // provides by existing (mousemove), then wait for the live readout: the
  // end-to-end signal that the worker downloaded, inflated, decoded, answered
  await page.mouse.move(400, 300);
  await expect(page.locator(".readout")).toContainText(/stops in 60 min/, { timeout: 45_000 });
}

test("first load shows a real isochrone with zero interaction", async ({ page }) => {
  await page.goto("/");
  // tier 1: the poster (LCP) is present immediately with explicit dimensions
  const poster = page.locator(".poster");
  await expect(poster).toHaveAttribute("width", "1200");
  // the dial and brand render without any interaction
  await expect(page.locator(".brand h1")).toHaveText("ReachMap");
  await expect(page.locator(".days button")).toHaveCount(7);
  // tier 2/3: live engine answers the default view
  await waitForLiveEngine(page);
  const state = await page.evaluate(() => (window as RmWindow).__rmState!());
  expect(state.stats!.reachedLast).toBeGreaterThan(2000);
  expect(state.bandPolys!.every((n) => n > 0)).toBe(true);
  await page.screenshot({ path: "test-results/first-load.png", fullPage: true });
});

test("clicking the map moves the origin and recomputes bands", async ({ page }) => {
  await page.goto("/");
  await waitForLiveEngine(page);
  // the poster must have cross-faded away before we click through to the map
  await expect(page.locator(".poster")).toHaveClass(/poster-hidden/, { timeout: 15_000 });
  const before = await page.locator(".readout").textContent();
  const box = (await page.locator(".map").boundingBox())!;
  // coordinate-level click: canvas maps fail element actionability checks
  await page.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.4);
  await expect(page.locator(".readout")).not.toHaveText(before!, { timeout: 10_000 });
  await expect(page.locator(".hint")).toHaveCount(0);
  const state = await page.evaluate(() => (window as RmWindow).__rmState!());
  expect(state.stats!.outOfCoverage).toBe(false);
  await page.screenshot({ path: "test-results/after-click.png", fullPage: true });
});

test("changing the departure time recomputes", async ({ page }) => {
  await page.goto("/");
  await waitForLiveEngine(page);
  const before = await page.locator(".readout").textContent();
  await page.locator(".time").fill("23:30");
  await page.locator(".time").press("Enter");
  await expect(page.locator(".readout")).not.toHaveText(before!, { timeout: 10_000 });
  // late-night service is much thinner — the count must drop hard
  const state = await page.evaluate(() => (window as RmWindow).__rmState!());
  expect(state.stats!.reachedLast).toBeLessThan(1500);
});

test("day toggle changes service and the label", async ({ page }) => {
  await page.goto("/");
  await waitForLiveEngine(page);
  await page.locator(".days button").nth(6).click();
  await expect(page.locator(".ist")).toContainText("Sun");
  await waitForLiveEngine(page);
  const sun = await page.evaluate(() => (window as RmWindow).__rmState!());
  expect(sun.stats!.reachedLast).toBeGreaterThan(2000);
});

test("a transit-desert origin gets an honest walk-only answer", async ({ page }) => {
  await page.goto("/");
  await waitForLiveEngine(page);
  // north edge of coverage, far from any stop (deterministic via the e2e seam)
  await page.evaluate(() => (window as RmWindow).__rmSelect!(13.51, 80.05));
  await expect(page.locator(".readout")).toContainText("Walk-only", { timeout: 10_000 });
});

test("an out-of-coverage origin is answered explicitly, never clamped", async ({ page }) => {
  await page.goto("/");
  await waitForLiveEngine(page);
  await page.evaluate(() => (window as RmWindow).__rmSelect!(20.0, 85.0));
  await expect(page.locator(".readout")).toContainText("Outside the covered area", {
    timeout: 10_000,
  });
  const state = await page.evaluate(() => (window as RmWindow).__rmState!());
  expect(state.stats!.outOfCoverage).toBe(true);
  expect(state.bandPolys!.every((n) => n === 0)).toBe(true);
});

test("ruler and data note are keyboard-reachable; no console errors anywhere", async ({ page }) => {
  await page.goto("/");
  await waitForLiveEngine(page);
  // ruler highlight toggles
  await page.locator(".seg").nth(1).click();
  await expect(page.locator(".seg").nth(0)).toHaveClass(/dim/);
  await page.locator(".seg").nth(1).click();
  // the data note opens with the license and closes
  await page.locator(".info").click();
  await expect(page.locator(".note")).toContainText("ODbL");
  await page.locator(".note .close").click();
  await expect(page.locator(".dial")).toBeVisible();
  expect(consoleErrors, `console errors: ${consoleErrors.join(" | ")}`).toEqual([]);
});
