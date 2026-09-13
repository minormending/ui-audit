import { test, expect } from '@playwright/test';
import { cases, visit } from './_harness.js';

// Design defects that are objectively wrong at any viewport — no baseline needed.
for (const c of cases) {
  test(`layout: ${c.id}`, async ({ page }, testInfo) => {
    await visit(page, c.url, c.waitFor);

    const report = await page.evaluate(ignore => {
      const ignored = el => ignore.some(sel => el.closest(sel));
      const visible = el => {
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };

      // 1. Horizontal overflow — the single most common responsive bug.
      // Only worth reporting when the document actually scrolls: decorative
      // elements deliberately bleeding past a clipping parent are not defects.
      const docWidth = document.documentElement.clientWidth;
      const documentScrolls = document.documentElement.scrollWidth > docWidth + 1;
      const overflowing = (!documentScrolls ? [] : [...document.querySelectorAll('body *')])
        .filter(visible)
        .filter(el => !ignored(el))
        .filter(el => {
          const r = el.getBoundingClientRect();
          // Allow 1px for subpixel rounding.
          return r.right > docWidth + 1 || r.left < -1;
        })
        .slice(0, 10)
        .map(el => ({
          selector: el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') +
            (el.className && typeof el.className === 'string'
              ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''),
          right: Math.round(el.getBoundingClientRect().right),
        }));

      // 2. Tap targets below the 24x24 CSS px floor (WCAG 2.2 SC 2.5.8).
      const smallTargets = [...document.querySelectorAll('a, button, input, select, [role="button"]')]
        .filter(visible)
        .filter(el => !ignored(el))
        .filter(el => {
          const r = el.getBoundingClientRect();
          return r.width < 24 || r.height < 24;
        })
        .slice(0, 10)
        .map(el => {
          const r = el.getBoundingClientRect();
          return {
            selector: el.tagName.toLowerCase() + (el.id ? `#${el.id}` : ''),
            text: (el.textContent ?? '').trim().slice(0, 30),
            size: `${Math.round(r.width)}x${Math.round(r.height)}`,
          };
        });

      // 3. Text clipped by a fixed-height container. Restricted to elements
      // holding their own text — a decorative wrapper with overflow:hidden is
      // doing its job, not hiding content the user needed to read.
      const ownsText = el => [...el.childNodes]
        .some(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim().length > 0);

      const clipped = [...document.querySelectorAll('body *')]
        .filter(visible)
        .filter(el => !ignored(el))
        .filter(ownsText)
        .filter(el => {
          const s = getComputedStyle(el);
          if (s.overflow === 'visible' || s.overflowY === 'auto' || s.overflowY === 'scroll') return false;
          return el.scrollHeight > el.clientHeight + 2 && el.clientHeight > 0;
        })
        .slice(0, 10)
        .map(el => ({
          selector: el.tagName.toLowerCase() + (el.id ? `#${el.id}` : ''),
          overflowBy: el.scrollHeight - el.clientHeight,
        }));

      return {
        docWidth,
        scrollWidth: document.documentElement.scrollWidth,
        overflowing,
        smallTargets,
        clipped,
      };
    }, c.ignore);

    await testInfo.attach('layout-report', {
      body: JSON.stringify(report, null, 2),
      contentType: 'application/json',
    });

    expect(report.scrollWidth, 'page scrolls horizontally at this viewport')
      .toBeLessThanOrEqual(report.docWidth + 1);
    expect(report.overflowing, 'elements extending past the viewport').toEqual([]);
    expect(report.clipped, 'containers clipping their own content').toEqual([]);
    expect(report.smallTargets, 'tap targets smaller than 24x24px').toEqual([]);
  });
}
