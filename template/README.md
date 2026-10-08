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
| `/licences.txt`        | The Licences file (linked from no page; see Deploy)             |

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
  live or as its step-through, then each Pyodide tool, then each machine part in its 3D viewer. A
  Course with none says so.
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

## Arabic notes

A Course whose `course.yaml` has `arabicNotes: true` (the intake toggle, off by default) shows
each Arabic note in its content: a Summary beat's `arabic` below the beat's text, and a Worked
example step's `arabic` below that step's note (held back with it under try-first). Turned off,
no note is shown. The note is set right to left (`lang="ar" dir="rtl"`, the system's Arabic face,
ruled in pencil at its inline start) beside the English, which stays left to right; media stays
English either way.

In a right-to-left line a number reorders ("−5" reads "5−", a phone number's groups swap), so
`src/arabic/notes.ts` isolates every number in a note left to right, sign, separators and phone
number groups included, and every formula with it. Numbers are written with the digits 0–9: the
contract refuses Eastern Arabic digits, so the provenance gate reads a note's numbers as it reads
the English (a note's numbers carry Provenance tags too). The layout sweep checks the result in
the browser.

The Worked example's arrow keys follow the document's direction, and the printed arrows (Back,
Prev, Next) mirror right to left; `test/arabic-notes.test.ts` checks both in a mirrored page.

## Agent-built sims

A Module's sims sit in its `sims/` folder, one JSON or YAML file each (`sim` in the content
contract). The sim builder writes a small model of the Professor's figure (`model`), the Worked
example's values the sim opens on (`start`) and the range a student tunes each input over (`tune`).
Students tune the inputs, never the model: the contract has no way to name anything else.

A kind's engine is a pure function of model and inputs (`src/sims/<kind>/engine.ts`, registered in
`src/sims/kinds.ts`). The number gate runs it in Node, and the page runs the same code. Its view
draws in the pad's inks, read from the page's tokens. A plot kind draws on JSXGraph
(`src/islands/sim/board.ts`), loaded only once the sim is on screen, with its labels set in screen
pixels (ticks at 12px, names at 15px) so the 12px floor holds at 320px; a schematic kind is drawn
by the layout core (below). A swipe on a board scrolls the page; only a handle takes a drag. The
kinds:

| Kind               | Discipline    | Engine                                                             | Students tune                     | Independent check                         |
| ------------------ | ------------- | ------------------------------------------------------------------ | --------------------------------- | ----------------------------------------- |
| `gradient-descent` | ML            | batch gradient descent on the half mean squared error              | start (drags), α, steps           | exact fractions                           |
| `tangent`          | maths         | a polynomial's tangent, and secants over runs h, h/10, h/100       | a (P drags), h (Q drags)          | direct evaluation, in exact fractions     |
| `plane-wall`       | heat transfer | transient conduction, Crank–Nicolson on 80 intervals               | time, diffusivity                 | the Fourier series                        |
| `logic`            | logic         | every net's level on every truth-table row                         | the input bits                    | each net walked back to its gate          |
| `stl`              | automation    | the Professor's STL listing on the S7 core, statement by statement | the inputs (switches, raw values) | awlsim, bit for bit after every statement |

- **Gradient descent** (`src/islands/GradientDescentSim.tsx`): its table fills in hand order and
  the red pen rings each new θ. The path moves on the contours of J, and α can diverge.
- **Tangent** (`src/islands/TangentSim.tsx`): the derivative as the tangent's slope. P and Q slide
  along the Professor's curve; the table's secant slopes close on f′(a), which the red pen rings.
- **Plane wall** (`src/islands/PlaneWallSim.tsx`): a wall whose faces are suddenly held at another
  temperature. The Profile tab draws T across the wall at the chosen time; the Map tab draws the
  whole wall over time as a heatmap (`src/islands/sim/heatmap.ts`). Plotly draws the map, and is
  the shared core's tool for heatmaps and 3D surfaces only: the sim imports it only when the Map
  tab is opened, so Plotly loads only on a page with a heatmap, and only once it is wanted. Plotly
  is built from its sources, its core and the heatmap trace, not its prebuilt dist bundle, which
  takes over ten times as long to start on a phone; a few small packages they ask for get stand-ins
  (`src/islands/sim/plotly-shims/stand-ins.ts`). The map is a static picture, so a swipe on it scrolls the page. Its `units` name the Materials'
  length and temperature units; time is in seconds.

A recompute by another method than the engine's (the Fourier series against a Crank–Nicolson
march) agrees with it at the sheet's printed precision, not to the last float, so its log gives
the sheet's quantities and only the exact ones off it (the Fourier number). The plane-wall engine
stays within 0.03 °C of the series on the Fixture Course's plate once its Fourier number passes
0.015; it is coarser in the first instants, before the change at the faces has spread over a few
grid intervals.

The logic sim (`src/sims/logic/engine.ts`, `src/islands/LogicSim.tsx`): the
figure's gates as a netlist (`model`: `parts`, `nets`, and the `inputs` and `outputs` terminals in the
truth table's column order), its input bits as `start`, each input tuned from 0 to 1. Tapping a row
of its truth table, or an input key, sets the inputs; every wire carrying a 1 inks in over its
pencil line, and the red pen rings the row's outputs. Its engine gives every net's level on every
row, named `net[row]` (`S[101]`), so `sheet` maps a truth-table artefact's cells to them.

### The S7 core and the STL sim

The automation Toolkit's shared S7 core (`src/sims/s7/core.ts`) is what the STL interpreter runs on
today and the SCL interpreter and the ladder/FBD sim build on next: byte-addressed big-endian memory
(I, Q, M; a peripheral input reads the input bytes), INT and DINT that wrap two's complement and
report OV, REAL as float32 (every result rounded to the nearest float32), the status word, FC105
SCALE and FC106 UNSCALE from Siemens' formula with the clamp and RET_VAL `W#16#0008`, and the
watch-table display (a REAL as the shortest decimal that reads back as the same float32: `57.3`).

An STL sim (`kind: stl`) holds the listing in STEP 7 source form, line for line as the Professor
wrote it (`model.source`: one `ORGANIZATION_BLOCK OB 1`, absolute addresses, English mnemonics),
the operands a student sets with their types (`model.inputs`), the watch table (`model.watch`), the
example's values (`start`), the inputs students tune (`tune`) and any multi-scan `cases`. The
interpreter (`src/sims/stl/`) runs a statement or a scan at a time with a trace entry per statement:
ACCU 1, ACCU 2, AR 1, the status word and every byte it wrote. OB 1 starts every scan with the
registers cleared (awlsim's choice; the manual is silent). What FC105 or FC106 leaves in the
accumulators, the RLO, CC, OV and BR reads "left by FC105": Siemens doesn't publish it, so a
statement that reads one stops the run, and the gate never compares one. The view
(`src/islands/StlSim.tsx`) opens on the example's values with one scan run; students step, finish a
scan, set inputs (taken from the next scan) or reset, and never edit the listing.

Its independent check is awlsim, run at build: `npm run oracle -- write` (in the machine venv, or the
`.oracle-venv` that `npm run oracle -- setup` makes here) runs the listing on its cases (the
example's values, each tuned input at its slider's min, mid and max, and the written `cases`) and
keeps awlsim's trace in `build-records/oracle/<NN-slug>/<name>.json`. awlsim has no TI-S7 library, so
it calls FC105 and FC106 written in STL from the same formula (`oracle/fc105.awl`, `fc106.awl`).
The `stl` gate compares the engine with that log bit for bit (below). A listing with an instruction
the interpreter lacks names the Gate gap filed for it (`gateGap`) and ships as a step-through of
awlsim's own scans of the example's values. The interpreter runs every instruction the template's
corpus (`test/stl/`) runs against awlsim, each with every kind of operand it takes; where awlsim and
the manual part (a REAL overflow is the largest REAL in awlsim, ±∞ in the manual), the engine
follows awlsim, and `test/s7-core.test.ts` names each such point.

### The layout core

A schematic sim (logic now; circuits, ladder, pneumatics, block diagrams and FSMs to come) is drawn
by the layout core (`src/sims/layout/`), never by hand. The builder writes the model and its Layout
hints (`layout`): each part's cell on the figure's coarse grid (`at`, `[column, row]`, to a tenth of
a step), its `turn` and `flip`, the side its `label` is printed on, and the nets whose joints the
figure dots (`dots`). The contract has no field for a coordinate and no hand-placed override.

`layOut(model, hints)` (`layout.ts`) is pure: it snaps every part to the pad's 20px grid (every pin
of every symbol in `symbols.ts` sits on it, gate inputs included), seats grounds under the pin they
serve, straightens pins under 40px out of line, sets each label on its side and routes. The router
(`route.ts`) is A* on the 20px grid: each net grows from the pin nearest its centre, straight joins
first; a wire meets a pin from the side the pin faces, crosses another net only straight over it,
never runs along one, pays to run beside one, and meets its own net at a T. The page gets the
drawing made at build (`Sim.astro`), the one the Drawing gate checked; `src/islands/sim/Schematic.tsx`
draws it at its own size, so a wide circuit scrolls inside its box rather than shrinking its labels.

- `recompute: independent`: the independent recompute logs what it worked out from the Materials in
  the Course's `build-records/recompute/<module>/<name>.json`, and the sim ships live.
- `recompute: none`: no recompute can check its model, so the page shows its `stepThrough` instead:
  the figure as the Materials draw it, stepped with the sheet's motion, nothing computed.
- `worked` names the Worked example it sits in (it renders below that sheet), and `sheet` maps that
  example's table cells to the engine's quantities, for the number gate.

Every sim is also in the Lab (`/lab/`). The Tool gallery (`/tool-gallery/`, linked from nowhere)
has one live sim of every kind, one step-through and one Pyodide tool (below). Its illustrative
constants (a slider's range, say) are tagged `assumed` and labelled above it.

## Machine parts and the 3D viewer

A machinery Module's parts sit in its `parts/` folder (`part` in the content contract), each an
exact solid: a build123d script (`source`, a `.py` file beside it, which leaves the solid in
`part`) and a JSON file naming it, the Worked example it sits in (`worked`) and every dimension the
drawing gives. A dimension (`dimensions`) is measured in millimetres between two points on the part
in the script's frame (z up), `from` and `to`, each on a surface the dimension meets square: two
faces, or the two sides of a diameter (`kind: diameter`, printed with Ø). It carries its own
Provenance tag (`tag`). JSON only: the build reads it with Python's standard library.

- **Built.** `npm run parts` runs `parts/build.py` with the machine venv's Python (build123d; set
  `LEARN_PREMIUM_PYTHON` for another). Each script's solid is tessellated to within 0.004 mm
  (absolute) and exported to `<name>.glb` beside it (glTF: metres, +y up), and the B-rep is measured
  into the part record, `build-records/parts/<module>/<name>.json`: whether OpenCascade calls the
  solid valid, its volume and bounding box, and for each dimension how far each end is from the
  solid's surface and the surface's normal there. The record names the SHA-256 of the script (its
  line endings as LF) and of the GLB, so either changing after the build makes it stale. Commit all
  three: Template CI has no build123d, so the record is the B-rep's word.
- **Checked.** The part checks (`gates/parts.ts`) read the GLB in Node (`src/parts/mesh.ts`, in the
  drawing's frame) apart from the record: its bounding box and every tagged dimension within
  0.01 mm of the solid's (a dimension is measured where its line meets the mesh, nearest each
  end), and the volume the mesh encloses within 0.5 % of the solid's. The independent recompute
  sums the drawing's own primitives (`build-records/recompute/<module>/parts/<name>.json`: the readings it
  took, by dimension id, and the `volume`), never reading the script, and must land within 0.5 % of
  the B-rep's volume, from the same readings. A scaled or assumed dimension is a Checkpoint item
  linking to the viewer with it highlighted (`/<module>/#dim-<module>-<name>-<id>`, or the Lab's
  page when the part sits in no Worked example), until the Owner confirms it (`confirmed: true`).
- **Shown.** The page publishes each GLB at `/<module>/parts/<name>.glb` (`src/parts/integration.ts`)
  and places the part below its Worked example, in the Lab and (the first one) in the Tool gallery
  (`Part.astro`). A part whose GLB isn't built fails the build.

The viewer (`src/islands/PartViewer.tsx`, the island, over `src/islands/three/stage.ts`) is a
framed tool on the sheet: plain three.js, loaded only once the page has loaded and painted (never
with it); a transparent background, so the grid shows through; matte surfaces with pencil edges, in
the pad's tokens; each dimension a pencil line, labelled in a gutter beside the part (never on it,
14px, `src/viewer/labels.ts`) with a leader to it, and listed below with its tag. The red pen never
draws inside the viewer: a highlighted dimension turns graphite there, and the red pen rings its
value in the list below.

It never traps the page. Until the student taps or clicks the part, a wheel or a swipe over it
scrolls the page (its touch-action is `pan-y pinch-zoom`). Tapped, it takes every touch: one finger
turns it, two pinch-zoom inside the frame, the wheel zooms, and arrow keys and +/− do the same from
the keyboard (`src/viewer/gesture.ts`, `src/viewer/orbit.ts`). A tap outside, Escape, or scrolling it
out of view hands the page back. Reset view restores the 3/4 view. A browser with no WebGL says so
and keeps the list of dimensions.

The stage is the shared core for every 3D viewer: a mechanism (#61) or a chemistry apparatus (#62)
adds its objects to `stage.scene`, moves them, and asks for a `draw()`; it marks the surface a
gesture lands on `data-viewer-object`, which the scroll pass-through gate checks.

## Pyodide tools

Real Python, only where real Python is the point (the Professor's own code, scikit-learn, SciPy).
A Module's Pyodide tools sit in its `python/` folder (`pythonTool` in the content contract): a
JSON or YAML file naming its code (`source`, a `.py` file beside it), the Pyodide `packages` it
imports, the `figure` frame its plot is drawn in, `labels` for the plot's elements, and the
Worked example it sits in (`worked`). The code ends by setting `plot` to the elements it draws,
the sheet's plot elements as dicts (`point` with `at`, `line` with `through`, `guide` with
`x`, each with an `id`); what it prints is shown too.

- **Preview.** The build runs the code in Node (`src/python/preview.ts`), on the same Pyodide and
  package files the page downloads, and the tool opens on that plot and printout. Code that fails,
  leaves no plot, or imports a Pyodide package the tool doesn't name fails the build, naming the
  file. Each preview runs in a worker thread whose Pyodide loaded only the tool's packages, so a
  package another tool loaded can't let it pass, and code still running 30 s after it started (a
  loop that never ends, an await that never settles) is stopped and fails the build. The code
  runs as `__main__`. So do `labels` naming an element the plot doesn't draw, and a `worked`
  number the Module has no Worked example for.
- **Run live.** The printed button says what the tap downloads (`Run live · 16.5 MB`): the real
  bytes of Pyodide's core files and every package file the tool loads (with what they depend on,
  from Pyodide's lock), rounded up to the next 0.1 MB, uncompressed: an upper bound on what the phone
  downloads if Vercel compresses them (the Owner's ruling on #50). Nothing of Pyodide is imported
  until the tap: the island (`src/islands/PythonTool.tsx`) imports `src/python/live.ts` then,
  which runs Python in a module Web Worker (`src/python/live-worker.ts`) that loads the
  self-hosted loader, one shared by the page's tools, their runs one at a time. The student can
  then edit the code and run it again; a Python error shows its traceback in red pen. Code that
  never finishes leaves the page working, and Stop ends the worker (Python starts again on the
  next run).
- **Self-hosted.** `src/python/integration.ts` serves Pyodide at `/pyodide/`: the core from the
  template's pinned `pyodide` package (never committed per Course), and each package file a tool
  loads from the Course's `pyodide/` folder, committed in the Course project (ADR 0003, as amended
  on #50). The build checks each against
  the SHA-256 in Pyodide's lock. `npm run wheels` fetches the files the Course's tools need into
  that folder from Pyodide's CDN, once. A Course with no Pyodide tool ships no Pyodide.
- **Timing run.** In the Tool gallery, a live run shows how long Python took to start, to load
  its packages and to run, and what that run fetched: the Owner reads it on the real-phone pass.

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

- `run --point job|module|deploy|live [--module NN-slug] [--dist DIR] [--url URL]` runs the point's
  gates and writes a Gate report to the Course's `build-records/gate-reports/`, bound to the commit
  it checked. It exits 1 unless the report is green. The browser gates serve `dist/` themselves, or
  open the same build at `--url` (its Vercel preview). `deploy` checks the build before it merges;
  `live` checks the live site at `--url` after Vercel deploys it (see Deploy), or, with no URL,
  the build served the way Vercel serves it under `vercel.json`.
- `verify --point … [--module …] [--commit SHA]` accepts a report only if it is green for that
  commit (HEAD by default). A report for another commit, or taken on uncommitted changes, is red.
- `controls` runs every gate on its positive fixture (the Course as it is) and on each of its
  negative controls. A negative control that passes is a failure. Most controls must block; one
  whose defect only the Owner can settle (`expect: "checkpoint"`) must raise a Checkpoint item,
  and blocking it is a miss too.

Every finding either blocks or raises a Checkpoint item; there is no warning level. Every gate
reports its coverage, and a gate that crashed, didn't run or covered nothing counts as failed.
The one exception is a Course with no Modules yet (nothing under `modules/` but a `.gitkeep`), as
intake creates it: on a whole-Course run, a content gate (one that runs per job) that covered
nothing passes, and the Gate report records `nothingToCheck` for it. Once a Module exists, the rule
applies again. A new gate goes in `gates/index.ts` with at least one negative control that plants its defect.

| Gate                  | Points         | Checks                                                                                                                                                                                                                                                                                                                 |
| --------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `content-contract`    | job, deploy    | every content file against the Zod schemas; every media file a `media.yaml` names is there; every Module a sitting covers exists                                                                                                                                                                                       |
| `katex`               | job, deploy    | every formula through KaTeX with `throwOnError`                                                                                                                                                                                                                                                                        |
| `teaching-method`     | job, deploy    | Worked examples: artefact declared and shipped, fill order, question figure first; Summaries: at most 5 beats of at most 90 words                                                                                                                                                                                      |
| `provenance`          | job, deploy    | every number an entry shows (Master Rules and a Pyodide tool's prose included), and every constant a sim is built from, carries a Provenance tag                                                                                                                                                                       |
| `master-rules`        | job, deploy    | every rule is set with stacked fractions (a bare `/` outside a `\text{…}` unit blocks; in `name`, `use` and the printed provenance notes, inside their math); no emoji                                                                                                                                                 |
| `sim-numbers`         | job, deploy    | a live sim's numbers three ways at the sheet's printed precision: engine ≠ recompute blocks; both ≠ sheet is a Checkpoint item                                                                                                                                                                                         |
| `truth-table`         | job, deploy    | a logic sim's truth table three ways, bit for bit: engine ≠ recompute blocks, a row the recompute leaves out blocks; both ≠ sheet is a Checkpoint item                                                                                                                                                                 |
| `stl`                 | job, deploy    | every STL listing agrees with its awlsim log bit for bit after every statement of every case; every instruction it uses runs in a case; nine broken interpreters, each caught wherever the cases reach its defect; the sheet three ways; an unsupported instruction needs a Gate gap                                   |
| `part-checks`         | job, deploy    | every machine part's GLB against its B-rep record (each tagged dimension and the bounding box within 0.01 mm), its volume against the independent sum of the drawing's primitives (0.5 %); a scaled or assumed dimension is a Checkpoint item linking to the viewer                                                    |
| `drawing`             | job, deploy    | every schematic sim's drawing against its model, its model against the Blind reader's figure reading, the drawing against the figure; eight broken drawings caught on every build                                                                                                                                      |
| `tools`               | job, deploy    | every sim passes the five eligibility checks: embeddable, takes the pad frame, touch-usable, writable from the Materials, headless; a Pyodide tool's view takes the pad frame and is touch-usable                                                                                                                      |
| `pyodide`             | module, deploy | every Pyodide tool opens on its build-time preview, a mark of it inside the figure's frame, beside a Run-live button that prints the real download, every file of it served from `/pyodide/`                                                                                                                           |
| `rendered-page-scan`  | module, deploy | no `.katex-error`, raw TeX, prose set as a fraction or hollow copy (`0/0`, NaN) on a built page, islands' props included; the content's braces render literally                                                                                                                                                        |
| `pad`                 | module, deploy | the pad meets every contrast requirement once auto-fixed; every page wears it                                                                                                                                                                                                                                          |
| `red-hue-rule`        | module, deploy | no colour drawn on the sheet within 60° of the red pen's hue, framed tools aside: markup, islands and stylesheets (in `<head>` or linked)                                                                                                                                                                              |
| `layout-sweep`        | module         | browser: at 320/375/390/430/768/1024/1280/1440, left to right and right to left, every collapsible open, no sideways scroll, nothing over a figure, nothing above the page, no colliding text, no height-locked overflow, no text under 12px, Arabic notes right to left with their numbers and formulas left to right |
| `live-page-scan`      | module         | browser: the live page has no KaTeX error, raw TeX, hollow copy, NaN or floating-point noise, and no uncaught error                                                                                                                                                                                                    |
| `hydration`           | module         | browser: island controls are disabled in the server's HTML, and on once the island hydrates                                                                                                                                                                                                                            |
| `touch`               | module         | browser: with phone touch at 375 and 390px (4× slower CPU on Chromium), every control answers a tap                                                                                                                                                                                                                    |
| `initial-load`        | module         | browser: three.js, Pyodide and Plotly are absent from every page's initial load (what it asks for before its load event)                                                                                                                                                                                               |
| `scroll-pass-through` | module         | browser: a wheel and a swipe over every 3D viewer scroll the page until it is tapped or clicked; once clicked it takes the wheel                                                                                                                                                                                       |
| `trap-page`           | module         | browser: every sweep found every seeded defect on the Trap page                                                                                                                                                                                                                                                        |
| `no-materials`        | deploy         | no file in the build output is a document, deck, sheet or camera original, or matches a Materials hash in the Build ledger                                                                                                                                                                                             |
| `no-build-evidence`   | deploy         | no evidence-shaped path (`gates/evidence.ts`, shared with the Go-public check), nothing under `build-records/`, no copy of a recompute log or Gate report                                                                                                                                                              |
| `noindex`             | deploy         | every built page has a robots noindex meta tag, and `vercel.json` sends `X-Robots-Tag: noindex` on every path                                                                                                                                                                                                          |
| `licences`            | deploy         | every npm package the build ships is on the licence allow-list; anything else (GPL, NC, ND, unknown) is a Checkpoint item                                                                                                                                                                                              |
| `licences-file`       | deploy         | the Licences file carries every hand-written notice, no page links to it, and `public/licences.txt` is the build's                                                                                                                                                                                                     |
| `live-routes`         | live           | every route the build made answers 200 with the build's own page; the hubs and `/licences.txt` are there                                                                                                                                                                                                               |
| `live-headers`        | live           | every response carries `X-Robots-Tag: noindex`; pages, scripts and stylesheets of 1 KiB or more come Brotli-compressed                                                                                                                                                                                                 |
| `live-private-paths`  | live           | the Course's content and build records (at their content and repo paths), the Build ledger's Materials, the evidence-shaped folders, config, `.env` and `.git` answer 404                                                                                                                                              |

### Browser gates

The browser gates (`gates/browser.ts`) are slices of one run of headless Playwright on Chromium and
WebKit (WebKit stands in for iPhone Safari), made once per gate input (`gates/browser/run.ts`). They
run per Module, on the Module's preview; a Module-point run with no `--module` opens every page of
the Course. They don't run per deploy: a production build carries no Trap page. For each browser,
the run opens every page in scope:

- it records what the initial load fetches (everything asked for before the page's load event),
  before anything is scrolled. A 3D viewer on screen asks for three.js only after it;
- it wheels over every 3D viewer (`data-viewer-object`) and reads its touch-action: until it is
  clicked the page must scroll, and once clicked it must take the wheel;
- it scrolls each island into view, waits for it to hydrate, and checks it turned its controls on;
- it sweeps the page at each of the eight widths, asserting the viewport width first. Each sweep
  opens every collapsible and visits every tab of each tab list, then measures the page in it
  (`gates/browser/in-page.js`). It then mirrors the document right to left (`dir="rtl"` on
  `<html>`) and sweeps every width again: the pages are laid out with logical properties, and a
  physical offset that hangs harmlessly off the left edge scrolls the page sideways there. Every
  sweep also holds each Arabic note to right to left, with each number and formula in it left to
  right;
- it taps every control with emulated phone touch at 375 and 390px, typing into fields first, and
  sweeps the state that leaves. Chromium runs with a 4× slower CPU; WebKit has no CPU throttling, so
  its touch run is at full speed. A control blocks when it never takes a tap (15s, naming why) or a
  tap never changes the page (10s), not when it is slow: the gate reports its slowest tap and
  answer.
  The plane wall's map is the slowest tap the Fixture Course has. Plotly's prebuilt dist bundle held
  a 4×-throttled phone for 2–4s while it started (the Owner accepted the wait on #51), and on CI's
  runner the tap after the map's tab missed both waits (#119). Built from its sources, it starts in
  about 0.2s and draws the map in about 0.6s; the tab still answers first, saying the map is loading.
  The touch run refuses `/pyodide/`: a Run-live tap answers at once, and a dozen Pyodide
  starts behind it would starve every other page's taps (`test/python-tool.test.ts` runs it for real).

An island turns its controls on once it hydrates, but some stay off by design (Prev at the first
step, Check before an answer), so an island fails the after-hydration check only when every control
it has is still off.

Each check exists because v1 shipped its defect. A figure is covered when something positioned
over it lies on its ink: an SVG's strokes, fills and text, sampled every pixel, never its blank
ground. An element marked `data-backdrop` is ground: the sheet's grid, and a plot's dashed guides,
which a label may break as dimension text breaks a construction line (the Owner's call on #46). One
marked `data-allow-overlap` is a deliberate overlay (the red pen's rings). The SVGs inside an element
marked `data-figure-layers` are layers of one figure, stacked by the tool that drew them (Plotly's
heatmap). The covers check doesn't set sibling SVG layers against each other. Anything else
positioned over them is still checked, and every text check still reads their labels.

**The Trap page** (`/trap/`, `src/trap/`) is a hidden page of seeded defects in every build except
Vercel's production deploy: a figure labelled under 12px inside a collapsed section, a KaTeX error,
a value chip over a figure, and a wrong number the page computes as it loads. Every sweep of it
must find all four. A run that misses one is void: `trap-page` blocks, and every other browser gate
fails rather than pass on a run that couldn't see. The page gates never read the Trap page.

The browsers come from `npx playwright install chromium webkit` (the installer does it on the
Owner's machine), at the Playwright version `package.json` pins.

The sim gates in detail (`gates/sims.ts`):

- **`sim-numbers`** compares each sheet cell a sim maps three ways: the engine replayed in Node, the
  recompute log, and the cell as printed. They agree when the computed value, rounded to the
  cell's decimals, is within 1 of it in the last digit (`src/sims/precision.ts`). The engine and the
  recompute disagreeing blocks. Both agreeing against the sheet raises a Checkpoint item with both
  values, for the Owner to rule a Slip or a Divergence. A value ruled a Divergence is settled; a
  sheet still printing a value ruled a Slip blocks, since the site ships the corrected value.
  Numbers off the sheet (the minimum, the α limit) must agree to 1e-9. A recompute log worked from
  other inputs than the sim opens on blocks, and so does a live sim with no log.
- **`truth-table`** is `sim-numbers` for logic sims, compared exactly: a bit has no last digit to
  round. The recompute log gives every net on every row, and one it leaves out blocks.
- **`tools`**: a kind this template doesn't ship blocks (PhET and Falstad are credited links,
  never tools). The view's source names no colour (it reads the pad's tokens) and has no
  mouse-only handler. Every number in the model is tagged stated or scaled, so it comes from the
  Materials. The engine runs in Node to finite numbers at the example's values and at every
  slider's min, mid and max.
- A Module with no sim passes each, having looked in it; a Module that doesn't exist covers
  nothing and fails.

The Drawing gate (`gates/drawing.ts`, checks in `src/sims/layout/check.ts`) lays each schematic sim
out exactly as the page does and blocks on any failed check:

- **drawing ↔ model**: the parts; the connectivity, read from geometry alone (a wire meets a pin
  only where one of its points lands on it, and another wire only where an end of one lands on the
  other, so a T connects without a dot and a crossing never connects; grounds and same-named rails
  join without a wire); the labels; the conventions (every pin and corner on the 20px grid, no
  diagonal, no wire along another or over a pin, no wire ending in the open, no dot but at a
  joint); legibility (no label on a wire, a body or another label; no wire through a body); and
  tidiness (no jog under 20px, at most 4 bends a wire, no parallel wires under 20px apart).
- **model ↔ figure**: the model's nets equal the Blind reader's (a resistor's ends and a gate's two
  inputs may swap). The reading sits in the Course's `build-records/figure/<module>/<name>.json`,
  written without seeing any builder file: each labelled part's kind, place (fractions of the
  figure), turn and label side; the unlabelled symbols counted; every net, and whether the figure
  dots its joints.
- **drawing ↔ figure**: every labelled pair kept in the figure's left/right and above/below order
  (a pair the figure parts by under 4% may line up), each part's turn (polarity-aware), each
  label's side, the unlabelled symbols, and the junction dots, which copy the figure.
- **the negative control**, on every build: each drawing is broken eight ways (`mutants.ts`: a short,
  an open, a part turned round, a label dropped, an extra part, the drawing mirrored, a staircase
  wire, a dot removed), and each must fail its check, or the gate blocks.

`test/sim-pages.test.ts` drives the built Tool gallery, Lab and Module pages in Chromium
(Playwright): JSXGraph loads only once a sim is on screen, every drawn colour is a pad ink, the
layout holds at 375 and 1280px at each slider's min, mid and max, and on a touch phone a handle
drags while a swipe elsewhere on the board scrolls the page. The logic sim inks the nets a tapped
row drives high, and its circuit scrolls inside its box on a phone. Every page is opened with every
sim hydrated: Plotly is fetched only on the plane wall's pages (its Module, the Lab and the Tool
gallery), and only once its map is opened, and on a 4×-throttled phone it starts in a few times
JSXGraph's start, not the dist bundle's 26×. Every label on a sim's plots is drawn at the same size
at 1280 and 320px, and never under 12px. `test/maths-heat-sims.test.ts` holds the tangent and the
plane wall to the sim gates. `test/layout-core.test.ts` holds the layout core to its public
interface: hints in, drawing out.

The gates run on Node's own TypeScript support, so files they import use `.ts` extensions and
erasable syntax only (`erasableSyntaxOnly` in `tsconfig.json` enforces it).

## Deploy

A Course deploys to its own Vercel project through the Git integration, as plain static files
(`vercel.json`: Vercel's Astro preset, `dist/`, trailing slashes, and `X-Robots-Tag: noindex` on
every path). Vercel compresses text with Brotli on its own. The Fixture Course's project and its
setup are in `../docs/deploy.md`.

- **Before merge**, the `deploy` gates run on a production build (`VERCEL_ENV=production`, so no
  Trap page): no Materials file, nothing from Build evidence, noindex everywhere, the licence
  allow-list and the Licences file. The `live` gates then run on that build served the way Vercel
  serves it (`gates/live/vercel-like.ts`), which checks `vercel.json` before anything deploys.
- **After the deploy**, the `live` gates run on the live URL. `deploy/` holds what runs around
  them (`npm run deploy -- <command>`):
  - `await-live` waits until production serves Vercel's deployment of a commit, or reports it
    `superseded` when a newer deployment already took production over;
  - `verdict` settles the run, only while production still serves that deployment. Green marks the
    commit with the `learn-premium/live-gates` GitHub status. Red (or `--drill`) rolls Vercel back
    to the newest earlier production deployment whose commit is green (`deploy/rollback.ts`),
    waits until production serves it, and writes the Owner's issue.
- `performance` reports each page's initial JavaScript against the ~300 KB reference, its LCP on
  a phone-sized Chromium and, with `--lighthouse`, Lighthouse's mobile score
  (`deploy/performance.ts`). It never blocks.

**The Licences file** (`/licences.txt`, linked from no page) is written by every build
(`src/licences/integration.ts`). It lists the npm packages the bundle actually ships, read off the
bundle itself: the client bundle, every stylesheet and asset, and Astro's inline island loader. A
package that only builds the site (Astro's compiler, sharp, Tailwind) is never listed. After them
come the hand-written notices (`src/licences/hand-written.ts`, reviewed at every release):

- mhchem's Apache-2.0;
- KaTeX's OFL fonts;
- Pyodide (MPL-2.0, with its source line);
- RDKit and the FreeType inside it;
- the CoolProp WASM;
- elkjs (EPL-2.0, with its source line).

`npm run deploy -- licences` copies the build's file to `public/licences.txt`. That committed copy
is what the Go-public check looks for, and `licences-file` blocks a stale one. The licence gate's
allow-list (`src/licences/spdx.ts`) is MIT, BSD-2/3, ISC, Apache-2.0, 0BSD, CC0-1.0, Zlib, BSL-1.0,
PSF-2.0, OFL-1.1, MPL-2.0 and EPL-2.0. A choice (`MIT OR LGPL-3.0-or-later`) passes when any side
does. Its negative control is a planted GPL-3.0 package (`gates/planted/gpl-package/`).

## Scripts

| Script                 | What it does                                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| `npm run dev`          | Dev server on the Fixture Course                                                                            |
| `npm run build`        | Static build into `dist/`                                                                                   |
| `npm run check`        | `astro check` (TypeScript strictest, `.astro` files included)                                               |
| `npm run lint`         | ESLint                                                                                                      |
| `npm run format:check` | Prettier                                                                                                    |
| `npm test`             | Vitest: the Fixture Course build, the gate runner, the gates, the sims in Chromium                          |
| `npm run gates -- …`   | The gate runner (see Gates)                                                                                 |
| `npm run wheels`       | Fetches the Pyodide packages the Course's tools load into its `pyodide/` folder                             |
| `npm run parts`        | Builds the Course's machine parts with build123d: each GLB and its part record                              |
| `npm run oracle -- …`  | The STL oracle: `write` and `check` awlsim's logs (`--corpus` adds the template's corpus), `setup` its venv |
| `npm run deploy -- …`  | The deploy tooling: `licences`, `await-live`, `verdict`, `performance` (see Deploy)                         |

Dependencies are pinned to exact versions (`.npmrc` has `save-exact`); commit the lockfile with
any change to them. CI (`.github/workflows/template-ci.yml`) runs all of the above. The browser
tests need Playwright's Chromium (`npx playwright install chromium`; the Machine install has it).
