# ui-audit

Automated UI/design testing for the static GitHub Pages projects in this folder.
Replaces the manual eyeball pass with four checks, run across three viewports.

| Check | What it catches | Needs a baseline? |
|---|---|---|
| `visual` | Any pixel change vs. an approved screenshot | Yes |
| `layout` | Horizontal overflow, clipped text, sub-24px tap targets | No |
| `a11y` | Contrast, ARIA misuse, unlabeled controls (axe-core, WCAG 2.1 AA) | No |
| `health` | JS errors, 404s, missing `<title>` / `lang` / viewport meta / `h1` | No |

Viewports: `desktop` (1280×800), `tablet` (iPad gen 7), `mobile` (iPhone 13).

Visual diffs only tell you something *changed*. The other three tell you
something is *wrong* on a project that has never been tested before — which is
why they run without any baseline.

## Setup

```bash
npm install
npx playwright install chromium webkit
```

## Run

```bash
npm run build:targets   # builds the Vite targets into dist/ (skip if unchanged)
npm test                # all checks, all viewports
npm run report          # open the HTML report

npx playwright test layout.spec.js --project=mobile   # one check, one viewport
AUDIT_ONLY=nail-salon npx playwright test             # one project
```

Approve intentional visual changes with `npm run test:update`, then commit the
updated PNGs in `checks/visual.spec.js-snapshots/`.

Audit the deployed sites instead of local files:

```bash
AUDIT_URL=https://minormending.github.io npx playwright test
```

## Adding a project

Add an entry to `targets.json`:

```json
{
  "name": "my-app",
  "dir": "../my-app",
  "build": "npm run build",          // omit for plain static sites
  "waitFor": "#root > *",            // for client-rendered apps
  "ignore": [".third-party-widget"], // exempt from layout rules
  "mask": [".map-canvas"],           // painted over before visual diffing
  "pages": [{ "path": "/", "name": "home" }]
}
```

`dir` is what gets served. **Vite projects must point at `dist/`**, and must be
built with the base path Pages will serve from (`/<repo>/`) or every asset 404s.

## Determinism

A flaky visual suite gets ignored, so the harness pins everything that varies:

- `Math.random` is seeded and `Date` frozen to 2026-01-01 before page load —
  several of these apps generate content procedurally.
- Service workers are blocked, so a stale precache can't serve old assets.
- Animations and transitions are zeroed; fonts and images are awaited.
- Network-painted regions (map tiles) are masked per target.

Verified stable across three consecutive runs.

## CI

Auditing is **centralised in this repo** rather than vendored into each
project. Every target is a public repo, so `scripts/fetch-targets.js` clones
them all with no secrets, and one place owns the checks, the baselines and the
Playwright version. The alternative — a copy per project — means ten repos to
update whenever a rule changes.

- `.github/workflows/audit.yml` — full suite on push, PR, and weekly. Weekly
  matters because the targets live in other repos, so a change there won't
  trigger anything here.
- `.github/workflows/baselines.yml` — `workflow_dispatch`, regenerates Linux
  baselines and commits them back.

`templates/per-project-workflow.yml` is still there if you later want an
individual repo to gate its own PRs; it audits one target via `AUDIT_ONLY`.

**Baselines are platform-specific.** macOS writes `*-darwin.png`, CI needs
`*-linux.png`, and both are committed. Regenerate the Linux set after an
intentional visual change:

```bash
gh workflow run baselines.yml                  # all targets
gh workflow run baselines.yml -f only=tidy-up  # one
```

Bump the `@playwright/test` pin and both workflows' container image tag
together, or font rendering drifts and every visual check fails.

## Design review (optional, costs API credits)

`npm run review` screenshots each page and asks Claude to critique it against a
design rubric — spacing, alignment, hierarchy, contrast, affordance. This is the
judgement call the other four checks can't make.

```bash
export ANTHROPIC_API_KEY=...
npm run serve &          # the reviewer expects the static server up
npm run review           # all targets
npm run review nail-salon
```

Writes `design-review/report.md` and exits non-zero if any page is rated
`needs-work`. Uses `claude-opus-5` with adaptive thinking.

> Unverified end-to-end: built and syntax-checked, and the screenshot/report
> path is exercised, but the API call itself has not been run — no credentials
> were available on the machine it was built on.
