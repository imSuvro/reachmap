import { expect, test } from "@playwright/test";

test("mobile: the dial is a bottom sheet that collapses and expands", async ({ page }) => {
  await page.goto("/");
  await page.touchscreen.tap(200, 300); // first intent mounts the map
  await expect(page.locator(".readout")).toContainText(/stops in 60 min/, { timeout: 45_000 });
  const dial = page.locator(".dial");
  await expect(dial).toBeVisible();
  // collapse via the handle: day chips hide, the time row stays
  await page.locator(".sheet-handle").click();
  await expect(dial).toHaveClass(/collapsed/);
  await expect(page.locator(".days")).toBeHidden();
  await expect(page.locator(".time")).toBeVisible();
  // expand again
  await page.locator(".sheet-handle").click();
  await expect(page.locator(".days")).toBeVisible();
  await page.screenshot({ path: "test-results/mobile-sheet.png", fullPage: true });
});
