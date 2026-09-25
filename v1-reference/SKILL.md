---
name: crash-course
description: >-
  Turns a course's raw materials (lecture PDFs, slides, board photos, sheets,
  solutions, past exams, handwritten notes) into a complete interactive exam-prep
  STUDY WEBSITE — the proven crash-course pipeline (Electronics, ML, Power
  Electronics): verified source-of-truth, visual summaries, worked examples that
  fill the professor's TABLE, written drills, audited YouTube video cards, master
  rules with stacked fractions, past-paper vault, timed mocks, offline vanilla-JS
  single-file build. Use whenever Seif types /crash-course, asks for a "study
  website / site", "exam prep site", "crash course for X", "turn my lectures /
  PDFs / notes into a site", "help me ace the X final", or names ANY subject with
  course materials to study. Also to RESUME or EXTEND a crash-course project
  ("continue the ML site", "find videos for each lecture", "cut the master
  rules"). Trigger even if he never says "website".
---

# Crash Course — subject → interactive exam-prep study site

One invocation drives the whole build: interview → scaffold → extract sources →
map modules → content → videos → exams → verify → single-file build. The
engines are **bundled and battle-tested** (`assets/template/` in this skill) —
the work is content, and content quality beats everything else.

Three principles carried from the builds that earned them (Electronics, Machine
Learning midterm + final, Power Electronics — each used the night before a real
exam):

- **Accuracy is non-negotiable.** A wrong formula costs real marks. Every number
  is verified against the official solutions before it ships. When unsure, flag
  it — never guess. Boards and notes control *scope, method and weighting*;
  **independent mathematics controls correctness** — a source slip ships
  corrected, with both readings documented.
- **Teach the professor's way.** The site reproduces how THIS professor solves,
  notates and asks — mined from their sheets, boards, solutions and past papers.
  Two signature moves: complex figures get REDRAWN into simpler equivalents step
  by step (the morph), and **problems are solved by drawing a TABLE and filling
  it** — every worked example ships that table and fills it as the steps run.
- **The student's eyes decide.** A question stated as a run of tuples, a
  division written `a/b`, a video that solves it a different way — all of these
  were rejected by the real user at 2am. The contracts below exist so they
  cannot recur.

## Phase 0 — Detect mode (always first)

Work out the target project directory: from the user's message if named, else
`<workspace>\<subject> crash course\` (kebab or spaced, matching the workspace's
naming). Then:

- **`<target>\MEMORY.md` exists → RESUME.** Read the project's CLAUDE.md and
  MEMORY.md, find `## Build status` (the P1–P10 ledger this skill writes),
  announce what's already done in one line, and continue at the first unchecked
  item. Do NOT re-interview unless answers are missing from MEMORY.md. Inside
  P6, resume at the first module row not marked done.
- **Extension request on a finished build** ("add the final's lectures", "find
  videos", "cut theory from the rules") → append a new ledger block (P11, P12…)
  to MEMORY.md with its own locked decisions, then run only the phases the
  request touches. A finished site is extended, never rebuilt.
- **No MEMORY.md → NEW BUILD.** Continue with Phase 1.

This ledger-in-the-artifact is what makes one-shot survive context breaks: a new
session re-invoking the skill loses nothing.

## Phase 1 — Intake interview (the only planned stop)

Read `references/interview.md` and ask the batched question set (one message,
AskUserQuestion where available). Harvest answers already present in the user's
message first; apply the stated defaults for anything unanswered. Classify the
subject type per `references/subject-types.md` (math-heavy / code-heavy /
memorization-heavy / diagram-heavy / mixed) and confirm it in the interview.

Three answers shape everything downstream, so never leave them to a default
silently: the **exam's nature** (problems only? written only? MCQ?) — it decides
the practice format and how deep the Master Rules go; whether the **professor is
named** — a named professor gets a respectful credit AND a "student-built study
aid, not reviewed or endorsed" disclaimer; and the **deployment** — a public URL
must never serve the professor's copyrighted material folders.

After Phase 1, **do not stop until Phase 10**. Ask mid-run only on real blockers
(missing files, contradictory sources, a licensing wall); otherwise pick the
sensible default and note it in MEMORY.md.

## Phase 2 — Scaffold (persist the answers immediately)

1. Create the project directory; copy EVERYTHING under this skill's
   `assets/template/` into it (js/, css/, data/, index.html, build-single.mjs,
   .claude/ — the static server, pdf2png, glitch-scan, figure-overlap AND
   table-checker).
2. Rename `CLAUDE.md.tpl` → `CLAUDE.md` and `MEMORY.md.tpl` → `MEMORY.md`,
   replacing every `{{PLACEHOLDER}}` with interview answers. MEMORY.md's
   `## Build status` starts with P1–P2 ticked.
3. Fill `data/site.js`: `ns` (short subject prefix, e.g. `"ml_v1_"`), brand
   (default "{Subject} Crash Course"), course, tagline, `credit` (professor +
   disclaimer, or null), `arabic` flag, professor/methodNote if fidelity is on,
   labels, exam variants (empty for now). **Leave `byline` exactly as it
   ships** — `"by Seif Younes"`, rendered small and muted under the h1. It is
   the owner's credit on everything this skill builds. Change it only if the
   site is being handed over as someone else's own work.
4. Theme: edit ONLY the accent variables at the top of `css/styles.css`
   (`--accent`, `--accent-2`, `--accent-d`, `--accent-rgb`, and optionally the
   two body radial-gradient rgba tints) to the subject's palette.
5. **Boot check**: `node --check` any file you touched, serve the project
   (`node .claude/static-server.js` → `http://localhost:8123/#/` — the server
   roots at the site directory, so `/src/index.html`-style paths 404), open it,
   confirm the sample module renders with **zero console errors**: its worked
   example's table fills column by column, the `given` table shows in the
   statement, the pending video card shows above the summary, and the Master
   Rules sample shows a stacked fraction. Then run the glitch sweep once for a
   clean baseline (`references/verification.md` § A). A theme tweak that breaks
   the layout is far cheaper to catch now than at Phase 9.

Interview answers are now on disk — a break after this point resumes losslessly.

## Phase 3 — Inventory & extraction

Per `references/extraction.md`: catalog every source into MEMORY.md's inventory
table (with a *text layer?* column), extract archives to `_sources/`, and author
`docs/source-of-truth.md` — global conventions, per-problem verified answer
keys, a **figure manifest**, a **page-coverage ledger**, and (if past papers
exist) the raw material for weighting. Tick P3.

**Render the pages and LOOK at them — this is not optional and not only for
scanned sources.** Text extraction returns prose and nothing else: every
waveform, circuit, table and equation-image is silently missing, and Greek
letters and unit prefixes (α β θ ω μ °) are dropped without warning. Half of a
typical lecture deck is screenshots with no text layer at all — rasterise those
decks whole. Use the render ladder in `extraction.md`; on Windows the bundled
`.claude/pdf2png.ps1` rasterises any PDF with no install at all. Record what
you SEE in the figure manifest, record formulas in the professor's **written
form**, and record every table the source draws (a question whose data came as
a table ships as a table — Phase 6). Phase 5 authors its builders from that
manifest.

Three extraction rules earned on the ML build: **blank solution pages mean the
key is DERIVED** — derive it, verify it independently, label it derived on the
site and flag it for the owner; **a misfiled page** (a classmate's notebook in
the professor's folder) is documented and left in place, never moved; and a
topic that exists **only in PDFs** (no board, no notes) gets a second
independent read of every number before it ships.

## Phase 4 — Module map & exam analysis

Decide the teaching order (not necessarily file order), map each module to its
sources, and — if past papers exist — analyze them: per-module share of marks,
question signatures, the professor's favorite patterns and phrasings. Write the
module-map and weighting tables into MEMORY.md; set each module's `weight`
(high/med/low) from evidence, not vibes. A classmate's "this is worth 10 marks"
is a **prediction** — record it labelled as one and never let the site present
it as an announcement. Tick P4.

## Phase 5 — Subject figure toolkit

Build `js/figures.js` builders for the subject per the recipe in
`references/subject-types.md` (replace the sample builders; keep the `F._`
primitives and the contract comment). Every figure the summaries, walkthroughs
and exams will need — with `id="p-…"` parts wherever a step will highlight, and
simplified-equivalent variants wherever the redraw method applies. Add subject
graphs to `js/graphs.js` (the `G._` toolkit is exported) and demos/calculators/
animations per the subject recipe. Verify every builder renders (a scratch page
or the browser console) before moving on.

**Author each builder from the P3 figure manifest, then run figure fidelity**
(`references/verification.md` § C): put your output beside the rendered source
slide and compare trace by trace — every trace, its zero regions, its jumps, its
labels, and for a matrix its ROW/COLUMN orientation (a confusion matrix drawn
columns-Predicted when the professor draws rows-Predicted is wrong, however
clean). Assert what is machine-checkable in the accuracy checker. Tick P5.

## Phase 6 — Content (the long phase)

Data contracts: `references/engine-api.md`. Method and quality bar:
`references/method.md`.

- Build **Module 1 fully end-to-end first** — every content piece, live-verified
  in the browser — then replicate the pattern across the remaining modules.
- Replace the sample `data/module-1.js` with the real Module 1; add
  `data/module-N.js` + `<script>` tags in index.html **in the same commit** for
  the rest (the builder fails on a tag without a file).
- **THE TABLE METHOD is non-negotiable.** Every worked example ships a
  `table:` and its steps `fill` it in the order the professor writes it —
  contract in `engine-api.md` § 4. If a professor solved something in prose,
  find the table he would draw (his numbers as rows, his computed quantities
  as columns) — there always is one.
- **The question's data is a `given:` table when the source posed it as one.**
  Never restate a dataset as a run of tuples ("1: T,T,+ · 2: …") — the checker
  fails it. Coordinates that came as coordinates stay coordinates.
- **Summaries are visual-first**: ≤ 5 `<h3>` beats × ≤ 90 words wrapped around
  one figure/demo each, with a "say it aloud" viva line per beat.
- **Practice is written unless the exam has MCQ.** The engines derive the
  stepper from the data — a module without `quiz` simply has no Quiz step.
- After EACH module: run the **authoring checklist** (`references/verification.md`
  § D — `node .claude/table-checker.mjs`, collisions, RTL runs, mathify
  coverage, fill selectors), tick its row in MEMORY.md's module map, **force a
  `location.reload()`**, check the console, and run `CCScan.sweep()` on that
  lecture's routes. New content is where new bugs come from — catch them one
  module at a time, not 6 modules later.
- The same checklist applies to a SINGLE example added later. Adding one worked
  example to a finished site is exactly when the discipline gets skipped.
- Arabic notes (if enabled): `.ar-note` blocks inside summaries and an `ar:`
  gloss on exam/final questions — Egyptian dialect, technical terms stay in
  English, numbers stay LTR.

Tick P6 when every row is done.

## Phase 6b — Video cards (one audited explainer per topic)

Per `references/videos.md`. For every lecture (or every distinct topic inside
it), dispatch **one retrieve-mode agent** that searches YouTube for the video
that solves the topic **the professor's way** — same table, same order, same
notation — from **any subject or channel**; the match is to the method, not the
course name. The agent scores every candidate honestly on the /10 rubric and
returns oEmbed-verified picks. **Only ≥ 9/10 ships**; below that the topic
stays `{topic, status:"pending"}` — an honest pending card beats an 8 dressed
as a 9. Before linking, re-verify every winner yourself (oEmbed, duration,
thumbnail read visually, cited timestamps), write the `why` for the student
with every deviation stated, and record dead / do-not-use IDs in MEMORY.md.
Cards are link-outs built from text — write Unicode subscripts (θ₀, x₁).
Tick P6b with the hunt ledger filled.

## Phase 7 — Rules master, revision, study plan

- `data/rules-master.js`: the rules the worked examples actually use, grouped
  by topic, each carrying the professor's own numbers. **Every division is a
  stacked fraction** — `{numerator}/{denominator}` — never `a/b` (the checker
  forbids a bare `/` in a rule formula). For a topic with 2–3 parallel variants
  (converters, bridges, controller modes) ship a **solve sheet** group:
  variants as columns, differing quantities as rows, shared rules once
  underneath, circuits above (`groups[].table` / `.figures`). When the exam is
  announced as **problems only**, the sheet holds computational rules ONLY —
  definitions, comparisons and "what X is" rows go; the rest of the site keeps
  its theory. Title the page for it via `SITE.rules`.
- `data/revision.js`: the whole course condensed into one professor-voice read,
  ordered by exam weight.
- `SITE.plan` in `data/site.js`: day-by-day checklists sized to the real time
  left before the exam (1 day → one 24-hour plan; a week → staged days).

Tick P7.

## Phase 7.5 — Question DNA (always; never wait to be asked)

Before writing a single exam question, read every sheet and past paper for
**structure rather than answers** and author `docs/question-dna.md`: question
types with their observed frequency, the multi-part Arc's exact part ordering,
a verbatim phrase bank, his number conventions, and which quantities he always
asks for together. Then build the banks to that distribution.

Right physics in the wrong shape is still a bad mock. Watch the
**reverse/inverse** family especially — real papers run backwards far more often
(≈30% in the observed set) than a naive forward-plug-in mock does. Full method:
`references/method.md` § Question DNA. Tick P7.5 in MEMORY.md.

## Phase 8 — Exam suite

- `data/exam-bank.js`: the general mock, weighted by the P4 analysis.
- Past papers exist → `data/finals.js` vault: reproduce each paper faithfully
  (statements, `given` tables, figures, marks) as step-reveal walkthroughs with
  tables and redraw morphs. A circulating pre-exam problem set (a classmate's
  revision sheet) goes in the same vault, relabelled via `SITE.finals`
  (badge/title) and `SITE.labels.finals`; problems the sheet copied from the
  lectures are cross-referenced, new ones are solved and verified.
- `data/mock-final.js` (`MOCK_FINAL`) cloning the professor's structure with
  new numbers; format announced → `data/final-sim.js` matching it exactly.
- Wire every bank into `SITE.exam.variants` (label + `primary` on the closest-
  to-real one) and add the `<script>` tags. Results are stored **per variant
  key** — a second mock never clobbers the first. A written-only paper reports
  "sat — mark it yourself", never a hollow `0/0`. Tick P8.

## Phase 9 — Verify & build

Full pass per `references/verification.md`. All gates, no exceptions — the
user should never have to ask for any of them:

1. **Content checker** — `node .claude/table-checker.mjs` exits 0: schema,
   every fill/mark selector resolves (0-indexed), Σ rows recompute, `given`
   rows are full width, no statement is a tuple run, no rule formula has a
   bare `/`, exam marks sum to the declared total.
2. **Route audit** — every route in the live browser, walkthrough Play + exam
   start/submit exercised (click the variant button first — the chooser reports
   0 questions until you do), **zero console errors**.
3. **Glitch sweep** (§ A) — `CCScan.sweep()` at **320 / 375 / 390 / 430 / 700 /
   768 / 1280 px**, on the source tree AND on `dist/index.html`. Gate:
   `findings: []` at every width **and `covered.length` equal to routes +
   modules × tabs**. Fix at the root, re-sweep, repeat until clean.
3b. **Figure collisions** — `node .claude/figure-overlap.mjs`.
4. **Screenshot loop** (§ B) — real screenshots of every page type, read for
   meaning. Pause SMIL first (`document.querySelectorAll('svg').forEach(s =>
   s.pauseAnimations())`) or the capture times out.
5. **Figure fidelity** (§ C) — every builder you wrote or touched, side by side
   with its rendered source slide, trace by trace.
6. **Accuracy** — re-derive ≥2 numbers per module + every exam answer key; for
   computational subjects the checker recomputes *every* shipped number from
   the raw data and asserts the **shipped text**, not a twin of the computation.

Then `node build-single.mjs`, keep a **backup copy of the single file in the
project root**, and repeat 1–3 on the dist. **P9 is not tickable while any
finding stands.** Record the result in MEMORY.md. Tick P9.

## Phase 10 — Handoff

Final MEMORY.md update (status: complete). Tell the user: the project path, how
to open it (double-click `index.html` or the preview command), and the deploy
step. **Deploy only the built file**: Vercel with `outputDirectory` scoped to
`dist/` (`buildCommand: node build-single.mjs`), or Netlify Drop of
`dist/index.html` — never a root deploy that would serve the professor's
copyrighted material folders — and the repo stays **PRIVATE**. Remind them to
hard-refresh (Ctrl+Shift+R) after every rebuild; a "remove this" paste that
names content already gone is a cached page.

**Fold the engines back.** Diff the project's `js/`, `css/styles.css`,
`.claude/` and `build-single.mjs` against this skill's `assets/template/` and
copy every GENERIC improvement back into the template in the same session
(engine contracts, CSS for them, checker rules, glitch classes — never subject
builders, data files or the accent theme). Three builds once drifted three
ways because nobody did this, and the next build would have started without
the table method, given tables, video cards or exam parts. Tick P10.

## Reference files (read when the phase needs them)

| File | Read at |
|---|---|
| `references/interview.md` | Phase 1 |
| `references/subject-types.md` | Phase 1 (classify) + Phase 5 (build recipe) |
| `references/extraction.md` | Phase 3 |
| `references/method.md` | Phases 4–8 (content standards + table method + rules + question DNA + exam-suite method) |
| `references/engine-api.md` | Phases 5–8 (all data contracts + gotchas) |
| `references/videos.md` | Phase 6b (the hunt, the bar, the verification) |
| `references/verification.md` | Phase 2 boot check, after every module, Phase 9 (all gates) |

Shipped tools: `.claude/glitch-scan.js` (inject, `CCScan.sweep()`),
`.claude/table-checker.mjs` (content gate), `.claude/figure-overlap.mjs`,
`.claude/pdf2png.ps1`, `.claude/static-server.js`. Never hand-roll a scanner or
a checker; extend these (and fold any newly-earned defect class back in).

## Non-negotiables (learned the hard way — one build each)

- `build-single.mjs` replacements use **replacer functions** — string
  replacements corrupt `$$`/`$&` sequences in inlined JS. Never "simplify" this.
- `mathify` must never touch raw SVG/`<pre>`/`<code>` outside its protected-block
  sentinel (HTML5 breakout tags turn the rest of the page into flat text).
  The bundled util.js already protects them — never regress it.
- Rebuild `dist/index.html` after EVERY edit that should ship; verify the dist,
  not just the source tree.
- Engines stay generic; content lives only in `data/*.js`. If a module needs
  bespoke behavior, extend the data contract — don't fork an engine.
- Never invent exam content the sources don't support; label inferred questions
  as inferred and derived keys as derived.
- **Every worked example ships the professor's TABLE.** The doctor never solves
  in prose; a walkthrough without a `table:` fails the checker. The table is
  the thing the student copies onto the paper.
- **A question's data is drawn the way the source drew it.** A table in the
  source is a `given:` table on the site; a run of tuples is "not understandable
  at all" (the user's words) and fails the checker.
- **Every division in a rule is a stacked fraction** — `{a}/{b}` — big, with a
  horizontal bar, "the way you write it on paper". A bare `/` fails the checker.
- **A problems-only exam cuts theory from the Master Rules and nowhere else.**
  The user's scope ("only the master rules") is the scope; never widen a cut to
  the summaries or the revision page.
- **Confirm before deleting; check for a stale page first.** A "remove this"
  paste naming rules that no longer exist is a cached render — say so, ask for
  a hard-refresh, list what is already gone versus still present, and cut only
  what the user confirms. Cutting on an ambiguous paste would have emptied most
  of the sheet.
- **Video cards: real, verified, ≥ 9/10, or pending.** Never fabricate a URL,
  title or channel; never embed (link-outs only); never ship a card you did not
  re-verify (oEmbed + duration + thumbnail). The match is to the professor's
  METHOD and ORDER, from any subject — a video rejected as "not how he teaches
  it" is re-hunted from the board, not defended.
- **Never author a figure you have not looked at.** Text extraction is blind to
  every waveform, circuit and table, so render the pages (on Windows
  `.claude/pdf2png.ps1` needs no install) and compare your builder to the source
  trace by trace. **Verify the render actually produced pixels** — a renderer
  that reports success on a 0-byte file reads as "this slide has no figure".
- **When a check passes, ask what it was allowed to look at.** A gate that runs
  over hidden content is not a gate (the sweep skipped every figure inside a
  collapsed section until `expandAll()` learned about `.sum-sect`). Coverage
  failures are invisible by construction.
- **A fix for a timing symptom can silently shrink what a check can see.**
  Re-prove a gate with a deliberate regression after ANY change to it.
- **Record formulas in the professor's written form**, not an algebraic
  equivalent. A rearrangement the marker has never seen reads as a different
  formula. Course conventions (a `1/2m` in the cost, rows-Predicted in the
  confusion matrix, `j` = digit count in decimal scaling) are recorded once in
  the source-of-truth and obeyed everywhere.
- **Mock exams must copy the professor's question SHAPE, not just his syllabus.**
  Mine `docs/question-dna.md` first; naive mocks under-weight reverse/inverse
  questions, which run ~30% of a real paper.
- **MCQ options (when MCQ exists) must be length-balanced** — the correct answer
  must never be reliably the longest. Measure it in the checker.
- **Never report a verification loop you did not actually run.** If screenshots
  are blocked, the site is NOT visually verified — say so in the handoff.
- **Anything absolutely positioned over a figure will eventually cover it.**
  Chips live in a flow strip under the figure; the `hl` highlight carries the
  spatial pointer.
- **Engines must never hardcode copy that assumes a content shape** (section
  types, step lists, score tiles). Derive it from the data, or a written-only
  build advertises MCQs it doesn't have and reports `0/0`.
- **Exam-weight and endorsement claims stay honest.** A classmate's prediction
  is labelled a prediction; a named professor is credited with a "student-built,
  not reviewed or endorsed" disclaimer; the site speaks in the professor's
  STYLE, never in the first person as them.
- **Deploy the dist only, repo private.** The material folders are the
  professor's copyrighted work — they are read-only inputs (never moved,
  renamed or deleted) and are never served.
- **Every mistake gets folded back in, once.** When something ships wrong, fix
  the instance AND add the class to the checker, the glitch catalogue or the
  § D checklist. This file is the memory of the skill — a bug that recurs is a
  documentation failure, not bad luck.
