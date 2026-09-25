# Verification — the QA loops that keep the site trustworthy

Read at Phase 2 (boot check), after every module, and in full at Phase 9.
The exemplar's rule: verify in the LIVE browser, on source AND on the built
dist, with zero console errors — every time.

Three loops, and **all are mandatory**; they catch different things:

| Loop | Catches | Run it |
|---|---|---|
| **A. Glitch sweep** (automated, `.claude/glitch-scan.js`) | geometry: stray scrollbars, cut labels, dead tabs, hollow values | P2, after each module, P9 at 3 widths |
| **B. Screenshot loop** (your eyes on rendered pixels) | wrong copy, illegible glyphs, ugly overlap, bad contrast | P9 on every page type, + any page you changed |
| **C. Figure fidelity** (your figure vs the rendered SOURCE slide) | a beautiful, clean, **wrong** diagram | P5 as each builder is written, and P9 |

Never claim a site is verified having run only one of them. The sweep passes
happily on a page that says "Section A — MCQ theory" for a written-only exam;
eyes never notice a 6px scrollbar. And **both A and B pass a waveform that is
drawn perfectly and is physically wrong** — that is what loop C exists for.
The user reports all three as "glitches".

---

## A. The glitch sweep (automated) — run it, don't ask for permission

`.claude/glitch-scan.js` ships with the template. It is not part of the site
(nothing references it) — it is injected into the live page.

```js
// inject AND run in one call
(async () => {
  const s = await (await fetch("/.claude/glitch-scan.js?cb=" + Date.now())).text();
  (0, eval)(s); CCScan.reset();
  const r = await CCScan.sweep();
  return JSON.stringify({ pages: r.covered.length, covered: r.covered, findings: r.findings });
})()
```

> ### Static elements stack too — check 7 alone is not enough
>
> `OCCLUDES` only collects `position: absolute | fixed`. The commonest phone bug
> is ordinary flow content landing on itself: a container with a fixed `height`
> whose contents wrap. On one build the topbar's four nav links wrapped to three
> rows inside `height: 60px`, and `align-items: center` centred the overflow —
> the first row rendered at **y = −40**, clipped off the top of the page, and the
> last **39px below the bar, over the hero**. Every element involved was static,
> so the sweep reported the page clean and the owner found it on a phone.
>
> Checks 9–11 cover it: **ABOVE VIEWPORT** (anything with `top < -2`),
> **STACKED** (text-node rect intersection, sweep-line) and **VOVERFLOW** (a
> height-locked box whose content is taller than it).
>
> Three tuning lessons, each of which cost a false-positive round:
> - **HTML range rects are LINE boxes.** They include leading, so two block
>   siblings in normal flow report 2–3px of overlap with their ink comfortably
>   clear. Threshold HTML at 4px; SVG rects are tight to the glyphs, so 2px.
> - **Some overlap is the design.** A flip card stacks its two faces
>   (`.face.back` carries `rotateY(180deg)`); a sticky bar passes over content.
>   Skip those **as pairs**, never by whitelisting the container — otherwise a
>   real collision inside a card or inside the bar goes unseen.
> - **SVG has no CSS overflow box.** `scrollHeight`/`clientHeight` on an SVG
>   element are meaningless; VOVERFLOW must skip them.

**Always read `covered` and check the page count.** It should be
`routes + modules × tabs` (a 5-module site with 5 tabs each and 4 shared routes
is 29). An empty `findings` list is unfalsifiable on its own — that is exactly
how the bug below survived a whole session of green runs.

> ### The `settle: 0` trap — read this before "optimising" the sweep again
>
> A hidden browser pane backgrounds the tab and clamps `setTimeout` to ~1 s, so
> the original 400 ms-per-route pause turned a 1.3-second sweep into **11½
> minutes** and looked hung. The fix was `{settle: 0}`, documented as "same
> coverage, 545× faster".
>
> **It was not the same coverage.** `settle: 0` dropped the pause to
> `Promise.resolve()` — a **microtask** — while `location.hash = …` fires
> `hashchange` as a **macrotask**. The router had not run when `scan()`
> measured, so the sweep **re-scanned the previous page on every route** and
> reported a confident zero for content it never rendered. Every green sweep for
> a whole session had been measuring the home page.
>
> Caught by injecting an over-wide unwrapped table into a module's *data* (so it
> survives the re-render): `CCScan.scan()` called directly reported
> `CLIPPED DIV.sum-body 2157>350`; `sweep({settle: 0})` reported nothing.
>
> `sweep()` now waits on the **hashchange event** and yields real macrotasks via
> **`MessageChannel`**, which background throttling does not clamp — fast *and*
> actually on the page it claims to scan. `settle` remains as an optional extra
> pause; you should not need it.
>
> **The general lesson: a fix aimed at a timing symptom can silently change what
> a check can see. Any change to a gate must be re-proven with a deliberate
> regression, not merely re-run.**

**Run it at three widths** — resize the viewport between runs and re-run
`CCScan.reset(); CCScan.sweep();` (no reload needed, the functions survive):

| Width | Why |
|---|---|
| **390** | phone — the tightest layout |
| **~510** (browser-pane native) | the width your screenshots are legible at |
| **1280** | desktop — where the 2-column solve area kicks in |

### The occlusion check — why it exists

Check 7 (`OCCLUDES …`) flags an absolutely/fixed-positioned element sitting on
top of a figure or of other text. It was added after value chips shipped
*repeatedly* laid over the waveforms they annotated: every other check passed,
and the screenshot loop could not run because the browser pane was hidden, so
nothing caught it until the user sent a screenshot.

Two things make it trustworthy, and both matter if you extend it:

- **It compares INKED area, not element boxes.** A block's box routinely reaches
  far past its glyphs (padding, a short line in a wide container), so box-vs-box
  cries wolf. Text extent comes from a `Range` over the text nodes; an `<svg>`
  counts as its whole box.
- **Intentional overlays are whitelisted** (`.topbar`, `.exam-bar`,
  `.quiz-score`, `.wt-player`, `.confetti`, `[data-allow-overlap]`). If you add a
  deliberate overlay, whitelist it — never widen the tolerance.
- **Collapsed `<details>` content is excluded, and expanded before scanning.**
  Chrome collapses a `<details>` with content-visibility, not `display:none`, so
  its children still report layout boxes and `offsetParent` — every row stacks at
  one y and the geometry checks invent overlaps nobody can see (a closed lecture
  group reported `SPAN.num covers P.muted`, while the same group open measured a
  110px gap). `vis()` therefore treats collapsed content as hidden, and `sweep()`
  calls `expandAll()` on every route and tab first, so folded sections are still
  covered — measured open, where their layout is real.

**Prove a new detector works by reintroducing the bug.** Run the scan on the
fixed page (expect clean), then re-break it in the console and scan again
(expect the finding). A detector that has only ever seen passing pages is not
known to detect anything.

**A finding is a hypothesis until you have measured it.** Before changing any
page CSS, dump the two rectangles the checker compared and confirm the overlap
is real at the width reported. The false positive above would have been "fixed"
with a padding hack on a card that was never broken. Fix the detector when the
detector is wrong — a gate that cries wolf gets ignored, which is worse than no
gate at all.

### Expand EVERYTHING before scanning — check what the sweep cannot see

`expandAll()` opens two different collapse mechanisms, and missing either one
silently voids whole pages of coverage:

- native `<details>` (lecture folds, tips, flagged-for-review);
- the summary engine's **`.sum-sect` / `.open` class pair**, which hides its body
  with `display:none`.

**Every figure inside a lecture summary lives in a `.sum-sect`.** Before that
second line existed the sweep was checking none of them — a module shipped with
an SVG caption running outside its own viewBox, and check 4 (`SVG TEXT CUT`)
never fired because the figure was never visible when scanned. The moment the
expansion landed, that same sweep also caught an unwrapped `<table>` clipping its
last column and `<pre>` blocks overflowing at 390 px.

So: when a check "passes", ask what it was allowed to look at. A green gate over
hidden content is not a green gate. If the project adds a third collapse
mechanism, teach `expandAll()` about it in the same commit.

**The gate: `findings: []` and `errors: []` at all three widths, on the source
tree AND on `dist/index.html`. P9 cannot be ticked while any finding stands.**
Report the result in the P10 handoff ("swept at 390/510/1280, zero findings").

### What it checks (each check exists because a real build shipped that bug)

1. `PAGE OVERFLOW` — the page scrolls sideways.
2. `OUTSIDE` / `CLIPPED` — an element past the viewport edge, or clipping its
   own content without being scrollable.
3. `EMPTY FIGURE` / `SVG COLLAPSED` — a `data-figure`/`data-graph` that
   hydrated to nothing.
4. `SVG TEXT CUT` — label/caption drawn outside its own viewBox.
5. `BRAND SPILLS` — topbar contents escaping the bar.
6. `EMPTY PANEL` — a stepper tab that opens a blank view (dead navigation).
7. `TEXT LEAK` — `undefined`, `NaN`, `[object Object]`, `{{PLACEHOLDER}}` or a
   hollow `0/0` in visible text.

False positives come from containers that are *supposed* to overhang — add
them to `ALLOWED` in the script (or `data-allow-overflow`) only after
confirming the overhang is intentional.

### The glitch catalogue — seen in the wild, fix at the root

| Symptom | Root cause | Fix |
|---|---|---|
| 6px scrollbar on every prose page | an element with `transform: rotate(90deg)` — a **non-square box grows its bounding rect sideways** when rotated (e.g. a ▾ chevron) | give the rotated element a square footprint (`width:16px;height:16px;line-height:16px;display:inline-block`) |
| nav wraps into the page / logo overlaps title | flex bar with a fixed `height` + `flex-wrap:wrap` children | at narrow widths let the bar grow (`height:auto`) and make the nav one `overflow-x:auto` row |
| long heading pushes a sibling out of the box | flex child defaults to `min-width:auto` and refuses to shrink | `min-width:0` on the flex child |
| figure captions/labels cut at the SVG edge | text centred at `W/2` (or anchored `end` at a small x) longer than the viewBox | fit text to the box — shrink font to fit, wrap only when it would go below ~8.4px (`fitTxt` in `figures.js`) |
| a tab opens an empty panel | the stepper is a hardcoded list; that content type is empty in this build | derive the step list from the data (`if ((m.quiz \|\| []).length) steps.push(…)`) |
| page states something the data contradicts (e.g. "Section A — MCQ theory" on a written-only exam) | engine hardcodes copy that assumes a bank shape | build the copy from `bank.sections` |
| a stat reads `0/0` | a score tile that assumes auto-graded questions exist | branch on the count; show `—`/`✔` and a truthful sub-label |
| unreadable glyphs in dense UI (①②③, tiny sub/superscripts) | decorative Unicode at table font size | use plain digits in tables; keep decorative glyphs for body-size prose |
| a `position: sticky` bar doesn't stick at all | its **wrapper is exactly as tall as it**, so sticky has no room to travel (the template's `#topbarHost` wraps `.topbar`) | move `position: sticky` onto the wrapper, or give the wrapper the travel room |
| a sticky element in a grid/flex row never pins | as a grid item it **stretches to the full row height**, so its box already spans the container | `align-self: start` on the sticky item |
| two pieces of text collide into overlapping columns | a `display:flex` row containing a bare text node plus a span, with `flex-wrap: nowrap` — each becomes its own column and wraps internally | `flex-wrap: wrap` + let the secondary span take `flex: 1 1 100%` so it drops to its own line |
| stepping through a walkthrough scrolls the thing you're watching off-screen | `scrollIntoView` on the step, with nothing pinned | pin the primary artifact (the table) with `position: sticky`, publish its height as a CSS var, and give the steps `scroll-margin-top` so they land *below* it — never underneath |
| raw `θ_0` / `^2` showing in one place but rendering fine in another | `mathify` (M) applied to *some* content fields and not others — summaries and step labels were injected raw | grep for every `innerHTML`/template insertion of a data field and confirm each goes through `M(...)`. Audit after adding any new content field |
| a subscript swallows the next variable: `θ_1x_1` → θ₍₁ₓ₎ plus a stray `_1` | mathify's `_(\w+)` is greedy, so `_1x` matches | brace it — `θ_{1}x_1` — and scan the data for `[A-Za-zθ]_\d[A-Za-z]` before shipping |
| mathify corrupts a figure's `data-opts` JSON | the substitutions run over raw HTML, so `_`/`^` inside an **attribute value** get rewritten too | mask every `<...>` tag before the sub/sup pass and restore after (the bundled util.js does this — never regress it) |
| arrows, parentheses or minus signs appear on the wrong side of a phrase | one **RTL run** (an Arabic/Hebrew word) in an otherwise LTR string — the Unicode bidi algorithm reorders the *neutral* characters around it | drop the RTL word (describe it in English) or wrap it in `<bdi>`. Scan the data: `/[֐-ࣿיִ-﻿]/` |

---

## B. The screenshot loop (your eyes) — P9, non-negotiable

> **If you could not take screenshots, you did not run this loop — say so.**
> On a real build the browser pane was hidden, every `computer{screenshot}` call
> timed out, and the build was reported as "verified" on the strength of the
> sweep and text reads alone. Three separate visual defects shipped that way and
> the user found all three by eye. Rules:
>
> - Never write "verified" / "checked visually" for a loop you did not run.
>   Name the gap in the handoff, every time it applies — not once and then
>   quietly dropped.
> - A blocked screenshot is a prompt to make the defect class **machine-checkable**
>   (that is where loop A's occlusion check came from), not a reason to skip it.
> - Retry the screenshot when the user is plainly looking at the page — pane
>   visibility changes during a session, and one good frame is worth more than
>   any amount of DOM reading.

The automated sweep cannot see *meaning*. Take real screenshots and read them.

**Practical note on width:** the browser pane has a native size (~510px CSS).
Setting a larger viewport renders the page scaled-down into the pane and the
screenshot is illegible; `zoom` region-crop is not supported. So:
**screenshot at the pane's native width**, and use the automated sweep for the
other widths. If a desktop-only layout must be seen, verify it with
`read_page` + measured `getBoundingClientRect` values instead.

Shoot at least one of each page type, scrolled to the content that matters:

1. home (hero + plan + progress tiles)
2. a lecture: Learn (prose + a hydrated figure), Worked (mid-walkthrough, so
   highlights/chips/tables are in their *partial* state), Practice
3. rules · revision · exam intro · exam mid-attempt · exam report
4. every page you changed this phase

Read each shot for: text that contradicts the build, numbers that look wrong,
labels sitting on top of each other, chips covering the values they annotate,
glyphs too small to read, anything that would make a tired student at 2am go
"what?". Fix, rebuild, re-shoot.

**Then use it like a student would, on a phone**, and watch what moves:

- Step through a walkthrough on a 390px viewport. Does the thing you are meant
  to be *watching* (the table, the figure being redrawn) stay on screen, or does
  each step drag you past it? Pin the primary artifact; let the secondary one go.
- Scroll a long page. Which element follows you? If the answer is not the most
  important one on the page, that is a bug — it was on the exemplar (the figure
  followed the reader while the table it annotated scrolled away).
- Check the sticky stack adds up: topbar + pinned artifact must still leave
  room to read. On a phone, 94px of permanent chrome is usually too expensive —
  prefer sticky-on-desktop-only and give the artifact the top of the screen.

---

## C. Figure fidelity — your diagram against the professor's own

**When:** as you write each `figures.js` builder (P5), and again at P9 for any
builder you touched. **Never skip it because the figure "obviously" follows from
the formula** — that reasoning is precisely what fails here.

Loops A and B cannot help you. A figure that is crisply drawn, correctly sized,
perfectly legible and *physically wrong* sails through both. Only a side-by-side
against the source catches it.

**The procedure:**

1. Render the source slide (extraction.md § render ladder) and Read it. Crop and
   magnify the figure panel if the traces are small.
2. Put your builder's output beside it and compare **trace by trace** — not
   overall impression:
   - every trace present, in his order and with his axis labels;
   - for each: which intervals are positive, negative, and **zero**;
   - discontinuities — where the jumps are and how big;
   - annotations — conduction-pair labels, angle marks, arrows he draws.
3. Where a claim is machine-checkable, assert it rather than eyeballing it:
   sample your polyline at a few angles and check the sign against theory; scan
   the SVG for a wire crossing a device; assert a current trace never touches its
   axis. Put these in the project's accuracy checker so they cannot regress.

**The failure this loop exists to catch** (all three shipped on a real build):

- A rail drawn as one unbroken line with component symbols laid *on top* — the
  schematic short-circuits every device and the load, and it looks fine.
- A "constant" current drawn as a flat line where the professor's slide shows
  ripple that never reaches zero.
- A zero region where the source shows conduction (or the reverse). This is the
  one formulas hide: the integral limits pin down one trace and say nothing
  about its neighbours.

A student copies these into the exam. Treat a figure defect as CRITICAL, at the
same severity as a wrong number.

---

## D. Before you ship new content — the authoring checklist

Loops A and B are diagnostic: they tell you something broke *after* it broke.
This one is preventive. **Run it on every module, worked example, exam question
or rule you add** — it is a few seconds and it catches the whole class of
defects that shipped on the exemplar. Do not wait to be asked.

```bash
# 1. syntax — every file you touched
node --check data/module-N.js

# 2. notation collisions: a subscript that swallows the next variable
#    (mathify's _(\w+) is greedy → "θ_1x_1" renders θ₍₁ₓ₎ plus a stray _1)
grep -oE "[A-Za-zθΘ]_[0-9]+[A-Za-z]" data/*.js | sort -u     # expect: nothing
#    fix by bracing: θ_{1}x_1

# 3. right-to-left runs — one foreign word reorders the arrows around it
node -e 'const fs=require("fs");for(const f of fs.readdirSync("data"))if(f.endsWith(".js")&&/[֐-ࣿ]/.test(fs.readFileSync("data/"+f,"utf8")))console.log("RTL in "+f)'

# 4. every number you shipped, recomputed from the raw data by a second path —
#    the bundled content gate (schema · every fill/mark selector, 0-indexed ·
#    Σ rows · given row widths · no tuple-run statements · no bare "/" in a
#    rule formula · exam marks sum · FINALS). Extend CUSTOM with per-example
#    assertions for every number the source solutions give you.
node .claude/table-checker.mjs            # must exit 0
```

Then, in the browser:

- **Mathify coverage** — any NEW content field you introduced must be inserted
  through `M(...)`. Grep the engine for where your field lands; a field injected
  raw shows `θ_0` and `^2` to the student while everything around it renders.
- **Table contract** — reveal all steps and confirm no cell with content is left
  `pend`: a typo'd `fill` selector (`r5c2` on a 4-row table) silently strands it.
  The structural half of `table-checker.mjs` catches this offline. Selectors
  are **0-indexed** — `c3` is the fourth column.
- **Given tables** — count them in the DOM (`document.querySelectorAll(".given-table").length`)
  against the number you authored; a `given` on a question the engine does not
  pass through `U.given` renders nothing and nobody notices.
- **Video rail** — every card has a title, channel, length and a match badge;
  no `θ_0` / `^2` in card text (not mathified — Unicode only).
- **Rules** — no `/` inside a `.rule-card .rf` that is not a `.frac` (the
  checker forbids it in the data; this confirms the render).
- **Then loop A** on the routes you touched, and **loop B** on a phone width.

The rule behind all of it: **a number or a glyph that reaches the student wrong
is worse than one that is missing.** Verify by a second, independent path —
recompute, don't re-read.

## Syntax gate (after every JS edit)

```bash
node --check js/<file>.js
```
On Windows, prefer Write over Edit for regex-heavy files (Edit has mangled
backslashes in regex literals before — documented on the exemplar).

## Serve & route audit

```bash
node .claude/static-server.js        # http://localhost:8123 (PORT=8124 to change)
```
Open in the browser pane and walk EVERY route:

1. `#/` — hero, plan (if any), stats, module cards, flag list.
2. `#/lecture/N` for each module — every stepper tab; on Worked press ▸ through
   every step AND ▶ Play once (watch the highlight land, the chip pin, the
   table fill column by column, and any redraw morph actually swap the figure);
   flip a flashcard; reveal a written model; answer the quiz to the score bar.
3. `#/rules` — search, test mode, star a rule.
4. `#/revision` — TOC builds, sections collapse, hydrated figures render.
5. `#/finals` (when populated) — each exam opens, questions build lazily,
   Play works, Arabic notes render (if enabled).
6. `#/exam` — every variant button; start one, answer a question, submit
   (the confirm dialog blocks eval-driven clicks — pre-stub
   `window.confirm = () => true` when driving it programmatically), check the
   score report links.
7. Console: **zero errors** at every step. Warnings get read, not ignored.

Absent-content behavior: with empty FINALS/RULES_MASTER/REVISION the nav links
must be hidden, not broken — and no stepper tab may open an empty panel.

### Browser-driving gotchas that will waste your time

- **The static server roots at the site directory.** `http://localhost:8123/#/finals`
  is the URL; `http://localhost:8123/src/index.html#/finals` 404s (and the dist
  is `/dist/index.html#/…`). A "zero given tables" report on a 404 page looks
  exactly like a real zero.
- **SMIL animations stall screenshots.** Run
  `document.querySelectorAll("svg").forEach(s => s.pauseAnimations())` before
  `computer{screenshot}`, or fall back to `read_page` + JS probes.
- **The mock exam has a variant chooser.** It reports 0 questions until you click
  the primary variant button and then "Start the mock exam" — drive both before
  counting questions.
- **A "remove this" paste can be a stale page.** Diff the pasted names against
  the live data file before deleting anything; names that no longer exist mean
  the user is reading a cached render — ask for a hard-refresh (Ctrl+Shift+R)
  and confirm the cut list.

- **The page caches your edits.** After ANY edit to `js/*`, `data/*` or `css/*`,
  force `location.reload()` before verifying — a plain hash navigation keeps the
  old modules in memory and you will "verify" the previous build. (Symptom:
  a module you just added renders "Module not found", or a fix appears not to
  work.)
- **`javascript_tool` shares one JS context between calls.** `const x = …`
  twice throws "Identifier 'x' has already been declared". Wrap every snippet
  in `(() => { … })()` or `(async () => { … })()`.

## Visual audit (figures)

Render every figure builder at least once (a scratch grid page or stepping
through the walkthroughs) and LOOK at each: no floating parts, no overlapping
labels, orientation matches the source material. Screenshot-verify anything
reproduced from a paper. If the screenshot tool stalls on SMIL-heavy pages,
fall back to DOM checks + rasterizing the SVG strings Node-side with
@napi-rs/canvas.

## Accuracy spot-check (Phase 9, minimum bar)

- Re-derive ≥2 numeric results per module against docs/source-of-truth.md.
- Re-verify EVERY exam-bank and finals answer key against the official
  solutions. A wrong key in a mock is worse than no mock.
- Better than a spot-check when the subject is computational: write a
  throwaway Node checker that **recomputes every shipped number from the source
  data** and exits non-zero on mismatch (the exemplar shipped 124 + 487
  assertions this way). Data files are IIFEs over `window`, so a checker can
  load them with `new Function("window", code)(shim)` and walk the real objects.
- Anything not verifiable from sources: label it inferred or cut it.

## Build & dist verification (after every shipping edit)

```bash
node build-single.mjs
```
- Replacer-FUNCTION rule: `.replace(re, () => code)` everywhere — a plain
  string replacement corrupts `$$`/`$&` in the inlined code. Never refactor.
- Open `dist/index.html` (served, so the sweep can inject) and repeat the route
  pass **and the glitch sweep** — the dist is what ships; source-only
  verification has missed dist-only breakage before.
- Grep the dist for corruption sentinels if in doubt: a stray `$&` or a
  truncated `</script>` means the replacer rule was broken somewhere.

## Deployment note (hand to the user at P10)

**Only the built file is ever public.** The material folders (lectures, boards,
sheets, notes, photos) are the professor's copyrighted work — read-only inputs,
never served, and the repo stays PRIVATE.

- **Vercel** (auto-deploys on push): `vercel.json` with
  `buildCommand: "node build-single.mjs"` (prefixed with `cd src &&` when the
  site lives in `src/`) and `outputDirectory: "dist"` — scoped deliberately so
  nothing outside `dist/` is reachable. `cleanUrls: true`.
- **Netlify Drop**: drag `dist/index.html` onto https://app.netlify.com/drop —
  the single file IS the site. Re-upload after every rebuild.
- Keep a **backup copy of the single file in the project root** (the project
  stays self-contained) and remind the user to hard-refresh (Ctrl+Shift+R)
  after every deploy — a cached page is where "please remove X" pastes of
  already-removed content come from.
- Local use needs nothing: double-click `index.html`.
