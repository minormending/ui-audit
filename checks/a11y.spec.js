import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { cases, visit } from './_harness.js';

// axe-core covers the design rules a human eye is bad at: contrast ratios,
// missing labels, heading order, ARIA misuse.
for (const c of cases) {
  test(`a11y: ${c.id}`, async ({ page }, testInfo) => {
    await visit(page, c.url, c.waitFor);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const violations = results.violations.map(v => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.slice(0, 5).map(n => n.target.join(' ')),
    }));

    await testInfo.attach('a11y-violations', {
      body: JSON.stringify(violations, null, 2),
      contentType: 'application/json',
    });

    // Fail on the tiers worth blocking a deploy over; log the rest in the report.
    const blocking = violations.filter(v => v.impact === 'critical' || v.impact === 'serious');
    expect(blocking, 'critical/serious accessibility violations').toEqual([]);
  });
}
