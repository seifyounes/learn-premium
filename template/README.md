# Site template

The site code every Study site is built from: Astro 7 static output with React 19 islands,
Tailwind v4 on the DESIGN.md tokens, and KaTeX 0.18 (with mhchem) run at build.

## Content

The template reads a Course's content from `CONTENT_DIR` (default `../fixture-course`, the
Fixture Course). The shape is content contract v0 in `src/content/contract.ts`; the Fixture
Course's README lists the files. Agents write JSON/YAML and Markdown only, never JSX or MDX:
the page templates place the components.

Every file is read by `src/content/loaders.ts`. Bad LaTeX anywhere, or content that breaks the
contract, fails the build and names the file (and, for LaTeX, the line).

## Routes and the fixed nav

| Route                  | Page                                                            |
| ---------------------- | --------------------------------------------------------------- |
| `/`                    | Home, the contents sheet                                        |
| `/<NN-slug>/`          | A Module's page (its folder name)                               |
| `/rules/`              | Master Rules                                                    |
| `/lab/`                | The Lab                                                         |
| `/revision/<sitting>/` | A sitting's Revision, built only once the sitting is `complete` |
| `/about/`              | About                                                           |
| `/tool-gallery/`       | The Tool gallery (linked from no page)                          |

Every page opens with the fixed nav (`SiteNav.astro`, from `src/site/nav.ts`): Modules · Master
Rules · Lab · Revision · About. Revision is there only once a sitting is complete (no stub), and
opens the last complete sitting in `course.yaml`; the Exam room joins with #74. Every page ends
with the Credit line (the Professor, the Course and the University from `course.yaml`) and carries
a noindex meta tag.

## Home

The contents sheet (`src/pages/index.astro`): the title block with the Course's counts, then one
ruled line per Module in number order, each with its Worked, Practice and Rules counts, its
Mastery, and a tag for each Exam sitting that covers it. A Module marked `highYield` has its sheet
number ringed in red pen. The Exam sittings follow, each with its readiness meter and, once
complete, a link to its Revision.

The home page's script (`src/progress/home.ts`) fills in Mastery and readiness from the browser's
progress, and writes the red-pen resume note ("You stopped here: W01.1, step 4 of 6") in the
margin of the Module the student stopped in. It points at the last Worked example step or Practice
item they worked on, and following it reopens the Worked example at that step.

**Mastery** (`mastery` in `src/progress/progress.ts`, decided on #45): 60% Practice + 40% Worked
examples. A Practice item counts 1 when right (a prose item its marks out of its points); a Worked
example step counts 1 when read and 1 more when worked try-first (its values held back until the
student had a go), out of 2 per step. A Module with only one of them counts it in full. A sitting's
**readiness** is the average Mastery of its Modules; the best mock score joins it with the Exam
room (#74).

## Course hubs

- **Master Rules** (`/rules/`): each Module's `rules.yaml`, Module by Module, in the order a
  solution uses them, every formula set as display paper math. Reference only: no search, no test
  mode, no script.
- **Lab** (`/lab/`): every interactive tool, by Module: each Agent-built sim (see Agent-built sims),
  live or as its step-through. A Course with none says so.
- **Revision** (`/revision/<sitting>/`): a complete sitting's Modules, each with its Summary beats
  and its rules, assembled from what the Modules ship. It follows Module order until #74 gives
  sittings an exam weight.
- **About** (`/about/`): the Course, the Professor, the University, who built the site and how.

## Module page

A Module's page (`src/pages/[module].astro`) is one scroll: Watch, Summary, Worked examples,
Practice, in that order. A section with nothing in it isn't on the page, and neither is its rail
tab. The section rail (`SectionRail.astro`) is a margin of numbered boxes from 1200px and a row of
printed tabs pinned above the sections below it. Each tab jumps to its section, the one being read
is filled, and a done section is ticked.

- **Watch** (`Watch.astro`): the NotebookLM Explainer video, then the Deep Dive audio, then the
  YouTube cards. A card loads YouTube only when it is played; until then it is a link.
- **Summary**: the infographic at the top (`Infographic.astro`, tap to zoom), then each beat beside
  its one figure (a plot drawn at build, with no island).
- **Worked examples**: the Worked example sheet (below).
- **Practice** (`src/islands/PracticeItem.tsx`), written first. A `numeric` item checks the
  student's number within its tolerance (`src/practice/check.ts`) and marks it in red pen. A `prose`
  item is marked by the student against the model answer and its `earns` points. The model answer
  shows only once the student has had a go.

A Module's media is named in its `media.yaml` and sits in its `media/` folder
(`src/media/integration.ts` publishes only the named files at `/<module>/media/`). A named file
that isn't there fails the build.

Progress is kept per browser (`src/progress/`): what was watched and read, how far each Worked
example got, and each Practice item's result. The rail marks a section done from it:

- **Watch:** a video or audio played to its end, or a card played.
- **Summary:** read to its last beat.
- **Worked examples:** every example stepped to its last step.
- **Practice:** every item checked or self-marked.

Every number, formula, dimension and sim constant carries a Provenance tag: an entry's
`provenance` block lists its values as `stated`, `derived`, `scaled` or `assumed`, plus any `slips`
and `divergences` the Owner ruled on (`src/provenance/`). The page says so where it matters:

- scaled and assumed values are shown with the question;
- derived values, a Slip (both values, the sheet's struck through in red pen) and a Divergence (the
  Professor's value as the exam answer, with its note) are shown with the answer.

## Worked example sheet

A Worked example renders as one solved sheet (`src/islands/WorkedSheet.tsx`, a React island):
title block with the step counter and the try-first toggle, the Given box, the steps margin (a
step strip under 900px), the solving table with the step note below it, and the question figure
pinned beside it (behind Table | Plot tabs under 900px). The page builds the sheet at build time
(`toSheet` in `src/worked/sheet.ts`, prose already rendered to paper math); the island is a thin
view over two pure modules: `stateAt` (what is on the sheet at a step) and `src/worked/stepping.ts`
(moving through it: going back redraws at once, try-first holds a step's values back). Values land
in the example's fill order, red-pen marks draw after them (`src/islands/worked/timing.ts`), and
reduced motion makes every change instant.

## Agent-built sims

A Module's sims sit in its `sims/` folder, one JSON or YAML file each (`sim` in the content
contract). The sim builder writes a small model of the Professor's figure (`model`), the Worked
example's values the sim opens on (`start`) and the range a student tunes each input over (`tune`).
Students tune the inputs, never the model: the contract has no way to name anything else.

A kind's engine is a pure function of model and inputs (`src/sims/<kind>/engine.ts`, registered in
`src/sims/kinds.ts`). The number gate runs it in Node, and the page runs the same code. Its view
draws in the pad's inks, read from the page's tokens. The first kind is gradient descent
(`src/islands/GradientDescentSim.tsx`), which draws on JSXGraph, loaded only once the sim is on
screen. Its table fills in hand order and the red pen rings each new θ. The path moves on the
contours of J, the start drags, and α can diverge. A swipe on a board scrolls the page; only the
start handle takes a drag.

- `recompute: independent`: the independent recompute logs what it worked out from the Materials in
  the Course's `build-records/recompute/<module>/<name>.json`, and the sim ships live.
- `recompute: none`: no recompute can check its model, so the page shows its `stepThrough` instead:
  the figure as the Materials draw it, stepped with the sheet's motion, nothing computed.
- `worked` names the Worked example it sits in (it renders below that sheet), and `sheet` maps that
  example's table cells to the engine's quantities, for the number gate.

Every sim is also in the Lab (`/lab/`). The Tool gallery (`/tool-gallery/`, linked from nowhere)
has one live sim of every kind and one step-through. Its illustrative constants (a slider's range,
say) are tagged `assumed` and labelled above it.

## Pads

A Course's pad is one value in `course.yaml`: a catalogue key (`green`, `bluegrey`, `teal`,
`violet`, `steel`, `graphite`, `indigo`; DESIGN.md's starting catalogue, in `src/pads/catalogue.ts`)
or a colour written `#RRGGBB`, from which a custom pad is built on the catalogue's OKLCH geometry
(its hue, and its chroma capped at the catalogue's strongest print). The layout sets the pad's
slots as `--pad-*` variables on `<html>`, so changing the value rebuilds every page in the new
colours. The inks (graphite, pencil, the red pen #C0341D) are fixed and are never pad slots.

Every build checks the pad against DESIGN.md's contrast requirements (`src/pads/pad.ts`), and holds
the Red Hue Rule on every slot drawn onto the sheet (print, muted and both grids), so a custom pad
near the red gets a grey print and grid rather than a reddish one. A failing requirement doesn't
block: the auto-fix moves the pad slot in it (never an ink) until it passes. The build log and the
`pad` gate's entry in the Gate report list every value it changed.

A tool with its own meaning colours (a simulator's voltage reds, CPK oxygen) sits inside an element
marked `data-framed-tool`; the Red Hue Rule doesn't look inside it. Everything else on the sheet
keeps at least 60° of OKLCH hue from the red pen, or is a grey (chroma under 0.035).

## Gates

`gates/` is the gate runner: one entry (`npm run gates -- <command>`) for every gate point.

- `run --point job|module|deploy [--module NN-slug]` runs the point's gates and writes a Gate report
  to the Course's `build-records/gate-reports/`, bound to the commit it checked. It exits 1 unless
  the report is green.
- `verify --point … [--module …] [--commit SHA]` accepts a report only if it is green for that
  commit (HEAD by default). A report for another commit, or taken on uncommitted changes, is red.
- `controls` runs every gate on its positive fixture (the Course as it is) and on each of its
  negative controls. A negative control that passes is a failure. Most controls must block; one
  whose defect only the Owner can settle (`expect: "checkpoint"`) must raise a Checkpoint item,
  and blocking it is a miss too.

Every finding either blocks or raises a Checkpoint item; there is no warning level. Every gate
reports its coverage, and a gate that crashed, didn't run or covered nothing counts as failed.
A new gate goes in `gates/index.ts` with at least one negative control that plants its defect.

| Gate | Points | Checks |
| --- | --- | --- |
| `content-contract` | job, deploy | every content file against the Zod schemas; every media file a `media.yaml` names is there; every Module a sitting covers exists |
| `katex` | job, deploy | every formula through KaTeX with `throwOnError` |
| `teaching-method` | job, deploy | Worked examples: artefact declared and shipped, fill order, question figure first; Summaries: at most 5 beats of at most 90 words |
| `provenance` | job, deploy | every number an entry shows (Master Rules included), and every constant a sim is built from, carries a Provenance tag |
| `master-rules` | job, deploy | every rule is set with stacked fractions (a bare `/` outside a `\text{…}` unit blocks; in `name` and `use`, inside their math); no emoji in a rule |
| `sim-numbers` | job, deploy | a live sim's numbers three ways at the sheet's printed precision: engine ≠ recompute blocks; both ≠ sheet is a Checkpoint item |
| `tools` | job, deploy | every sim passes the five eligibility checks: embeddable, takes the pad frame, touch-usable, writable from the Materials, headless |
| `rendered-page-scan` | module, deploy | no `.katex-error` or raw TeX on a built page, islands' props included |
| `pad` | module, deploy | the pad meets every contrast requirement once auto-fixed; every page wears it |
| `red-hue-rule` | module, deploy | no colour drawn on the sheet within 60° of the red pen's hue, framed tools aside: markup, islands and stylesheets (in `<head>` or linked) |

The sim gates in detail (`gates/sims.ts`):

- **`sim-numbers`** compares each sheet cell a sim maps three ways: the engine replayed in Node, the
  recompute log, and the cell as printed. They agree when the computed value, rounded to the
  cell's decimals, is within 1 of it in the last digit (`src/sims/precision.ts`). The engine and the
  recompute disagreeing blocks. Both agreeing against the sheet raises a Checkpoint item with both
  values, for the Owner to rule a Slip or a Divergence; a value ruled a Divergence is settled.
  Numbers off the sheet (the minimum, the α limit) must agree to 1e-9. A recompute log worked from
  other inputs than the sim opens on blocks, and so does a live sim with no log.
- **`tools`**: a kind this template doesn't ship blocks (PhET and Falstad are credited links,
  never tools). The view's source names no colour (it reads the pad's tokens) and has no
  mouse-only handler. Every number in the model is tagged stated or scaled, so it comes from the
  Materials. The engine runs in Node to finite numbers at the example's values and at every
  slider's min, mid and max.
- A Module with no sim passes both, having looked in it; a Module that doesn't exist covers
  nothing and fails.

`test/sim-pages.test.ts` drives the built Tool gallery, Lab and Module page in Chromium (Playwright):
JSXGraph loads only once the sim is on screen, every drawn colour is a pad ink, the layout holds at
375 and 1280px at each slider's min, mid and max, and on a touch phone the start drags while a
swipe elsewhere on the board scrolls the page.

The gates run on Node's own TypeScript support, so files they import use `.ts` extensions and
erasable syntax only (`erasableSyntaxOnly` in `tsconfig.json` enforces it).

## Scripts

| Script                 | What it does                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------- |
| `npm run dev`          | Dev server on the Fixture Course                                                   |
| `npm run build`        | Static build into `dist/`                                                          |
| `npm run check`        | `astro check` (TypeScript strictest, `.astro` files included)                      |
| `npm run lint`         | ESLint                                                                             |
| `npm run format:check` | Prettier                                                                           |
| `npm test`             | Vitest: the Fixture Course build, the gate runner, the gates, the sims in Chromium |
| `npm run gates -- …`   | The gate runner (see Gates)                                                        |

Dependencies are pinned to exact versions (`.npmrc` has `save-exact`); commit the lockfile with
any change to them. CI (`.github/workflows/template-ci.yml`) runs all of the above. The browser
tests need Playwright's Chromium (`npx playwright install chromium`; the Machine install has it).
