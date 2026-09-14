import { readFile } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(import.meta.url), '../..');
const config = JSON.parse(await readFile(join(root, 'targets.json'), 'utf8'));

// AUDIT_DIR=/abs/path audits a project that isn't in the registry at all, so a
// session working in some other repo can point this harness at it directly.
const adhoc = process.env.AUDIT_DIR
  ? [{
      name: process.env.AUDIT_NAME || basename(resolve(process.env.AUDIT_DIR)),
      dir: resolve(process.env.AUDIT_DIR),
      waitFor: process.env.AUDIT_WAIT_FOR || null,
      pages: [{ path: '/', name: 'home' }],
    }]
  : null;

// AUDIT_ONLY=name[,name] narrows a registry run — how a single project's CI
// audits just itself using the shared harness.
const only = process.env.AUDIT_ONLY?.split(',').map(s => s.trim()).filter(Boolean);
const selected = adhoc
  ? adhoc
  : only?.length ? config.targets.filter(t => only.includes(t.name)) : config.targets;

if (!adhoc && only?.length && !selected.length) {
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
    // Like mask, but for elements that COVER the viewport. Playwright paints a
    // mask over the element's bounding box, so masking a full-screen canvas
    // hides the entire page and the screenshot compares one flat rectangle to
    // another — a test that cannot fail. visibility:hidden stops it painting
    // without occluding the UI layered on top of it.
    hide: [...(t.hide ?? []), ...(p.hide ?? [])],
    // Backend responses served from committed JSON instead of the network.
    // A target that reads a live database otherwise makes the suite depend on
    // that database being awake and unchanged — two things that have nothing
    // to do with whether the UI regressed.
    fixtures: [...(t.fixtures ?? []), ...(p.fixtures ?? [])],
    // Opt out where an app needs timers to keep running to reach a stable view.
    freezeTimers: p.freezeTimers ?? t.freezeTimers ?? true,
    // Selectors to click, in order, once the page has loaded -- how a state
    // that has no URL of its own gets audited. Several of these apps put most
    // of themselves behind a press: a card that swaps, a settings sheet, a
    // gateway offering three ways in. Registered by path alone, the suite sees
    // the first screen and nothing else.
    open: p.open ?? [],
  }))
);

export const githubUser = config.githubUser;

/**
 * Navigate, press whatever it takes to reach the state, and hold until the page
 * is visually settled -- while recording the console errors and failed requests
 * that happened along the way. Returns the collected problems so individual
 * checks can assert on them.
 *
 * **Takes the whole case rather than its parts.** It used to take `url` and
 * `waitFor` positionally, and `open` would have made three -- four call sites
 * that must each remember to pass the same new field, which is how three checks
 * end up auditing the opened state and the fourth quietly auditing the page it
 * was opened from. Handing over the case makes that impossible to get wrong.
 */
export async function visit(page, c) {
  const { url, waitFor = null, open = [] } = c;
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
  // **Settle before pressing, not only after.** Playwright's click waits for
  // the element to be *stable*, and a card still easing into place is not --
  // so pressing a page whose motion has not been zeroed yet is a race against
  // the transition. It lost on the first CI run it ever took, as a five-second
  // timeout on a button that was visibly there: fast enough to pass every time
  // on a laptop, slow enough to flake on a shared runner. `settle` turns the
  // animations off, which is what makes the press deterministic.
  await settle(page);
  // Bounded, and allowed to throw. A selector that no longer matches means the
  // state was never reached -- and every assertion after it would then be made
  // against the wrong screen and pass, which is worse than a red test. Failing
  // here names the selector; failing later names nothing.
  for (const selector of open) {
    await page.locator(selector).first().click({ timeout: 5_000 });
  }
  // Again, because what a press reveals has its own fonts, images and reflow.
  if (open.length) await settle(page);

  return { consoleErrors, failedRequests };
}

/** Minimal glob -> RegExp: ** spans separators, * does not. */
function globToRegExp(glob) {
  const rx = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${rx}$`);
}

/**
 * Serve backend calls from disk, so a target that reads a live database does
 * not make the suite depend on that database being awake and unchanged.
 *
 * ONE route handler dispatches by pattern in array order, first match wins.
 * Registering a handler per entry made the result depend on how Playwright
 * orders overlapping routes, and a catch-all silently beat the specific
 * pattern it was meant to sit behind — the app got [] and rendered an empty
 * map while the suite passed.
 */
export async function installFixtures(page, fixtures) {
  if (!fixtures?.length) return;

  const compiled = await Promise.all(fixtures.map(async f => ({
    test: globToRegExp(f.url),
    status: f.status ?? 200,
    body: f.file
      ? await readFile(join(root, f.file), 'utf8')
      : JSON.stringify(f.body ?? []),
  })));

  await page.route(
    url => compiled.some(c => c.test.test(url.toString())),
    route => {
      const hit = compiled.find(c => c.test.test(route.request().url()));
      // Clients like supabase-js send apikey/authorization, which makes the
      // browser preflight. A fulfilled response that only sets allow-origin
      // fails that preflight, the real request never leaves, and the app sees
      // an empty result rather than an error — silent, and easy to mistake for
      // the fixture simply not matching.
      const cors = {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
        'access-control-allow-headers': '*',
        'access-control-expose-headers': 'content-range',
      };
      if (route.request().method() === 'OPTIONS') {
        return route.fulfill({ status: 204, headers: cors, body: '' });
      }
      return route.fulfill({
        status: hit.status,
        contentType: 'application/json',
        headers: cors,
        body: hit.body,
      });
    },
  );
}

/** Stop an element painting without removing it from layout. */
export async function hideRegions(page, selectors) {
  if (!selectors?.length) return;
  await page.addStyleTag({
    content: selectors.map(s => `${s} { visibility: hidden !important; }`).join('\n'),
  });
}

/** Kill animation/transition motion and wait for fonts + lazy images. */
export async function settle(page) {
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

}

/**
 * Stop timer-driven idle motion so a screenshot is reproducible. Zeroing CSS
 * animation doesn't cover this — behaviour-garden beats a plant's face on a
 * setTimeout loop, so its screenshot caught a different frame each run.
 *
 * Only the visual check calls this. Stubbing setTimeout globally breaks
 * axe-core, which drives its rule queue through it, so a11y must run against a
 * page whose timers still work.
 */
export async function freezeMotion(page) {
  await page.evaluate(() => {
    const highest = setTimeout(() => {}, 0);
    for (let id = 0; id <= highest; id++) {
      clearTimeout(id);
      clearInterval(id);
    }
    // Callbacks already mid-flight reschedule themselves, so new timers have to
    // be refused too — not just the pending ones cancelled.
    window.setTimeout = () => 0;
    window.setInterval = () => 0;

    // Lottie drives playback from requestAnimationFrame, so neither the CSS
    // override nor the timer freeze touches it — behaviour-garden's plants kept
    // animating and every screenshot caught a different frame. freeze() halts
    // lottie's global loop, including animations mounted after this point.
    if (window.lottie) {
      window.lottie.freeze();
      for (const anim of window.lottie.getRegisteredAnimations?.() ?? []) {
        anim.goToAndStop(0, true);
      }
    }
  });
  await page.evaluate(() => new Promise(r => requestAnimationFrame(r)));
}
