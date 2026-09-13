import { test, expect } from '@playwright/test';
import { cases, visit, freezeMotion } from './_harness.js';

// Screenshot regression. Catches *change*, not *wrongness* — pair it with the
// layout and a11y checks, which catch wrongness without a baseline.
for (const c of cases) {
  test(`visual: ${c.id}`, async ({ page }) => {
    await visit(page, c.url, c.waitFor);
    if (c.freezeTimers) await freezeMotion(page);
    // Playwright already suffixes the project and platform onto the filename.
    await expect(page).toHaveScreenshot(`${c.target}--${c.page}.png`, {
      fullPage: true,
      mask: c.mask.map(sel => page.locator(sel)),
    });
  });
}
