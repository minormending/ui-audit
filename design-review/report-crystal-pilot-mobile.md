# crystal-pilot-mobile — design review and feature audit

v231 · 2026-09-14 · Crystal (`pokecrystal.gbc`) and Polished Crystal 3.2.3

> Filed under its own name because `design-review/report.md` is a shared path —
> a parallel session writing a nail-salon review overwrote the first copy of
> this mid-run.

## Re-audit on v230 — 2026-09-14

Full re-run after v228–v230: ten registered first-run screens, the sixty
automated checks **against the live deployment**, and both cartridges driven
through their openings at both viewports. 40 screenshots.

**Everything fixed stayed fixed, confirmed on both ROMs.** The status strip
wraps rather than truncating, the party summary is a total over its rows, the
Jobs and Save panes have room, and **Polished Crystal now completes in ~31s at
both viewports** — *"in the lab — your turn, Lyra is waiting"* — where before
this run it could not start a game at all. The first capture of Polished in
Elm's lab, three starter balls on the table, exists as of this run.

Automated: **60/60 against `https://minormending.github.io`**, not just
localhost.

### Two things this run turned up

**1. The pane fix traded hidden content for empty space — and the space cannot
be moved anywhere better.** *(investigated, not fixable as hoped)* Enlarging the pane viewport from 332px to 564px fixed the panes that
overflowed and left the ones that do not with more void: Party is 163px of
content in 564px, Dex 209px, Setup 214px — about 350–400px of empty panel each,
where before it was ~170px. That is the cost side of the v228 change and it was
not measured at the time.

Both proposed remedies were built and measured. Sizing the sheet to its content
(`align-self:end` on `.sheet`, `flex:0 1 auto` on `.panes`) works exactly as
intended — Party drops 564px → 185px, Jobs and Save are untouched, and the mode
strip stays at 476px from the top on every pane, which is why the *bottom* end
is the one to anchor. **But the space then reappears as bare red shell above
the game**, because the pad has stood down to give Jobs its room and a
fixed-aspect screen at full width cannot grow to fill what that frees. That is
the v226 defect in another colour, and worse than the empty panel it replaced.

So the space has to be nothing somewhere, and inside the sheet — matching the
panel it belongs to — is the least-bad place for it. Reverted; v231 stands.

The only remedy that removes it outright is to stop hiding the pad while the
menu is open, which returns the Jobs pane to a 332px window against 1144px of
content. That is now a more defensible trade than it was, since the fold's fade
reads correctly as of v231 — but it is a design call rather than a defect fix.

**2. ~~A fold cuts mid-glyph at rest, and the fade is shorter than a line.~~
Fixed in v231.**
Measured on the About card at 390px: 244px below the fold, and the container's
bottom edge lands **7px into a 15px line**, so the last thing on screen is a
half-height row of letter-tops at about 50% opacity. The 14px mask is shorter
than the line it has to hide. The same shows in pane content at rest — Polished's
Jobs pane cuts *WALK TO* through the middle. The v229 padding fixed the
*full-scroll* case only, which is a different case.

Fixed, and the obvious repair cost something that only a controlled comparison
showed. A plain 22px ramp faded the half-line to a ghost as intended **and
dimmed the last fully visible line with it** — a linear mask cannot tell which
pixels under it are a whole line and which are the top of a cut one. Held side
by side in one page (same crop, same text, nothing changing but the mask) the
line above the fold was visibly greyer than at 14px.

So the ramp is weighted rather than linear: 22 tall, over the tallest line box,
holding at nine tenths for six pixels and doing the work in the last sixteen.
The line above the fold stays as crisp as it was at 14; the cut line below goes
as faint as it did at 22. Re-audited on v231: *WALK TO* in Polished's Jobs pane
is legible where it used to be sliced, and the buttons under it ghost out.

### Two earlier findings that did not survive checking

Recorded here because both looked like defects and neither was: the **Polished
marts** were never broken (`--marts` reports 0 failures; I read a descriptive
line as one), and the **Dex summary** never duplicated (a total over a list of
species repeats none of them).

---

## What this run could see that earlier ones could not

Until now this target could only ever be reviewed **without a cartridge**: the
app draws nothing past the gateway without a 2MB ROM and a 1.8MB `.sym`, and the
Browser pane that development uses is hidden, where this core loads a ROM but
will not step it. So the pad, the mode strip, the five panes and the lens were
out of reach, and the registered target pinned the first-run experience only.

**A headless Playwright page steps it fine.** Measured at ~2,000 frames/second,
which plays Crystal's whole opening — title screen, name menu, downstairs, out
of the house, into Elm's lab, take a starter, out to the grass — in under a
minute, ending with a Lv5 TOTODILE on Route 29. Both ROMs load through the real
loader card via `setInputFiles`, so this is the user's own path, not a back
door.

That doubles what is under review: five first-run screens as before, plus the
five panes with a live game, on both cartridges.

The automated suite is **60/60 green** — contrast, ARIA, tap targets, console
errors, 404s and visual baselines. Everything below is outside what it measures.

---

## Fixed in this pass

The findings below are left as written — they are the record of what the review
found. All three of the headline defects have since been fixed and re-measured.

### 1. Pane clipping — `index.html`

The sheet shares the stage's grid area, so the panes were given the game
screen's height whatever they had to show. On the phone layout the pad now
yields while the menu is open (`body.menuopen .padwrap{display:none}`), and
`stage` being `minmax(0,1fr)` absorbs the row; the two layouts that keep the
game visible restore it — landscape as `contents` rather than `block`, because
that layout dissolves the wrapper to give the d-pad and face buttons their own
grid areas and a box back collapses both into one cell. `.panes` bottom padding
went 2px → 16px so the last row clears the 14px fade: at 2px a pane scrolled to
the bottom looked exactly like one that had not been.

Measured at 390×844 with a game running, before → after:

| | pane viewport | Jobs hidden | Save hidden |
|---|---|---|---|
| before | 332px | 812px (71%) | 238px |
| after | **564px** | **580px (51%)** | **6px** |

Save is effectively fixed. Jobs still scrolls — 1144px of content does not fit
any phone — but the window is 70% larger, the heading is no longer sliced
mid-glyph, and the ten-key grid, Wait and Run-the-list are all reachable with
the fade now meaning what it says. Desktop is unchanged by design (607px
viewport, Jobs still scrolls 300px): there the sheet has a grid area of its own
and nothing has to yield.

### 2. Polished's blocked intro — `gen2/menus.js`

`continueGame` now sends a B every twelfth press (`INTRO_ESCAPE_EVERY`),
checked *after* `takeNameMenu` so it can never be the press that answers the
name menu, and the budget went 20,000 → 60,000 frames (`INTRO_FRAMES`).

### 3. The flaky lab leg — `gen2/journey.js`

Root-caused rather than papered over. `through()` began planning the instant the
previous leg returned — which is mid-warp. Measured at that moment on Polished:
the map read 24.2 correctly, but `collision.calibrate` returned **no offset and
no position at all**. `walkTo` then plans on whatever the collision reader last
had, which is the room just left, and the pilot walks back out through its own
front door — which is exactly where three failing runs ended, in PlayersHouse1F
reporting *"could not get into the lab"*.

`crossEdge` has always settled before it plans; `through` did not. It does now,
once per try rather than once per leg, because the map changes under that loop —
that is what the loop is for. Unlike `crossEdge` a failure to settle is not
fatal here: a doorway leg can begin inside a script holding the controls, and
the loop below already knows how to answer one.

There was already an unused `nav.awaitMapChange` written for this exact hazard,
with a comment describing it precisely and **no callers**.

### Result

**Polished Crystal's driver now completes, 3 runs out of 3** — *starting a new
game → going downstairs → out of the house → into Elm's lab* — ending on map
24.3 with *"in the lab — your turn, Lyra is waiting"*, the handover the profile
was always written to reach. Crystal is unaffected: 3 runs out of 3, all nine
legs, *"ready on Route 29 with a Lv5 TOTODILE"*, and 56–67s against 52–58s
before, so settling costs a few seconds and no correctness.

Still green after all three: 970 behaviour tests, `tools/check-app` 35/35, and
the ui-audit suite 60/60. (The suite was last run after the CSS change; the
`journey.js` change cannot reach those screens, which have no cartridge, so
`through()` never runs there.)

---

## Design review

### Home — `ship`

Clean on both sizes. Two notes, neither a defect:

- Desktop reserves a ~490×450 black screen in the left column before any ROM is
  loaded; mobile hides the stage entirely at the same state. The desktop box now
  has its bezel drawn so it reads as a switched-off device rather than the bare
  shell that was fixed in v226, but the two viewports tell different stories
  about whether there is a device there at all.
- Both sizes carry a lot of empty panel below the cards (~400px mobile,
  ~440px desktop). Harmless, but the card floats rather than sits.

### Loader — `ship`

No issues. **Do not re-report the gold ring** on *Symbols (.sym)*: it is
`label.file:hover` (index.html:733) catching the harness's cursor where the
`#gate-files` click left it. `document.activeElement` is `BODY`, and the ROM
label is unstyled. It is a capture artifact, not an emphasis on the wrong step.

### Watch — `minor-issues` → fixed

- **~~Low — status strip, mobile.~~ Fixed in v229.** The line truncated: *"no
  ROM needed here — type the co…"*, with `Menu ▴` holding the right edge.
  Measured across the twenty-one strings the app can put there: seven cut
  mid-word at 390px, eight at 375px. Every one fits in two lines and none wants
  a third, so `#status` is now a two-line clamp — which bounds it as well as
  widens it, since 400 characters leave the bar exactly as tall as 53 do (92px
  against 76px). `#steps` and `#saying` keep one line deliberately: a live tail
  and a live quote that change every few frames would jitter the screen and pad
  if the bar grew with them.
- **Info.** The code field's placeholder `K7M2P` reads like a prefilled value
  rather than an example. An `e.g. K7M2P` framing would remove the ambiguity.

### About — `needs-work` → improved

- **Medium — prose is cut mid-sentence, mobile.** `#panes` was 461px tall
  against 691px of content: 230px below the fold, ending mid-word under a fade.
  The container is `overflow-y: auto`, so it does scroll — but with overlay
  scrollbars on iOS there is no affordance saying so, and the fade read as a
  styled ending rather than as more text. This is the card that explains what
  the app is and why it needs two files, to somebody who has neither. The 16px
  bottom padding above fixes the fade misfiring at full scroll; the card is
  still taller than its window, which is legitimate for prose.

### Settings — `ship`

No issues. The strip's right-hand control correctly changes from `Menu ▴` to
`Close ▾`, which is the one piece of state the gear needs to communicate.

### Jobs pane — was `needs-work`, now fixed  *(newly reviewable)*

This is the app's primary control surface — travel, the level advice, what to
look for here, where to walk, what to grind to. On a phone 71% of it was off
screen in a 332px window, sliced mid-glyph. See *Fixed in this pass*.

What a phone user could not see without discovering the scroll: the contextual
advice (*"FALKNER tops out at Lv9 and your best is Lv5 · slow here — ROUTE 27
gives Lv28–32, two maps away"*), the LOOK FOR chips, the WALK TO destinations,
and the whole GRIND TO row.

### Save pane — was `needs-work`, now fixed  *(newly reviewable)*

570px of content in a 332px viewport, with the *Export / Download* row sliced
through the middle of its own label. Now hides 6px.

### Party pane — `minor-issues` → fixed in v230  *(newly reviewable)*

- **~~Low — the summary repeats the first row.~~ Fixed.** `#panel` is a
  `<details open>`, so summary and content are both drawn, and `describeParty`
  filled the summary with the lead and its health — on a party of one, the row
  underneath it word for word. The line was not wrong, it was in the wrong
  place: it was written for the offers card, *above the two jobs those facts
  decide*, with the bars a tap below. It is a total now
  (`describePartyTotals`, *3 Pokémon · 1 hurt*), matching the Pokédex beside it.

### Dex pane — `ship`  *(correction)*

This review reported the Dex summary as duplicating too. **It never did.**
*1 caught of 251 · 1 seen* is a total over a list of species and repeats none of
them — which is exactly the shape the party summary has now been moved to. Both
panes fit their viewport and are clean.

### Setup pane — `ship`  *(newly reviewable)*

Fits at every size measured with a game running.

### Status strip — fixed in v229 (all screens)

The truncation noted under *Watch* recurred with a cartridge in: on the title
screen the strip read *"Press Start, then play until you are out i…"*. It now
reads in full over two lines, confirmed on a live cartridge. The place/money
header above it is fine at every width tested.

---

## Feature audit — Crystal vs Polished Crystal

### Crystal — works end to end

`boot.run('totodile')` plays the opening clean, every leg reporting. The static
readers agree with the cartridge throughout: 18 declared maps all reachable,
both gyms resolve to a talkable leader on the right badge bit, both marts to a
clerk, the app's declared menu shapes match (`battleMenu`, `switchBox` — "and
the app agrees"), every matched phrase present, 0 problems in wilds and items.

### Polished Crystal — the opening is fixed; the marts are not

`titles/polished.js:743` carried a comment saying its driver "has not been run
on a live game" because the pane available at the time was hidden. It has now
been run — see *Fixed in this pass* for the two defects that found, both fixed.

**Correction — the marts were never broken.** This review reported that 7 of 9
marts "do not resolve to a clerk". That was a misreading on my part:
`tools/rom-events --marts` counts only `!!` lines as failures, and on Polished
it reports **0 failures, exit 0**. Eleven of its twelve marts are fine and
always were; the check merely could not *name* their clerks, printing "a
type-5 object, whose two bytes are not a pointer" — true, uninformative, and
easy to mistake for a fault, which is exactly what happened.

Fixed anyway, because a line that shrugs is a line the next reader misreads
too. **A command object's two bytes are operands, not an address.** Measured:
every one of the eleven command-type clerks is sprite 152 at (1,3) carrying
command **0x92** with `dialog 0` and a mart id that differs per town (2 Violet,
3 Azalea, 0x0c Ecruteak), while command objects that are not clerks carry 0x51.
Cherrygrove's is the one written as a script, which is why it alone resolved.

`world.objectsOn` now returns `command: {id, args}` and a **null** `script` for
a command object, so no caller can resolve operands into a confident wrong
name; `titles/polished.js` declares `commands: { pokemart: 0x92 }`. `--marts`
now reads *"a mart clerk — pokemart(dialog 0, mart 2)"* for all eleven, which
confirms not just that somebody is standing there but that it is a shopkeeper
and which shop. `--verify` lost nine false positives in the same change
(22 → 13 disagreements) — command operands that happened to land inside
trainer symbols, `FuchsiaMart: TrainerCooltrainermFinch` among them.

Crystal is untouched by all of it: it has no command objects, and its mart,
verify and check-app numbers are identical before and after.

**Open — a thirteenth mart the app does not declare.** `SaffronMart` (25.3) has
a clerk at (1,3) like the rest, but no warp anywhere in the ROM leads into it
and Saffron City is not in the readable map list, so it cannot be declared
without guessing — and the check would rightly reject a guess. Left alone.

**Still open — three unchecked notes on menus and phrases.**
`BattleMenuHeader` and `BattleMonMenu.MenuHeader` are absent from its symbol
file, so the shapes the app declares for them go unverified; and *"left column 2
is claimed by no header here, so 'the Bug-Catching Contest' will not be
recognised on this cartridge"*. `--phrases` cannot check `sent to` because
Polished does not store that text as plain bytes.

**Context.** Polished's graph is much larger and fully reachable — all **8
gyms** resolve with correct badge bits and doors, against Crystal's 2 — so the
profile's map and gym data is in good shape. Symbol coverage is thinner (75.7% /
70.7% of object scripts landing on a symbol, against Crystal's 98.5% / 86.3%),
and `--verify` finds 22 type/name disagreements in 2108 objects against
Crystal's 12 in 1336.

### Summary

| | Crystal | Polished Crystal 3.2.3 |
|---|---|---|
| Loads, boots, steps | yes | yes |
| Plays its own intro | yes, to a starter in the grass | **yes**, to the lab handover |
| Walking legs | all pass, 3/3 runs | all pass, 3/3 runs |
| Gyms declared / resolving | 2 / 2 | 8 / 8 |
| Marts declared / resolving | 2 / 2 | 12 / 12 |
| Menu shapes checkable | yes | 2 headers absent from `.sym` |

---

## Worth doing next

Nothing. Every finding in this review is fixed and deployed, or was a
misreading and is corrected above.

- **v228** — the pane clipping, Polished's blocked intro, the mid-warp
  planning, the command-object reader.
- **v229** — the status strip truncation.
- **v230** — the party summary duplication.

Two findings did not survive checking: the Polished marts were never broken
(the check reports 0 failures; I misread a descriptive line), and the Dex
summary never duplicated. `SaffronMart` is documented as deliberately excluded —
no warp leads into it.
