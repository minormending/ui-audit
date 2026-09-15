# Design review — restroom-map: privacy, terms, filters

These three were never actually reviewed before. `capture.js` only read the
target-level `waitFor`, so privacy and terms waited for `.banner-count` — part
of the map shell that a standalone legal page never renders — and timed out
silently on every run. Fixed in `4ca8151`; this is the first look at them.

Captured through the suite's own harness (fixtures installed, map canvas
hidden, motion settled), so what is judged here is exactly what the baseline
records. Desktop 1280×800 and iPhone 13.

Audited at `c42b59b`. An earlier pass caught the previous revision, which
carried an amber "two things to fix before this is published" banner and
`[contact address]` / `[jurisdiction]` placeholders on both pages; those were
filled in mid-review and are gone.

---

## privacy — ship

Nothing to fix in the layout. One column, centred, ~594px at desktop; the
measure runs about 76 characters, right at the ceiling but not over it.
Heading hierarchy holds three levels without muddling them, vertical rhythm is
even throughout, and the phone version is a clean single column rather than a
squeezed desktop one.

| Sev | Where | What | Fix |
|---|---|---|---|
| low | Contact block | The Contact line is a **bare URL** — `github.com/minormending/restroom-map/issues` — while the same destination is a labelled prose link ("the project's issue tracker") higher up the same page. Two treatments for one link. On a phone the bare URL wraps mid-word, at `restroom-` / `map/issues`. | Defensible if the intent is a URL people can copy; otherwise label it like the other one. |

## terms — ship

Same structure, same verdict.

Same bare-URL note as privacy in the Contact block. Nothing else.

## filters — minor-issues

Desktop is correct: the panel is 336px and right-anchored under its button, so
the "84 places in view" count sits beside it and stays readable while you
toggle chips.

| Sev | Where | What's wrong | Fix |
|---|---|---|---|
| medium ✅ fixed | mobile only | `.filters-body` is `width: min(21rem, 100vw - 1.5rem)` with `right: 0`, which on a phone lands it at **exactly** the origin and width of the `.banners` stack — both `(12, 58)`, both 366px. It covers `.banner-count` completely. `styles.css:270` goes out of its way to keep that one banner alive while filtering (`display:none` on every other), so watching the count change as you filter is clearly the intent — and on a phone it is impossible. All that survives is the banner's green `border-left` leaking around the panel's rounded corner as a ~2px arc, which reads as a rendering glitch rather than as a number you were meant to see. | Offset the panel below the banner on narrow viewports, or drop `.banner-count` too when `is-filtering` and show the count inside the panel. |

Everything else in the panel is sound: chips wrap 4/4/2 without an orphan, the
ACCESS swatch colours are distinguishable, and the single-chip NEEDS group
reads as a group rather than a mistake.

---

## Baselines

Linux baselines refreshed twice: `334680f` caught the legal pages a commit
early and went stale within two minutes of being written, so they were
regenerated against `c42b59b`.

---

## The fix

`restroom-map@889136e` and `@18745b7`. The count now heads the filters panel,
above the controls that change it, and the banner stack is hidden outright
while the panel is open — the `:not(.banner-count)` exemption is gone.

Chosen over offsetting the panel below the banners, which would have coupled
two components' geometry to each other while the banner stack's height is
genuinely variable (info, hint, error and count can all stack), and would have
pushed a `max-height: 70vh` panel further down a short screen.

The count reads the same list it always did — `bathrooms.length`, the
server-filtered result set — so nothing about what the number means changed.
The banner is untouched whenever the panel is shut.

Re-running the baselines moved **only** the three `filters` images; `home`,
`privacy` and `terms` were byte-identical, which is the scope the change
should have had. Full suite green.
