import { test, expect } from '@playwright/test';
import { cases, visit } from './_harness.js';

// The checks a human reviewer forgets to do: did anything throw, did anything
// 404, and does the document have the metadata a real site needs.
for (const c of cases) {
  test(`health: ${c.id}`, async ({ page }) => {
    const { consoleErrors, failedRequests } = await visit(page, c.url, c.waitFor);

    expect(failedRequests, 'requests that failed or 404ed').toEqual([]);
    expect(consoleErrors, 'console errors').toEqual([]);

    const meta = await page.evaluate(() => ({
      title: document.title,
      lang: document.documentElement.lang,
      viewport: document.querySelector('meta[name="viewport"]')?.content ?? null,
      h1Count: document.querySelectorAll('h1').length,
    }));

    expect(meta.title, 'document should have a non-empty <title>').not.toBe('');
    expect(meta.lang, 'html element should declare a lang').toBeTruthy();
    expect(meta.viewport, 'missing responsive viewport meta tag').toBeTruthy();
    // HTML5 sectioning makes multiple h1s legal, so only a missing one is a defect.
    // axe's heading-order rule covers the hierarchy problems that actually matter.
    expect(meta.h1Count, 'page has no h1 — screen readers get no title').toBeGreaterThan(0);
  });
}
