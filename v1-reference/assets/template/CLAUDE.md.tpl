# CLAUDE.md — {{COURSE}} Crash Course (Exam-Prep Study Site)

> Project guide. Read this first, every session. Companion: **MEMORY.md**
> (locked decisions, build-status ledger, module map). Built by the
> `crash-course` skill — re-invoke the skill to resume an unfinished build.

## 1. What this project is

Turn the raw course material for **{{COURSE}}** into a self-contained, interactive
study website that teaches from zero and drills hard enough to score full marks on
the exam ({{EXAM_DATE}}). Two goals, in priority order:

1. **Content first.** Every lecture becomes a complete study unit (the pieces below).
   Content quality > everything else.
2. **Website second.** The bundled template already carries the engines — content
   plugs into data files. Functionality > visual polish.

## 2. Hard constraints / decisions (locked)

| Decision | Value |
|---|---|
| Content language | {{LANGUAGE}} |
| Website stack | Static: plain HTML + CSS + vanilla JS. No build step, no framework, no network calls from the page (video cards are plain link-outs). Opens by double-clicking `index.html`. |
| Storage | Browser `localStorage` (namespace `{{NS}}`) — no backend, no accounts. |
| Audience | Complete beginner — assume zero background. |
| Professor fidelity | {{FIDELITY}} — professor-STYLE voice, never first-person as them; if named, the site credits them respectfully and states it is a **student-built study aid, not reviewed or endorsed by them** (`SITE.credit`). |
| Exam | {{EXAM_FORMAT}} |
| Practice format | {{PRACTICE}} (written-only unless the exam has MCQ) |
| Deployment | `node build-single.mjs` → `dist/index.html`. Vercel with `outputDirectory` scoped to `dist/` (or Netlify Drop) so the professor's copyrighted material folders are **never served**; repo stays **PRIVATE**. Rebuild after every edit; keep a backup copy of the single file in the project root. |

If any of these change, update this table **and** MEMORY.md.

## 3. Source materials (read-only — never move, rename or delete)

{{SOURCES}}

Every fact on the site traces to these via `docs/source-of-truth.md`. Boards and
notes control *scope, method and weighting*; **independent mathematics controls
correctness** — a source slip ships corrected, with both readings documented.
Solution pages that are blank → the key is DERIVED and labelled as derived.

## 4. Content standards — the pieces per module

1. **Summary** — visual-first: ≤ 5 `<h3>` beats × ≤ 90 words, each wrapped around
   one figure/demo, with a "say it aloud" viva line. Define every term at first
   use. No walls of text.
2. **Key rules & formulas** — every rule the worked examples use, in the professor's
   written form; every division as a stacked `{numerator}/{denominator}`.
3. **Worked examples** — **THE TABLE METHOD is non-negotiable**: every worked example
   ships a `table:` that fills as the steps run, exactly the way the professor
   draws it. The question's DATA ships as a `given:` table when the source posed
   it as a table (never a run of tuples; coordinates stay coordinates).
4. **Flashcards** — definitions, formulas, rules.
5. **Written questions** — professor-style prompts with model answers + "what earns
   the mark"; label inferred questions as inferred. (MCQ quiz only when the exam
   has MCQ — see the practice-format decision above.)
6. **Common mistakes & exam tips** — the traps that lose marks.
7. **Video cards** — one audited YouTube explainer per topic that solves it the
   professor's way, match ≥ 9/10, verified before linking; otherwise `pending`.

Cross-cutting: **accuracy is non-negotiable** — verify every formula and number
against `docs/source-of-truth.md` before publishing. Never invent exam content the
sources don't support. Exam-weight claims stay honest (a classmate's prediction
is labelled as a prediction, never presented as an announcement).

## 5. Engine / data conventions

- Engines (`js/`) stay generic — content lives in `data/*.js` globals only.
  Extend the data contract; never fork an engine. Modules self-register into
  `window.MODULES`; the only hard-coded list is the `<script>` block in
  `index.html` — add a tag in the same commit that creates its file.
- `data/site.js` holds every subject string/flag (branding, credit, nav, exam
  variants, `rules` page strings, `parts`).
- Subject figures go in `js/figures.js` (SVG-string builders; highlightable parts
  carry `id="p-…"` + `class="part"`; a walkthrough step may swap the whole figure
  via `circuit:{fn,opts}` — the redraw morph).
- Walkthrough contract: `table:{cols,rows,sum,pre,cap,note}`; steps `fill:[…]` /
  `mark:[…]` with **0-indexed** selectors (`all`, `sum`, `cN`, `rN`, `rNcM`,
  `sum:cN`); `given:{cap,cols,rows,note}` (or an array) draws the question's data.
- `mathify` auto-formats `X_ab`→subscripts, `^2`→superscripts, `{a}/{b}`→stacked
  fractions, and passes `<svg>/<pre>/<code>` through untouched. Video-card text is
  NOT mathified — write Unicode subscripts there.
- Build: `node build-single.mjs` (replacer FUNCTIONS only — `$$`/`$&` corruption).
- Preview: `node .claude/static-server.js` → `http://localhost:8123/#/…` (the server
  roots at the site directory — `/src/index.html` style paths 404).
- Content gate: `node .claude/table-checker.mjs` — schema, every fill/mark selector,
  Σ recomputation, `given` row widths, no tuple-run statements, no bare `/` in a
  rule formula. Run before shipping ANY walkthrough, question or rule.
- **See a source slide** before drawing or trusting any figure (text extraction is
  blind to figures and drops α β θ ω μ °):
  `powershell -File .claude/pdf2png.ps1 -Pdf "<file>.pdf" -Out out/ -Pages 5,9,16 -Scale 2`
  then Read the PNGs. Decks with no text layer are rasterised whole.

## 6. Working agreements

- One module fully done (all pieces + working interactivity) beats six half-done.
- Verify in the live browser (source AND rebuilt dist) with zero console errors.
  Pause SMIL (`svg.pauseAnimations()`) before screenshots; the mock exam needs the
  variant button clicked before it reports questions.
- **Never author a figure you have not looked at.** Render the source slide and
  compare trace by trace.
- **Glitch sweep + screenshot loop before anything ships — never wait to be asked.**
  Serve, inject `.claude/glitch-scan.js`, `CCScan.sweep()` at 390 / ~510 / 1280 px;
  gate is zero findings on source AND dist.
- Force `location.reload()` after any js/data/css edit before verifying.
- **Confirm before deleting.** A paste of "remove this" that names content which
  no longer exists is a stale render — ask for a hard-refresh, list what is
  already gone versus still present, and cut only what is confirmed. A request
  scoped to one page ("only the master rules") never widens to the whole site.
- Update MEMORY.md at every phase boundary and after every module.
- Ask the owner only when a real ambiguity blocks progress; otherwise pick the
  sensible default and note it in MEMORY.md.
