import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
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
const chosen = adhoc
  ? adhoc
  : only?.length ? config.targets.filter(t => only.includes(t.name)) : config.targets;

/**
 * A target may declare files it cannot run without, and be skipped where they
 * are absent instead of failing there.
 *
 * This exists for one shape of target and it is worth naming: an app whose
 * *interesting* screens are behind a file the repository is not allowed to
 * contain. crystal-pilot-mobile is the whole of its own audit before a
 * cartridge is loaded -- three cards and a settings sheet -- while everything
 * that has actually broken lately is the layout *with* a game running, which
 * needs a ROM built from a disassembly that is nobody's to distribute. So the
 * in-game target reads one out of the developer's own `dev/` directory, and
 * simply is not there on a runner that has none.
 *
 * Silent rather than noisy. A skip that prints a warning every run is a warning
 * everybody learns to scroll past, and CI skipping this is the normal case
 * rather than a problem to report.
 */
const selected = chosen.filter(t => !t.requires
  || t.requires.every(f => existsSync(resolve(root, t.dir, f))));

if (!adhoc && only?.length && !selected.length) {
  throw new Error(`AUDIT_ONLY matched no targets. Known: ${config.targets.map(t => t.name).join(', ')}`);
}

/** Every {target, page} pair, flattened — the unit of work for each check. */
export const cases = selected.flatMap(t =>
  t.pages.map(p => ({
    target: t.name,
    dir: t.dir,
    page: p.name,
    id: `${t.name}/${p.name}`,
    url: `/${t.name}${p.path}`,
    // Client-rendered apps have an empty body at load; wait for real content.
    waitFor: p.waitFor ?? t.waitFor ?? null,
    // Selectors whose subtree is exempt from layout rules — third-party widgets
    // and map attribution you don't control the markup for.
    ignore: [...(t.ignore ?? []), ...(p.ignore ?? [])],
    // Subtrees axe-core must not descend into. Not the same as `ignore`: this is
    // for documents you did not author and cannot fix — an embedded third-party
    // page, or a book rendered in an iframe from someone else's markup. Axe also
    // has to open a page per frame to inject itself, and on srcdoc frames that
    // can hang outright, so excluding them is what makes the check run at all.
    a11yExclude: [...(t.a11yExclude ?? []), ...(p.a11yExclude ?? [])],
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
    // Per-target visual budget for content that genuinely cannot render the
    // same twice. Measured at zero tolerance, not picked — and a number worth
    // driving back down rather than living with.
    maxDiffPixels: p.maxDiffPixels ?? t.maxDiffPixels ?? null,
    // Opt out where an app needs timers to keep running to reach a stable view.
    freezeTimers: p.freezeTimers ?? t.freezeTimers ?? true,
    // Where the browser believes it is standing. Same problem `open` solves,
    // one layer down: an app that behaves differently when it knows your
    // location has states no URL and no click can reach, and without this the
    // suite only ever sees the one it falls back to when permission is
    // refused. {latitude, longitude, accuracy}.
    geolocation: p.geolocation ?? t.geolocation ?? null,
    // Browser storage seeded before the first script runs. For a state gated
    // on something the app reads out of localStorage at startup -- a session,
    // a dismissed banner, a saved preference -- which no click can reach and
    // no permission grants.
    storage: p.storage ?? t.storage ?? null,
    // Viewports this state is worth auditing at, defaulting to all of them.
    //
    // For states that are slow and not viewport-interesting. story-tale-reader's
    // resume states read a book, leave it and reopen it — a dozen real clicks each
    // — and they depend on the book having been *stored*, so on a machine whose
    // disk is busy they fail for a reason that has nothing to do with the UI. The
    // behaviour they protect is the same at every width, so one viewport proves it
    // and three only buy flakiness.
    viewports: p.viewports ?? t.viewports ?? null,
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
  // `c.dir` is the target's directory -- see the { upload } step below.
  const consoleErrors = [];
  const failedRequests = [];

  page.on('console', msg => {
    if (msg.type() === 'error' && !HARNESS_NOISE.test(msg.text())) {
      consoleErrors.push(msg.text());
    }
  });
  page.on('pageerror', err => consoleErrors.push(`[uncaught] ${err.message}`));
  page.on('requestfailed', req => {
    // A request the page stopped wanting is not a fault. Chrome reports one
    // abandoned by a navigation as ERR_ABORTED; one the page cancelled itself
    // arrives with the library's own wording instead -- MapLibre drops the
    // tiles for a viewport it has just flown away from, and eight of those
    // turned the first geolocated case red on one run and green on the next.
    // Same meaning, different string, and a suite that goes red at random
    // gets ignored.
    const failure = req.failure()?.errorText ?? '';
    if (!ABANDONED.test(failure)) {
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

  await primeContext(page, c);

  await page.goto(url, { waitUntil: 'load' });
  if (waitFor) {
    try {
      // An explicit timeout, deliberately shorter than the test's. Left to
      // default, this inherits the test deadline — and when *that* fires Playwright
      // tears the test down without running the catch below, so the diagnosis never
      // printed. The guard was written, committed, and silently dead until the same
      // base-path mistake happened a second time.
      await page.waitForSelector(waitFor, { state: 'visible', timeout: 20_000 });
    } catch (cause) {
      // A Vite target built with the wrong base serves an index.html whose script
      // and stylesheet URLs point somewhere this server does not mount, so nothing
      // ever renders and *every* case for that target fails here — with a message
      // about a missing selector and no hint of the real cause. It cost a full red
      // run to work out once; it should cost a sentence from now on.
      const missing = failedRequests.filter(r => r.includes('HTTP 404'));
      if (missing.length) {
        throw new Error(
          `${c.id}: nothing rendered, and ${missing.length} request(s) 404ed. ` +
          `If this is a Vite target, check it was built with the base path the ` +
          `harness serves it from (/${c.target}/) — see "build" in targets.json. ` +
          `First: ${missing[0]}`,
          { cause },
        );
      }
      throw cause;
    }
  }
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
  await pressOpenSteps(page, open, c.dir);
  // Again, because what a press reveals has its own fonts, images and reflow --
  // and first wait for it to stop changing at all. What a press opens is often
  // built in stages, and `freezeMotion` then cancels the pending timers, so the
  // screenshot keeps whatever had been revealed by that instant. On a quiet
  // machine the staging finishes first and the shot is stable; under a full
  // parallel run it does not. That is not a flake -- nyc-lyfe's character
  // screen failed *every* attempt on CI while its own Linux baseline, taken by
  // the lighter baselines job, regenerated byte-identical. Two runs of the same
  // code disagreeing because one of them was busier is the worst kind of red.
  if (open.length) {
    // What a press reveals usually *fetches* -- card art, a sprite sheet, a
    // sound, the first page of data -- and `settle` only awaits the `<img>`
    // elements already in the DOM, so a CSS background still in flight paints
    // after the shot. Measured on crest-cards' game screen: six captures gave
    // **four different images** without this wait and one with it.
    // Bounded and swallowed: a page that never goes idle (a map, a poller) is
    // not a failure, it is a page this cannot help, and `mask` and `hide`
    // already exist for that.
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
    await quiesce(page);
    await settle(page);
  }

  return { consoleErrors, failedRequests };
}

/**
 * Console errors the harness itself provokes.
 *
 * The seeded RNG, the frozen clock and the motion zeroing are installed with
 * `addInitScript`, which Playwright injects into *every* frame — including ones a
 * target deliberately sandboxes without `allow-scripts`. Chrome refuses to run the
 * injection and logs it, so the message describes the harness reaching into the
 * frame, not anything the page did. story-tale-reader sandboxes the book pages on
 * purpose, and going red for that would punish the safer choice.
 */
const HARNESS_NOISE =
  /Blocked script execution in '[^']*' because the document's frame is sandboxed/;

/**
 * Request failures that mean "nobody is waiting for this any more".
 *
 * Every browser here words it differently for the same event: Chromium says
 * `net::ERR_ABORTED`, WebKit on Linux says `Load request cancelled`, WebKit on
 * macOS says just `cancelled`. Matching the exact strings looked tidier and was
 * wrong on the first platform it met -- it was written against the CI wording
 * and missed two of the three projects locally.
 *
 * Broad enough to worry about, so: a server dropping a response mid-flight does
 * NOT land here. That arrives as ERR_CONNECTION_RESET or ERR_EMPTY_RESPONSE and
 * still fails the check. Cancellation is a word these engines use for what the
 * client chose to stop waiting for.
 */
const ABANDONED = /ERR_ABORTED|cancell?ed/i;

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

/**
 * Hold until the DOM stops changing, or give up.
 *
 * Deliberately a quiet *window* rather than a fixed wait: a fixed one is either
 * too short for a slow machine or wasted on every fast one, and this suite runs
 * both. Bounded, and it does not throw on the bound -- a page that never stops
 * mutating (a clock, a ticker) is a page this cannot help, and the visual check
 * already has `mask` and `hide` for that.
 */
/** Where a finger should land: the middle of the element. */
async function centreOf(page, selector) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`cannot tap ${selector}: it has no box on screen`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * A two-finger pinch, dispatched over the DevTools protocol.
 *
 * Both contacts have to move together in the same event, which is exactly what no
 * high-level API offers: `touchscreen.tap` is one finger, and a mouse has none. A
 * scale above 1 spreads the fingers apart (zoom in), below 1 brings them together.
 *
 * The moves are stepped rather than jumped, because a gesture recogniser watching
 * for a change in distance sees nothing in a single leap from start to finish.
 */
async function pinch(page, selector, scale, steps) {
  const { x, y } = await centreOf(page, selector);
  const client = await page.context().newCDPSession(page);
  const from = 40;
  const to = Math.max(8, from * scale);

  const contacts = (spread) => [
    { x: x - spread, y, id: 1 },
    { x: x + spread, y, id: 2 },
  ];

  try {
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: contacts(from) });
    for (let i = 1; i <= steps; i++) {
      const spread = from + ((to - from) * i) / steps;
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: contacts(spread) });
      // A frame between moves: the app tracks the gesture across animation frames,
      // and events delivered faster than it can draw are events it cannot follow.
      await page.waitForTimeout(16);
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await client.detach().catch(() => {});
  }
}

export async function quiesce(page, quietMs = 150, capMs = 2500) {
  await page.evaluate(async ({ quietMs, capMs }) => {
    await new Promise((resolve) => {
      let timer = 0;
      const done = () => { clearTimeout(timer); obs.disconnect(); resolve(); };
      const obs = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(done, quietMs);
      });
      obs.observe(document.documentElement,
                  { childList: true, subtree: true, attributes: true, characterData: true });
      timer = setTimeout(done, quietMs);
      setTimeout(done, capMs);
    });
  }, { quietMs, capMs });
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

/**
 * Grant a position and seed storage, before anything the page runs.
 *
 * Extracted so `scripts/capture.js` applies them the same way this does. It
 * did not, for a long time, and the failure was quiet in the worst way: a
 * target whose states are gated on a session or a location was photographed
 * at whatever screen it falls back to, and the review that read those pictures
 * reported on the fallback without anyone noticing it was the fallback.
 */
export async function primeContext(page, { geolocation = null, storage = null } = {}) {
  // Before navigation, both of them: a page that asks on load gets the answer
  // it would have got from a person standing there, and granting the
  // permission without setting a position hands it a pending request that
  // never resolves.
  if (geolocation) {
    await page.context().grantPermissions(['geolocation']);
    await page.context().setGeolocation(geolocation);
  }

  // Before the page's own scripts, so a client that reads its session on
  // construction sees one. Values that are not already strings are stringified,
  // which is how they are written in targets.json -- nested JSON rather than a
  // quoted blob nobody can read or edit.
  if (storage) {
    await page.addInitScript((items) => {
      try {
        for (const [key, value] of Object.entries(items)) {
          localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
        }
      } catch { /* private mode; the case will fail on its own terms */ }
    }, storage);
  }
}

/**
 * Press the `open` chain that reaches a state with no URL of its own.
 *
 * Shared with `scripts/capture.js` for the same reason `primeContext` is: two
 * copies of this would drift, and the half that drifted would still produce
 * pictures — of the wrong screen.
 */
export async function pressOpenSteps(page, open = [], dir = '.') {
  for (const step of open) {
    if (typeof step === 'string') {
      await page.locator(step).first().click({ timeout: 5_000 });
      continue;
    }
    // { upload, file } puts a real file into a file input, `file` relative to
    // the target's own directory. The alternative for an app whose whole
    // interesting half is behind a file picker is to audit the picker.
    // { click, optional } presses something that only exists in some layouts.
    // Narrow it deliberately: the loud failure above is right for a step that
    // *reaches* a state, because everything after a missed click is asserted
    // against the wrong screen and passes. This is for a control the layout
    // itself removes -- crystal-pilot hides its Play key on the two wide
    // layouts, where the pad has a place of its own and nothing needs swapping
    // away to reach it, so the key is absent by design rather than by fault.
    if (step.click) {
      const el = page.locator(step.click).first();
      if (!step.optional) { await el.click({ timeout: 5_000 }); continue; }
      if (await el.count() && await el.isVisible()) await el.click({ timeout: 5_000 });
      continue;
    }
    // { upload, file } or { upload, files } puts real files into a file input.
    // `files` matters for anything whose behaviour only appears in bulk: a shelf
    // with one book on it cannot demonstrate searching or sorting, and adding books
    // one state at a time would photograph a different app each time.
    if (step.upload) {
      const chosen = step.files ?? [step.file];
      await page.setInputFiles(step.upload, chosen.map((name) => resolve(root, dir, name)));
      continue;
    }
    // { select, value } picks an option. A select cannot be driven by pressing or
    // typing at it, so a state behind one -- an ordering, a mode, a filter -- is
    // otherwise unreachable.
    if (step.select) {
      await page.selectOption(step.select, step.value);
      continue;
    }
    // { tap } is a finger, not a mouse. Everything else here clicks, and a click is
    // not what these apps are used with: a tap captures the pointer to its original
    // target, arrives with pointerType "touch", and reaches handlers a click never
    // does. Only meaningful in a project with touch — see `touch` in the README.
    if (step.tap) {
      const spot = await centreOf(page, step.tap);
      await page.touchscreen.tap(spot.x, spot.y);
      continue;
    }

    // { pinch, scale } spreads or closes two fingers over an element. Playwright has
    // no pinch: two simultaneous contacts only exist over CDP, which is also the
    // only way to test the gesture at all short of a real hand on real glass.
    if (step.pinch) {
      await pinch(page, step.pinch, step.scale ?? 2, step.steps ?? 8);
      continue;
    }

    // { press } sends a key to the page. A few states exist only for someone on
    // a keyboard and cannot be reached by pressing things: story-tale-reader
    // retires its toolbars three seconds after a press but holds them open for
    // keyboard focus, so arriving at its locked state on the keyboard is the
    // only way to photograph that state with its toolbar still on screen.
    if (step.press) {
      await page.keyboard.press(step.press);
      continue;
    }
    // { waitFor, timeout } holds until something the *app* does appears --
    // which a click cannot express. Loading a 2MB ROM and parsing a symbol
    // file takes seconds, and every step after it would otherwise race the
    // boot and be asserted against a page that is still empty.
    if (step.waitFor) {
      // `state` for the cases where the assertion is that something went away.
      // story-tale-reader drops its read-along control when the narration ends,
      // and "the control is gone" is the only evidence that reading stopped
      // cleanly rather than hanging on a page with nothing left to play.
      await page.waitForSelector(step.waitFor,
                                 { state: step.state ?? 'visible', timeout: step.timeout ?? 60_000 });
      continue;
    }
    // { fill, text } types into a field. A state behind a search box is not
    // reachable by pressing things -- restroom-map's add-a-place flow puts the
    // screen its testers complained about behind an address the person types,
    // and clicking alone only ever reaches the empty form.
    await page.locator(step.fill).first().fill(step.text, { timeout: 5_000 });
  }
}
