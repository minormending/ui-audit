import { defineConfig, devices } from '@playwright/test';
import { resolveTargets } from './scripts/targets.js';

// The readiness probe has to hit a path this run actually mounts — with
// AUDIT_DIR the registry targets aren't served at all.
const firstTarget = (await resolveTargets())[0]?.name ?? 'grumpy-bunny';

// AUDIT_URL lets the same suite run against a deployed Pages site instead of
// the local mounts, e.g. AUDIT_URL=https://minormending.github.io
const baseURL = process.env.AUDIT_URL ?? 'http://localhost:4173';
const isRemote = Boolean(process.env.AUDIT_URL);

export default defineConfig({
  testDir: './checks',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
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
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'tablet',  use: { ...devices['iPad (gen 7)'] } },
    { name: 'mobile',  use: { ...devices['iPhone 13'] } },
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
