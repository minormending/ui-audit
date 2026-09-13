---
name: design-review
description: Review a web UI's visual design by looking at real screenshots. Use when asked to design-review a page, check how a UI looks, critique spacing/hierarchy/contrast, or verify a UI change looks right. Runs the ui-audit harness to capture screenshots, then reads them directly — no API key, no credits beyond this session.
---

# Design review

You are the reviewer. The harness only captures screenshots; **you** look at them
and judge. Do not write a script that calls an API to do this — read the PNGs
with the Read tool and form the opinion yourself.

## 1. Capture

The harness lives in this repo. From its root:

```bash
node scripts/serve.js &          # static server on :4173
node scripts/capture.js          # all registered targets
node scripts/capture.js tidy-up  # one registered target
```

To review a project that is **not** in `targets.json` — the common case when a
session working in some other repo wants its own UI reviewed:

```bash
AUDIT_DIR=/abs/path/to/project node scripts/serve.js &
AUDIT_DIR=/abs/path/to/project node scripts/capture.js
```

Add `AUDIT_WAIT_FOR='#root > *'` for a client-rendered app, and
`AUDIT_NAME=my-app` to override the mount name. If the project is a Vite build,
point `AUDIT_DIR` at its `dist/` and build it first with the base path it will
be served from, or every asset 404s.

Screenshots land in `design-review/shots/` as
`<target>--<page>--<desktop|mobile>.png`. Stale shots are deleted on each run,
so whatever is in that directory is current.

Kill the server when done: `pkill -f scripts/serve.js`.

## 2. Look

Read every captured PNG. Judge only what is actually visible — do not infer
defects from the source, and do not report taste preferences as defects.

Look for:

- **Spacing** — inconsistent gutters, cramped or orphaned elements, broken rhythm
- **Alignment** — items that should share an edge or baseline but don't
- **Typography** — too many sizes or weights, weak hierarchy, line length past
  ~75 characters, text that looks clipped
- **Colour & contrast** — text that reads as low-contrast, muddy or clashing pairs
- **Layout** — awkward wrapping, dead space, elements cut off or overlapping
- **Affordance** — buttons that don't read as buttons, unclear primary action
- **Responsive** — compare the desktop and mobile shots of the same page; flag
  anything that degrades rather than adapts

## 3. Report

Write `design-review/report.md`: one section per page, a verdict of `ship`,
`minor-issues` or `needs-work`, then each issue as severity, where it is, what
is wrong, and the specific fix. Say plainly when a page is fine — an empty
issue list is a valid and useful result.

Then tell the user the verdicts and the issues worth acting on. Don't paste the
whole report back at them.

## Scope

This covers what a screenshot can show. It does **not** replace the automated
suite — run that too, since it catches things the eye misses:

```bash
npx playwright test        # visual regression, layout, a11y, health
```

Contrast ratios, ARIA correctness, tap-target sizes, console errors and 404s
are all measured there. Don't eyeball them here; if the user cares about those,
run the suite and read its report instead of guessing from a picture.
