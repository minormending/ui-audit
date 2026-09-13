import { defineConfig, devices } from '@playwright/test';

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
      // Anti-aliasing and font hinting differ enough between machines that a
      // zero-tolerance diff is pure noise. 0.2% of pixels is the practical floor.
      maxDiffPixelRatio: 0.002,
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
    url: 'http://localhost:4173/grumpy-bunny/',
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
  },
});
