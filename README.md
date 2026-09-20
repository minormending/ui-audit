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
  "pages": [
    { "path": "/", "name": "home" },
    { "path": "/", "name": "settings", "open": ["#gear"] },
    { "path": "/", "name": "here", "geolocation": { "latitude": 40.7, "longitude": -74, "accuracy": 8 } }
  ]
}
```

An `open` step may also be an object rather than a selector:

```json
"open": [
  "#gate-files",
  { "upload": "#romFile", "file": "dev/pokecrystal.gbc" },
  { "waitFor": "#ctrls:not(.hide)", "timeout": 90000 },
  { "fill": "#search", "text": "Brooklyn" },
  { "click": ".modes button[data-pane='play']", "optional": true },
  { "press": "Tab" }
]
```

The `touch` project is Chromium with fingers, and it is **opt-in**: a state reaches
it by naming it in `viewports`, and nothing else runs there. It exists because
`tablet` and `mobile` are the iPad and iPhone presets, which run **WebKit** — so
without it the suite had no Chromium-with-touch anywhere, which is precisely what an
Android tablet is. It is also the only project with CDP, and therefore the only one
that can pinch.

`tap` puts a finger on something instead of a mouse pointer, and `pinch` spreads or
closes two of them over it (`scale` above 1 zooms in, below 1 out). Both need a
project with touch — `tablet` and `mobile` have it, `desktop` does not — so states
using them are scoped with `viewports`. A tap is not a small click: it captures the
pointer to its original target and arrives with `pointerType: "touch"`, which is a
different path through most gesture code. Two simultaneous contacts exist only over
CDP, so `pinch` drops to the protocol; short of a hand on real glass it is the only
way to test the gesture at all.

`upload` takes `files` instead of `file` to put several in at once. Some behaviour
only exists in bulk: a shelf with one book on it cannot demonstrate searching or
sorting, and adding books a state at a time would photograph a different app each
time.

`select` picks an option from a `<select>`, which cannot be driven by pressing or
typing at it, so a state behind an ordering or a filter is otherwise unreachable.

`waitFor` takes an optional `state`, passed straight to Playwright: `visible` by
default, or `detached` when the assertion is that something went away.
story-tale-reader drops its read-along control when the narration ends, and the
control being gone is the only evidence that reading stopped cleanly rather than
hanging on a page with nothing left to play.

`press` sends a key to the page. Most states are reachable by pressing things, but
a few exist only for someone on a keyboard: story-tale-reader holds its toolbars
open for keyboard focus and retires them three seconds after a press, so its
locked state is only photographable with the toolbar on screen by arriving there
on the keyboard.

`a11yExclude` keeps axe-core out of a subtree — not the same as `ignore`, which
only exempts a subtree from the layout rules. This is for documents the target
embeds but did not author: story-tale-reader renders each book page in an iframe
from the publisher's own markup, which cannot be fixed here and which axe hangs on
outright when the frame is `srcdoc` (it opens a page per frame to inject itself).
Excluding those frames is what makes the check run at all — it went from a 30s
timeout to 1.1s.

`upload` puts a real file into a file input, `file` resolved against the
target's own directory — and it may point outside it. story-tale-reader's
reflowable, PDF and MOBI renderers are three separate code paths that nothing but
a real book of that type reaches, so those states upload the target's own
committed fixtures with `"file": "../corpus/fixtures/…"`. Registering a path alone
would have audited one renderer out of four. A hidden input is fine; Playwright
does not require it to be visible. `waitFor` holds until something the *app* does appears,
which a click cannot express — loading a 2MB ROM takes seconds and every step
after it would otherwise race the boot. `fill` types into a field. `click` with
`optional` presses a control that only exists in some layouts, and is the one
step allowed to find nothing: a plain selector that misses **fails loudly** on
purpose, because everything after a missed click is asserted against the wrong
screen and passes.

A target may also declare `requires`, a list of files it cannot run without:

```json
"requires": ["dev/pokecrystal.gbc", "dev/pokecrystal.sym"]
```

Missing any of them and the target is skipped silently, which is how a project
whose interesting screens sit behind a file the repository may not contain gets
audited at all. `crystal-pilot-ingame` is that case — the app is three cards and
a settings sheet until a Game Boy ROM is loaded, and the ROM has to be built
from a disassembly that is nobody's to distribute. It runs on the developer's
machine, where `dev/` has one, and is simply absent on a runner. Its baselines
are therefore darwin-only and CI never sees it, which is the trade: the checks
that matter most run where the files are.

It earns its keep. The first run of that target found three tap targets under
the 24×24 floor and a 2.4:1 contrast failure, none of which any gateway
screenshot could ever have reached.

`open` is a list of selectors clicked in order once the page has loaded — how a
state that has **no URL of its own** gets audited. Most of these apps keep most
of themselves behind a press: a card that swaps in place, a settings sheet, a
gateway offering three ways in. Registered by path alone the suite sees the
screen you land on and stops there, which is the least interesting screen in the
app and often the only one nobody has looked at.

It is worth the trouble. Adding four of them to `crystal-pilot-mobile` — an app
whose whole interface is behind a file picker, so the front door is all the
harness can ever reach — turned a clean run into **fourteen failures**: three
paragraphs at 1.47:1 because a vendor default was winning a specificity fight,
and three back-links under the 24px tap-target floor.

A selector that matches nothing **fails the check**, deliberately. Everything
after a missed click would otherwise be asserted against the screen it was meant
to open *from*, and pass.

**Every target here now has one**, because nearly every one of them keeps its
whole interface behind a press: a landing page with a Start, a parent-settings
screen in front of the child's, a six-step tutorial over the puzzle. Registering
by path alone meant the suite had audited the front door of eleven apps and none
of their insides. Twelve states added, and **thirty new failures** — including
two whole classes that no landing page could have shown: a nested interactive
control in learn-letters' game, and a scrollable region in crawler's dungeon
that no keyboard can reach.

`geolocation` is the same problem one layer down. An app that behaves
differently when it knows where you are has states that no URL and no click can
reach, and a headless browser refuses the permission by default — so the suite
audits the fallback screen forever and never sees the real one.

```json
{ "path": "/", "name": "nearby", "open": [".intro-go"],
  "geolocation": { "latitude": 40.705277, "longitude": -74.005516, "accuracy": 8 } }
```

Both the grant and the position are applied before navigation: granting without
setting a position hands the page a request that never resolves, which looks
exactly like a refusal until you read the trace. Put the coordinates on top of
something in the target's own fixture — restroom-map's prompt only appears
within 60m of a place it already knows about, and only when the fix is accurate
to 40m, so a plausible-looking coordinate nearby is not good enough.

`install` overrides how a target's dependencies are installed on a fresh checkout.
story-tale-reader needs it: `sharp` is in its devDependencies for generating icons,
fixtures and its sample book — all committed — and sharp's postinstall downloads
libvips from a GitHub release. The Vite build never touches sharp, but that
download still had to succeed for the audit to run, and the day it timed out it
took the whole suite with it. `npm ci --ignore-scripts` skips it.

`dir` is what gets served. **Vite projects must point at `dist/`**, and must be
built with the base path Pages will serve from (`/<repo>/`) or every asset 404s.

## Determinism

A flaky visual suite gets ignored, so the harness pins everything that varies:

- `Math.random` is seeded and `Date` frozen to 2026-01-01 before page load —
  several of these apps generate content procedurally.
- Before each screenshot, pending `setTimeout`/`setInterval` are cancelled and
  Lottie's player is frozen at frame 0. Zeroing CSS animation reaches neither
  timer-driven DOM mutation nor `requestAnimationFrame` playback, and an idle
  animation caught mid-frame never matches twice. Opt out per target with
  `"freezeTimers": false`.
  This applies to the visual check only — stubbing `setTimeout` globally breaks
  axe-core, which drives its rule queue through it.
- Service workers are blocked, so a stale precache can't serve old assets.
- Animations and transitions are zeroed; fonts and images are awaited.
- Network-painted regions (map tiles) are masked per target.

- A state opened by `open` is waited for three ways before it is photographed:
  the press happens after motion is zeroed, then a bounded `networkidle`, then a
  quiet window with no DOM mutations. Each of the three was a measured flake, not
  a precaution — see the commit that added them.

- **Never rely on a gesture to bring hidden UI back.** story-tale-reader's toolbars
  are restored by a tap in the middle of the page, which works where two pages face
  each other — the tap lands on the stage between them — and does not where a single
  page fills the frame, because the tap lands inside the book's own iframe. The
  symptom is not a failed tap but a later failed click: a hidden bar is translated
  clear of the viewport, so Playwright reports the button as *visible, enabled and
  stable* and then *outside of the viewport*, which scrolling cannot fix. A state
  that needs a toolbar should act while it is still up, as `fix-layout` and
  `contents` both now do.

- A target that hides its own UI on a timer has to be waited for *by that state*,
  not by the clock. story-tale-reader drops its toolbars three seconds after the
  last interaction, and the harness's three waits take anywhere from well under
  that to well over it depending on how loaded the machine is — so the same code
  photographed with the toolbars up on a quiet laptop and down on a busy runner.
  Those states end with `{ "waitFor": ".chrome-top.hidden" }`, which turns the
  race into an assertion: the shot is taken once the hide has happened, and a
  hide that stops working fails the state instead of silently changing it.
  Its `fix-layout` state is the deliberate opposite — an open menu suspends the
  hide, so that one baseline holds the toolbars still and covers how they look.

Verified stable across repeated local runs and reproduced in CI: **90 visual
checks, five consecutive clean runs on macOS and zero visual diffs on Linux**.

The suite is **green** — 360/360 on Linux, across thirty pages and three
viewports. It has never been green before: 29 failures when the registry held
eleven front doors, 56 once the states behind a click were added. Everything
those found is fixed in the targets themselves, which is the only ending that
keeps a red suite from becoming wallpaper.

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

## Design review (driven by a Claude session)

The four automated checks can't judge whether a page *looks right* — only
whether it changed or broke a measurable rule. That judgement is left to a
Claude Code session: the harness captures screenshots, the session reads them.
No API key, no credits.

```bash
node scripts/serve.js &
npm run capture              # all targets -> design-review/shots/
npm run capture nail-salon   # one target
```

Then ask a session in this repo to `/design-review`, or just point it at the
PNGs. The skill in `.claude/skills/design-review/` tells it what to look for
and what to leave to the automated suite.

To review a project that isn't in `targets.json` — a session working in some
other repo wanting its own UI reviewed — skip the registry entirely:

```bash
AUDIT_DIR=/abs/path/to/project node scripts/serve.js &
AUDIT_DIR=/abs/path/to/project npm run capture
AUDIT_DIR=/abs/path/to/project npx playwright test layout.spec.js a11y.spec.js health.spec.js
```

`AUDIT_WAIT_FOR` handles client-rendered apps, `AUDIT_NAME` overrides the mount
name. The visual check needs a committed baseline, so skip it for ad-hoc runs.

It works: reviewing nail-salon and grumpy-bunny this way found decorative emoji
landing on top of the title and subtitle, and an illustration overlapping a
button's label — none of which the automated suite can see, and all of which
those two projects otherwise pass clean.
