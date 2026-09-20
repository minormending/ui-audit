import { test, expect } from '@playwright/test';
import { cases, visit, freezeMotion, hideRegions, installFixtures } from './_harness.js';

// Screenshot regression. Catches *change*, not *wrongness* — pair it with the
// layout and a11y checks, which catch wrongness without a baseline.
for (const c of cases) {
  test(`visual: ${c.id}`, async ({ page }) => {
    await installFixtures(page, c.fixtures);
    await visit(page, c, { hold: c.holdAfterOpen && c.freezeTimers });
    await hideRegions(page, c.hide);
    if (c.freezeTimers) await freezeMotion(page);
    // Playwright already suffixes the project and platform onto the filename.
    await expect(page).toHaveScreenshot(`${c.target}--${c.page}.png`, {
      fullPage: true,
      mask: c.mask.map(sel => page.locator(sel)),
      ...(c.maxDiffPixels != null ? { maxDiffPixels: c.maxDiffPixels } : {}),
    });
  });
}
