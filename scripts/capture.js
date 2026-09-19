// Screenshot every target for a Claude session to review by eye.
// Deliberately does no analysis and calls no API — the session reads the PNGs.
// Usage: node scripts/capture.js [target-name ...]
//
// WHAT THIS SHARES WITH THE CHECKS, AND WHY
//
// It reaches a state exactly the way `checks/_harness.js` does: the same
// merged `cases`, the same fixtures, the same seeded storage and position, the
// same `open` chain. That is not tidiness. This script used to walk
// `targets.json` itself and honour only `path`, `waitFor` and string `open`
// steps, which meant it silently ignored `fixtures`, `storage` and
// `geolocation` — and a target that needs them was photographed at whatever
// screen it falls back to without them.
//
// restroom-map is built against a Supabase host that does not exist, so with
// no fixtures its `.banner-count` never appears: 20 of its 24 states timed out
// and the two static legal pages were the entire "design review". The review
// that read those four pictures reported on the legal pages and called it the
// app.
//
// The one thing deliberately NOT shared is motion. `visit()` settles and
// freezes; a design review should see the page as a person does, mid-animation
// and all.
import { chromium, devices } from 'playwright';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { cases, installFixtures, primeContext, pressOpenSteps } from '../checks/_harness.js';
import { root } from './targets.js';

const ORIGIN = 'http://localhost:4173';

// Positional names narrow further than AUDIT_ONLY already has, so
// `node scripts/capture.js tidy-up` keeps working.
const names = process.argv.slice(2).filter(a => !a.startsWith('-'));
const selected = names.length ? cases.filter(c => names.includes(c.target)) : cases;

if (!selected.length) {
  const known = [...new Set(cases.map(c => c.target))].join(', ');
  console.error(names.length
    ? `No cases for ${names.join(', ')}. Known: ${known}`
    : 'No cases to capture.');
  process.exit(1);
}

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
let optedOut = 0;

for (const c of selected) {
  for (const vp of VIEWPORTS) {
    // A state may name the viewports it is worth auditing at, and the checks
    // honour that by filtering at collection. This did not, so it tried to
    // photograph story-tale-reader's read-along — twelve chained waits ending
    // in a narration finishing, declared desktop-only — at phone width, and
    // reported the timeout as a fault. An opt-out is not a failure.
    if (c.viewports && !c.viewports.includes(vp.name)) { optedOut++; continue; }
    const label = `${c.target}/${c.page}/${vp.name}`;
    const context = await browser.newContext({ ...vp.options, serviceWorkers: 'block' });
    const page = await context.newPage();
    try {
      await installFixtures(page, c.fixtures);
      await primeContext(page, c);
      await page.goto(ORIGIN + c.url, { waitUntil: 'load' });
      if (c.waitFor) await page.waitForSelector(c.waitFor, { state: 'visible', timeout: 20_000 });
      await pressOpenSteps(page, c.open, c.dir);
      // Elements that cover the viewport — a full-screen map canvas — are hidden
      // rather than left to paint tiles off the network. The checks do this for
      // determinism; here it is so the reviewer is looking at the UI and not at
      // whatever the tile server served that minute.
      if (c.hide?.length) {
        await page.addStyleTag({
          content: c.hide.map(s => `${s} { visibility: hidden !important; }`).join('\n'),
        });
      }
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(600);
      const file = join(shotDir, `${c.target}--${c.page}--${vp.name}.png`);
      await writeFile(file, await page.screenshot({ fullPage: true }));
      captured.push(`${label}  ->  ${file}`);
    } catch (err) {
      skipped.push(`${label}  --  ${err.message.split('\n')[0]}`);
    }
    await context.close();
  }
}

await browser.close();

console.log(`Captured ${captured.length}${optedOut ? ` (${optedOut} opted out by viewport)` : ''}:`);
captured.forEach(c => console.log('  ' + c));
if (skipped.length) {
  console.log(`\nSkipped ${skipped.length}:`);
  skipped.forEach(s => console.log('  ' + s));
  // Loud, because a skipped state is a state the review will not mention and
  // nobody will notice is missing.
  process.exitCode = 1;
}
