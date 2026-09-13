import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(import.meta.url), '../..');
const config = JSON.parse(await readFile(join(root, 'targets.json'), 'utf8'));

// AUDIT_ONLY=name[,name] narrows the run — how a single project's CI audits
// just itself using the shared harness.
const only = process.env.AUDIT_ONLY?.split(',').map(s => s.trim()).filter(Boolean);
const selected = only?.length ? config.targets.filter(t => only.includes(t.name)) : config.targets;

if (only?.length && !selected.length) {
  throw new Error(`AUDIT_ONLY matched no targets. Known: ${config.targets.map(t => t.name).join(', ')}`);
}

/** Every {target, page} pair, flattened — the unit of work for each check. */
export const cases = selected.flatMap(t =>
  t.pages.map(p => ({
    target: t.name,
    page: p.name,
    id: `${t.name}/${p.name}`,
    url: `/${t.name}${p.path}`,
    // Client-rendered apps have an empty body at load; wait for real content.
    waitFor: p.waitFor ?? t.waitFor ?? null,
    // Selectors whose subtree is exempt from layout rules — third-party widgets
    // and map attribution you don't control the markup for.
    ignore: [...(t.ignore ?? []), ...(p.ignore ?? [])],
    // Regions painted over before screenshot comparison — map tiles, embeds,
    // anything whose pixels come from the network and will never match twice.
    mask: [...(t.mask ?? []), ...(p.mask ?? [])],
    // Opt out where an app needs timers to keep running to reach a stable view.
    freezeTimers: p.freezeTimers ?? t.freezeTimers ?? true,
  }))
);

export const githubUser = config.githubUser;

/**
 * Navigate and hold until the page is visually settled, while recording the
 * console errors and failed requests that happened along the way.
 * Returns the collected problems so individual checks can assert on them.
 */
export async function visit(page, url, waitFor = null, freezeTimers = true) {
  const consoleErrors = [];
  const failedRequests = [];

  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push(`[uncaught] ${err.message}`));
  page.on('requestfailed', req => {
    // A cancelled request is usually the page navigating away, not a fault.
    const failure = req.failure()?.errorText ?? '';
    if (!failure.includes('ERR_ABORTED')) {
      failedRequests.push(`${req.url()} — ${failure}`);
    }
  });
  page.on('response', res => {
    if (res.status() >= 400) failedRequests.push(`${res.url()} — HTTP ${res.status()}`);
  });

  // Several of these apps generate content randomly (procedural levels,
  // scattered decorations). Without a fixed seed every screenshot differs and
  // the visual suite is permanently red. Must be installed before navigation.
  await page.addInitScript(() => {
    let seed = 0x2f6e2b1;
    Math.random = () => {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      return (seed >>> 0) / 0x100000000;
    };
    const FIXED = new Date('2026-01-01T00:00:00Z').getTime();
    Date.now = () => FIXED;
    const RealDate = Date;
    // eslint-disable-next-line no-global-assign
    Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : [FIXED])); }
      static now() { return FIXED; }
    };
  });

  await page.goto(url, { waitUntil: 'load' });
  if (waitFor) await page.waitForSelector(waitFor, { state: 'visible' });
  await settle(page, freezeTimers);

  return { consoleErrors, failedRequests };
}

/** Kill animation/transition motion and wait for fonts + lazy images. */
export async function settle(page, freezeTimers = true) {
  await page.addStyleTag({
    content: `*, *::before, *::after {
      animation-duration: 0s !important;
      animation-delay: 0s !important;
      transition-duration: 0s !important;
      transition-delay: 0s !important;
      caret-color: transparent !important;
    }`,
  });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.images]
        .filter(img => !img.complete)
        .map(img => new Promise(r => { img.onload = img.onerror = r; }))
    );
  });
  // One rAF pair to let any post-font reflow land.
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

  // Zeroing CSS animation doesn't stop setTimeout/setInterval loops that mutate
  // the DOM — behaviour-garden beats a face on a timer, so the screenshot caught
  // it mid-blink at random. Startup has already run by now (load fired and any
  // waitFor resolved), so cancelling what's still pending only stops idle motion.
  if (freezeTimers) {
    await page.evaluate(() => {
      const highest = setTimeout(() => {}, 0);
      for (let id = 0; id <= highest; id++) {
        clearTimeout(id);
        clearInterval(id);
      }
      window.setTimeout = () => 0;
      window.setInterval = () => 0;
    });
    await page.evaluate(() => new Promise(r => requestAnimationFrame(r)));
  }
}
