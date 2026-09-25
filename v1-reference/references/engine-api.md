# Engine API — every data contract the template understands

Copied from the live engines (not remembered). Read at Phases 5–8 and any time
you author a data file.

## Contents
1. [Load order & globals](#1-load-order--globals)
2. [SITE config schema](#2-site-config-schema)
3. [Module shape](#3-module-shape)
4. [Walkthrough items (worked examples + finals)](#4-walkthrough-items)
5. [Quiz / flashcards / written shapes](#5-quiz--flashcards--written-shapes)
6. [Exam bank shape](#6-exam-bank-shape)
7. [Rules master / revision / finals globals](#7-rules-master--revision--finals-globals)
8. [Figures / graphs / calc / anim registries + hydration](#8-figures--graphs--calc--anim)
9. [Progress, flags, timer, storage](#9-progress-flags-timer-storage)
10. [The two hard gotchas](#10-the-two-hard-gotchas)
11. [The professor's table + given tables](#11-the-professors-table--given-tables)
12. [Video cards](#12-video-cards)
13. [Rule groups, module tags, exam parts](#13-rule-groups-module-tags-exam-parts)

## 1. Load order & globals

index.html loads: `data/site.js` FIRST → engines (util, progress, flags, timer,
figures, graphs, quiz, walkthrough, flashcards, written, interactive, calc,
anim, exam) → content data files → `js/app.js` LAST. Add one `<script>` tag per
new data file, before app.js. Data files attach globals:
`MODULES` (object by id), `EXAM_BANK`, plus optional `MOCK_FINAL`, `FINAL_SIM`,
`MCQ_FINAL`… (any key wired in `SITE.exam.variants`), `RULES_MASTER`,
`REVISION`, `FINALS`. Empty/absent optional globals auto-hide their pages and
nav links.

## 2. SITE config schema

`data/site.js` → `window.SITE`. See the file itself — every key is commented.
The keys app.js reads: `ns, brand{logo,first,rest}, course, titleSuffix,
eyebrow, byline, credit, tagline, methodNote, methodNoteLbl, footer, arabic,
weightNote, planTitle, plan[], parts[], pageBanners{}, labels{revision,finals,
rules,exam}, exam{statLabel,variants[],blurb,tip,generalLabel},
finals{badge,title,sub}, rules{eyebrow,title,sub,lead}, videos{label,note}`.
`credit` is the professor credit + "student-built, not reviewed or endorsed"
disclaimer (null → hidden). `rules` retitles the Master Rules page (empty
strings → engine defaults). `parts` groups modules by exam part (see § 13).
`plan` items: `{day, theme, tasks:[{id, t, href}]}` — task ids must be unique
site-wide (they key localStorage ticks).

## 3. Module shape

```js
window.MODULES["3"] = {
  id: "3",                 // string; sorted numerically for order/next-lecture
  title: "…", short: "…",  // short is used by the exam weak-topic report
  subtitle: "…",
  weight: "high"|"med"|"low",
  estMinutes: 60,          // study-timer target
  counts: "8 quiz · 12 cards · 4 worked",   // card meta line (free text)
  sectionKeys: ["summary","tips","rules","formulas","worked","flashcards","written","quiz"],
  summaryHtml: `…`,        // prose; <h3> headings become collapsible TOC sections;
                           // may embed data-figure/-graph/-calc/-anim divs
  tips: ["…"],             // common mistakes & exam tips (strings, mathify'd)
  rules: [{ name, formula, note }],          // module rule cards (active recall)
  formulas: [{ big, meaning }],              // formula cards under the rules
  worked: [ …walkthrough items… ],           // §4 — EVERY item carries table:
  quiz: [ …quiz questions… ],                // §5 — omit entirely on a written-only build
  flashcards: [{ front, back }],
  written: [{ id, prompt, given?, model, mark, inferred?, highYield? }],
  videos: [ …video cards… ],                 // §12
  ruleGroups: [ …solve-sheet groups… ],      // §13 (optional; else rules[] is one group)
  part: "final",                             // §13 (optional exam part key)
  tag: "re-taught before the final",         // §13 (optional card chip)
};
```
`sectionKeys.length` is the mastery denominator — list exactly the sections the
module really has. A module without `quiz` gets no Quiz step and a 70/30
sections/cards mastery blend — never advertise a quiz that isn't there.

## 4. Walkthrough items

Used by module `worked` arrays AND `FINALS` questions.

```js
{
  id: "w1", title: "…", highYield: true,
  statement: "the problem, as the professor words it",
  given: { cap, cols, rows, note },            // the question's DATA as the source
                                               // drew it — or an array of specs (§11)
  circuit: { fn: "builderName", opts: {…} },   // or a raw "<svg…>" string
  table: { cols, rows, sum, pre, cap, note },  // the professor's SOLVING table (§11)
  steps: [
    { k: "step headline",
      html: "why + the algebra; last <b>…</b> becomes the chip text",
      hl: ["p-partId", …],          // parts to light up (ids in the figure)
      chip: "value chip text",      // optional; else auto from last <b>…</b> (≤ 30 chars, else no chip)
      fill: ["c2"], mark: ["sum:c3"], // reveal / circle table cells (§11, 0-indexed)
      table: {…},                   // OPTIONAL — a fresh table from this step on
      circuit: { fn: "…", opts: {…} }  // OPTIONAL — swaps the figure from this
                                       // step on (the REDRAW morph). Later steps
                                       // keep the swapped figure until another
                                       // step swaps again.
    }, …
  ],
  answer: "the boxed final answer",
  graphs: [{ fn: "linePlot", opts: {…} }],   // FINALS only: plots under the card
  anims: ["name"],                            // FINALS only
  ar: "Arabic gloss",                         // FINALS only (needs SITE.arabic)
  placeholder: true, statement: "…",          // FINALS only: page-missing card
}
```
Controls rendered per item: ◂ ▶(play) ▸(step) 1× Reveal-all Reset. Chips land
in a flow strip UNDER the figure (never over it); a chip longer than 30 chars is
dropped rather than truncated — author `chip:` explicitly for long results.

## 5. Quiz / flashcards / written shapes

```js
// quiz (module + exam MCQ share this option shape)
{ id:"q1", q:"…", highYield?:true,
  options:[ { t:"option text", correct:true, why:"why right" },
            { t:"…", why:"why wrong" }, … ],   // exactly ONE correct:true
  explain:"one-line summary shown after answering" }

// flashcards
{ front:"…", back:"…" }

// written
{ id:"wr1", prompt:"…", model:"model answer", mark:"what earns the mark",
  inferred?:true, highYield?:true }
```
All strings pass through `mathify` (`X_ab`→subscript, `^2`→superscript,
`{a}/{b}`→**explicit** stacked fraction with a 2px bar (one nesting level; the
Master Rules use it for every division), the unit-aware `a/b`→stacked fraction,
`||`→‖, `->`→→). Write math plainly and let it format. Brace a subscript that
is followed by a letter (`θ_{1}x_1`) or the greedy `_(\w+)` swallows it.
**Video-card strings are the exception** — built with textContent, so write
Unicode there (θ₀, x₁, ²).

## 6. Exam bank shape

```js
window.EXAM_BANK = {           // or MOCK_FINAL / FINAL_SIM / … via SITE.exam.variants
  title: "…", blurb: "…",      // intro card heading + paragraph
  durationMin: 120,
  sections: [
    { title:"Question 1 — Theory (MCQ)", type:"mcq",
      questions:[ { id, module:"3", q, options:[…], explain, marks? } ] },
    { title:"Question 2 — …", type:"written",
      questions:[ { id, module:"5", marks:16, highYield?,
        prompt:"…", given:{cap,cols,rows,note}, circuit:{fn,opts}|"<svg…>", graphs:[{fn,opts}],
        model:"full model solution (may embed figure SVG via the builders)",
        mark:"marking scheme note" } ] },
  ]
};
```
`module:` on every question — the score report links weak modules by it.
MCQ options are shuffled at render; never rely on option order. `Exam.init(root,
bank, key)` — the key names the result slot (`Progress.examResult(key)`), so
every variant keeps its own last attempt; the home tile reports the `primary`
variant. The intro card lists the sections the bank actually ships, and a
written-only paper's report says "mark it yourself" instead of `0/0`.

## 7. Rules master / revision / finals globals

```js
window.RULES_MASTER = [ { title, icon, intro, rules:[{name, formula, note}],
                          figures?:[{fn,opts}], table?:{head,rows,note} }, … ];
// formula: every division as {numerator}/{denominator} — a bare "/" fails the checker
window.REVISION = { title, subtitle, html };   // html: <h3>-sectioned prose,
                                               // same hydration as summaries
window.FINALS = [ { id:"f1", title:"Final — Jan 2020", meta:"…", note:"…",
                    questions:[ …walkthrough items (§4)… ] }, … ];
```

## 8. Figures / graphs / calc / anim

- **Figures** (`js/figures.js`): `Figures.name(opts)` → **SVG string** with a
  viewBox. Highlightable sub-parts: `id="p-…"` + `class="part"` (use the
  exported `F._` primitives: `svg, ln, dot, txt, val, part, boxNode, arrow`).
  `window.Figures === window.Circuits` (legacy alias) — either name works.
- **Graphs** (`js/graphs.js`): `Graphs.name(opts)` → **DOM node**. Generic:
  `linePlot` (series/marks/levels/caption), `scatter` (groups/line). Toolkit
  exported as `G._ = {s, plot, axes, path, slider, COL}` for subject builders.
- **Calc** (`js/calc.js`): `Calc.name()` → DOM node. Build with
  `Calc._.widget(title, note, fields, compute)`.
- **Anim** (`js/anim.js`): `Anim.name()` → DOM node. SMIL-only (no JS timers).
  Helpers in `Anim._`.
- **Hydration** in summaries/revision html:
  `<div data-figure="name" data-opts='{"json":"opts"}'></div>` (or
  `data-circuit`), `data-graph`, `data-calc`, `data-anim`.

## 9. Progress, flags, timer, storage

- `U.store` namespaces localStorage with `SITE.ns` — set a unique `ns` per
  project or two sites on the same origin share progress.
- Mastery: 40% sections seen + 45% best quiz + 15% cards known.
- `Flags.button(key, meta)` is already wired in every engine; flagged items
  surface on the home page.
- StudyTimer mounts per lecture with `estMinutes` as the goal ring.

## 10. The two hard gotchas

1. **build-single.mjs uses replacer FUNCTIONS** (`.replace(re, () => code)`).
   A plain string replacement interprets `$$`/`$&`/`$1` inside the inlined
   JS/CSS and silently corrupts it. Never refactor this away. Rebuild dist
   after every shipping edit; verify DIST, not just source.
2. **`mathify` protected blocks.** `<svg>…</svg>`, `<pre>…</pre>` and
   `<code>…</code>` pass through untouched (sentinel in util.js). Reason:
   `<sub>/<sup>/<b>…` are HTML5 *breakout* tags — injected inside SVG foreign
   content they make the parser exit SVG and dump the rest as flat text; inside
   code they corrupt the code. If a model answer embeds a figure, embed the
   whole `<svg>` (via a builder) and let the sentinel protect it. Never regress
   this protection; extend `FR_NUMU`'s unit list if a subject's fractions
   mis-split.

## 11. The professor's table + given tables

```js
table: {
  cols: ["X", "y", "h", "h−y"],        // header cells (mathified)
  rows: [["2","3","6","3"], …],        // body cells (strings; mathified)
  sum:  ["Σ", "", "", "12"],           // optional Σ / total row (checker recomputes numeric columns)
  pre:  ["c0", "c1"],                  // cells already on the board before step 1
  cap:  "…", note: "…"
}
// steps: fill:[…] reveals cells cumulatively; mark:[…] circles; table:{…} swaps in a fresh one.
// Selectors are 0-INDEXED: "all" · "sum" · "c3" (body column 4) · "r1" (body row 2)
//   · "r1c3" (one cell) · "sum:c3" (one Σ cell) · "head:c3".
// If no step declares fill, the table shows complete.
given: { cap: "Given", cols: ["Day","Outlook","Play"], rows: [["1","Sunny","No"], …], note: "…" }
// or an array of specs rendered side by side. STATIC: the question's data, drawn as the
// source drew it. Accepted on worked examples, written questions, exam questions, FINALS.
```
Rules: every worked example ships a `table` (checker: "TABLE METHOD is
non-negotiable"); a statement or prompt must never list a dataset as a tuple
run (checker: `checkNoTupleRun`); every `given` row is exactly `cols.length`
wide (checker: `checkGiven`). The table pins under the topbar while stepping
(`.dtable-host` sticky, height published as `--wt-tbl-h`) so a revealed step
never lands underneath it.

## 12. Video cards

```js
videos: [
  { topic: "KNN", url: "https://www.youtube.com/watch?v=…", title: "exact oEmbed title",
    channel: "oEmbed author_name", length: "12:41", match: 10,
    why: "Works the professor's LITERAL board example — the same nine rows and the same (170, 57) query, solved distance → rank → vote.",
    timestamps: ["3:05 distances", "7:40 the vote"] },
  { topic: "Naive Bayes", status: "pending" }   // no ≥ 9/10 match yet — honest card
]
```
Rendered by `VideoCard.build` above the summary as link-outs (`target=_blank`,
never an iframe). Text goes through `textContent`, not `M()` — Unicode
subscripts only. Only `https://` URLs get a button. Header strings come from
`SITE.videos`. Hunt + verification protocol: `references/videos.md`.

## 13. Rule groups, module tags, exam parts

- **Per-module rule groups**: `ruleGroups: [{title, icon, intro, rules, figures?, table?}]`
  replaces the flat `rules[]` when a topic needs a solve sheet (variants as
  columns, differing quantities as rows). Same shape as a `RULES_MASTER` group;
  the table blurs in Test mode like a formula.
- **Card tag**: `tag: "re-taught before the final"` renders a chip on the home
  card (also used for "PDF-only", "derived keys").
- **Exam parts**: `SITE.parts = [{key, title, ic, open, archived, note, empty}]`
  groups the home grid (a sat midterm archived, the final live); a module joins
  via `part: "<key>"`. A module whose key is undeclared is never hidden — it
  lands in the first group. `SITE.pageBanners[route]` prints a scope banner.
