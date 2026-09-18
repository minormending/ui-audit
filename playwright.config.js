import { defineConfig, devices } from '@playwright/test';
import { resolveTargets } from './scripts/targets.js';

// The readiness probe has to hit a path this run actually mounts — with
// AUDIT_DIR the registry targets aren't served at all.
const targets = await resolveTargets();
const firstTarget = targets[0]?.name ?? 'grumpy-bunny';

/*
 * Cases a project must not collect, from each page's `viewports`.
 *
 * Filtering at collection rather than inside the test is the whole point: a
 * `test.skip()` in the body still spins up a browser context first, and on a busy
 * machine simply tearing that context down blew the test timeout — a state that had
 * opted out of the viewport failing because of the viewport it opted out of.
 */
const optedOut = (project) => {
  const ids = targets
    .flatMap((t) => (t.pages ?? []).map((p) => ({
      id: `${t.name}/${p.name}`,
      viewports: p.viewports ?? t.viewports ?? null,
    })))
    .filter((c) => c.viewports && !c.viewports.includes(project))
    .map((c) => c.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return ids.length ? new RegExp(ids.join('|')) : undefined;
};

// AUDIT_URL lets the same suite run against a deployed Pages site instead of
// the local mounts, e.g. AUDIT_URL=https://minormending.github.io
const baseURL = process.env.AUDIT_URL ?? 'http://localhost:4173';
const isRemote = Boolean(process.env.AUDIT_URL);

export default defineConfig({
  testDir: './checks',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,

  /*
   * Long enough for the harness's own step timeouts to mean something.
   *
   * At Playwright's 30s default, an `open` step's `waitFor` — documented as
   * allowing 60s, and asked for 40s by several targets — could never be honoured:
   * whichever came first, the *test* deadline fired, and Playwright tears a test
   * down at that point without running any of the surrounding error handling. A
   * state reached by a dozen real clicks, each with settling waits behind it, ran
   * fine on a fast laptop and died mid-chain on a CI runner, reporting only a
   * missing selector.
   *
   * This is a ceiling, not a cost: a fast case still finishes in a second.
   */
  timeout: 90_000,
  reporter: [['html', { open: 'never' }], ['list']],

  expect: {
    toHaveScreenshot: {
      // An absolute budget, not a ratio. A ratio scales tolerance with viewport
      // area, so the same change that failed on a 390x844 phone passed on a
      // 1280x800 desktop — 0.2% is 658 pixels there and 2048 here. The biggest
      // screens were the least sensitive, and a changed number or short label
      // never registered on any of them.
      //
      // Measured, not guessed: at zero tolerance 76 of 90 checks across every
      // target diff by exactly 0 pixel. Baselines are already per-platform, so
      // the cross-machine font-hinting argument mostly does not apply. 40 is
      // headroom for sub-pixel jitter while still catching a single changed
      // word. Targets with genuinely non-deterministic content carry their own
      // measured budget in targets.json.
      maxDiffPixels: 40,
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    },
  },

  use: {
    baseURL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    // Freeze anything time-based so screenshots are deterministic.
    timezoneId: 'UTC',
    locale: 'en-US',
    // Several of these apps are PWAs. A service worker serving a stale precache
    // makes every check nondeterministic — test the source, not the cache.
    serviceWorkers: 'block',
  },

  projects: [
    {
      name: 'desktop',
      grepInvert: optedOut('desktop'),
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    { name: 'tablet', grepInvert: optedOut('tablet'), use: { ...devices['iPad (gen 7)'] } },
    { name: 'mobile', grepInvert: optedOut('mobile'), use: { ...devices['iPhone 13'] } },
  ],

  webServer: isRemote ? undefined : {
    command: 'node scripts/serve.js',
    url: `http://localhost:4173/${firstTarget}/`,
    // Never reuse: a server left running from an AUDIT_DIR run serves only that
    // mount, and reusing it silently 404s every registry target instead of
    // failing. Better to refuse to start than to audit the wrong thing.
    reuseExistingServer: false,
    timeout: 20_000,
  },
});
