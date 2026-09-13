// Screenshot every target for a Claude session to review by eye.
// Deliberately does no analysis and calls no API — the session reads the PNGs.
// Usage: node scripts/capture.js [target-name ...]
import { chromium, devices } from 'playwright';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveTargets, root } from './targets.js';

const selected = await resolveTargets(process.argv.slice(2));

const VIEWPORTS = [
  { name: 'desktop', options: { viewport: { width: 1280, height: 800 } } },
  { name: 'mobile', options: devices['iPhone 13'] },
];

const shotDir = join(root, 'design-review', 'shots');
await rm(shotDir, { recursive: true, force: true }); // stale shots read as current
await mkdir(shotDir, { recursive: true });

const browser = await chromium.launch();
const captured = [];
const skipped = [];

for (const target of selected) {
  for (const pageDef of target.pages) {
    for (const vp of VIEWPORTS) {
      const label = `${target.name}/${pageDef.name}/${vp.name}`;
      const context = await browser.newContext({ ...vp.options, serviceWorkers: 'block' });
      const page = await context.newPage();
      try {
        await page.goto(`http://localhost:4173/${target.name}${pageDef.path}`, { waitUntil: 'load' });
        if (target.waitFor) await page.waitForSelector(target.waitFor, { state: 'visible' });
        await page.evaluate(() => document.fonts.ready);
        // Unlike the visual check, motion is left running — a design review
        // should see the page as a user does, mid-animation and all.
        await page.waitForTimeout(600);
        const file = join(shotDir, `${target.name}--${pageDef.name}--${vp.name}.png`);
        await writeFile(file, await page.screenshot({ fullPage: true }));
        captured.push(`${label}  ->  ${file}`);
      } catch (err) {
        skipped.push(`${label}  --  ${err.message.split('\n')[0]}`);
      }
      await context.close();
    }
  }
}

await browser.close();

console.log(`Captured ${captured.length}:`);
captured.forEach(c => console.log('  ' + c));
if (skipped.length) {
  console.log(`\nSkipped ${skipped.length}:`);
  skipped.forEach(s => console.log('  ' + s));
}
