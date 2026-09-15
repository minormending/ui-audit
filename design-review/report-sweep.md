# Design review — the remaining nine targets

grumpy-bunny · learn-letters · tidy-up · crest-cards · behaviour-garden ·
crawler · crystal-pilot-mobile · nyc-lyfe · calcuken

Captured through the suite's own harness rather than `capture.js`, so fixtures
are installed and the client-rendered targets are actually reached. 48 shots,
desktop 1280×800 and iPhone 13. **Zero console errors and zero failed requests
anywhere.**

Two passes: every page measured in the DOM for reachability and overflow at
both viewports, then the screenshots read by eye. The measuring matters — the
worst finding below is invisible in a screenshot, because a full-page capture
renders content that a phone cannot scroll to.

---

## needs-work

### learn-letters — half the game is unreachable on a phone

| Sev | Where | What's wrong |
|---|---|---|
| **high** | `game`, mobile | **Three of six modes cannot be reached.** The document is exactly 664px — the viewport — and nothing on the page scrolls. "Listen & Blend", "Blend It" and "Build It" sit at y 673–1012, past the bottom edge, along with their three `?` help buttons. `scrollIntoView` moves them 0px; there is no scrollable ancestor, and no scrollable document. On desktop all six show in a 3×2 grid — and the one the app badges **START HERE** is in the row a phone cannot get to. |

That badge is what makes this more than a layout nit: a child handed a phone
is told to begin with a mode that isn't there.

### crawler — the prologue stops mid-sentence, and the way in is below the fold

| Sev | Where | What's wrong |
|---|---|---|
| medium | `dungeon`, both | The Act I ledger is cut at "*The clerks give you a lamp, a ledger, and the name*" and the CLOSE THE LEDGER button sits over the rest. `div.page-inner` does scroll — 267px hidden on mobile, 111px on desktop — but it carries no fade, shadow or any other hint, so the text reads as truncated rather than continued. |
| medium | `home`, mobile | **"Enter the dungeon" — the only way into the game — starts 16px below the fold.** Reachable, via 262px of scroll inside `div.screen`, but nothing signals it: the visible page ends mid-sentence on a trade description. |

## minor-issues

### grumpy-bunny

| Sev | Where | What's wrong |
|---|---|---|
| medium | `home`, both viewports | **The bunny's ears cross the "For grown-ups" button and sit over its label**, which is the one piece of text on that screen a parent is looking for. Reproducible at 1280 and at 390. |
| low | `grownups`, desktop | The bottom fade dims the last line of the footnote even though nothing is clipped — measured, the text block does not overflow at all on desktop. The fade is unconditional, so it greys out content that is already fully visible. |
| low | `sizes`, mobile | The heading starts ~40% down the screen with roughly 600px of empty space above it and another 450px between the three cards and the bunny. The block reads as having drifted rather than as having been placed. |

### nyc-lyfe

| Sev | Where | What's wrong |
|---|---|---|
| low | `create`, mobile | The coach-mark step counter wraps: "1 /" on one line, "2" on the next. Measured 36px tall against an 18px line-height — two lines — in a 34px-wide box. One line on desktop. |

### tidy-up

| Sev | Where | What's wrong |
|---|---|---|
| low | `home`, both | In each job row the destructive **×** is sandwiched between the two reorder arrows. Three same-sized targets in a vertical stack, the middle one deleting the job — the arrangement invites the mis-tap it cannot undo. |

## ship

**tidy-up** `child` · **crest-cards** `home` `game` · **behaviour-garden**
`home` `art` `garden` · **crystal-pilot-mobile** `home` `loader` `watch`
`about` `settings` · **calcuken** `home` `puzzle` · **learn-letters** `home`
(and `game` at desktop) · **nyc-lyfe** `home` `howto`

Nothing to fix in these. Worth calling out: tidy-up's child screen and
crest-cards' menu are the two cleanest things in the set — unambiguous
targets, honest disabled states, no decoration fighting the content.

---

## Checked and deliberately not reported

Four things that look like defects in a screenshot and are not:

- **nyc-lyfe's modal scrim appearing to stop at the fold.** `div.coach-overlay`
  is `position: fixed`, so a full-page capture pins it to the first viewport
  and everything below renders undimmed *in the image only*. A real viewer
  scrolling keeps the scrim. Artifact of the capture, not the page.
- **behaviour-garden's art sheet cut off horizontally.** The table is inside a
  div with 810px of horizontal scroll — the correct pattern, and the columns
  are reachable.
- **tidy-up, crystal-pilot-mobile `about`, crawler `home` controls past the
  fold.** All three have a real scrollable ancestor; `scrollIntoView` brings
  them on screen. Only crawler's is listed above, and for the affordance
  rather than the reachability.
- **calcuken's grid lines appearing to end in arrowheads.** The taper is the
  thin internal rule meeting the thick cage border; invisible at 1×.

## Coverage

All 30 pages × 2 viewports were measured in the DOM. 14 screenshots were read
closely by eye, covering at least one page of every target and every page of
grumpy-bunny, learn-letters and crawler. The pages listed under **ship** that
were not opened individually are ones the probe found structurally sound — if
any of them carries a purely visual flaw, this pass would not have caught it.
