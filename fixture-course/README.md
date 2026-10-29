# Fixture Course

A small synthetic Course that the Site template builds on every change. It is written from
textbook physics, with no Professor's material, so it can live in this repo. Every value in it is
worked out here, not copied from any Course's Materials.

Layout (content contract v0):

- `course.yaml`: the course config (name, pad, Credit line, `owner` for the About page) and the
  Exam `sittings`, in exam order: each has an `id` (its route), a `name`, an optional `date`
  (`YYYY-MM-DD`), the `modules` it covers by folder name, and `complete`, which only the Owner sets.
  A complete sitting gets its Revision page. `arabicNotes: true` (the Arabic-notes toggle, off when
  absent) shows the Arabic notes; the Fixture Course has it on.
- `style-sheet.yaml`: the Course style sheet, written from Module 1 before any other Module: the
  Professor's voice, table forms, pinned definitions and idealised models, and its machine-readable
  part, `notation` (each symbol as written, what it means, the variants `not` to write) and `units`.
  The notation lint holds every content file to that part.
- `style-sheet.yaml` also pins, under `pinned`, the numbers of the definitions an engine and its
  recompute both work to: the settling band (`settlingTime.band`, here 2 %) and the rise time's
  limits (`riseTime`, here 10 % to 90 %), which the control sim reads.
- `modules/<NN>-<slug>/module.yaml`: one Module; the folder name is its route. `highYield: true`
  rings it in red pen on the contents sheet.
- `modules/<NN>-<slug>/rules.yaml` (optional): the Module's rules for Master Rules and Revision,
  in the order a solution uses them. Each has a `name`, a `formula` (every fraction stacked:
  `\frac{…}{…}`, never a bare `/`) and an optional `use` line; the file has one `provenance`
  block for the numbers they show.
- `modules/<NN>-<slug>/media.yaml` (optional): the Module's media. `video`, `audio` and
  `infographic` name files in the Module's `media/` folder, and `youtube` lists cards (9/10 match
  or better). Every slot is optional; an empty one renders nothing. The Fixture Course's media are
  synthetic, made by `tools/make-media.py`.
- `modules/<NN>-<slug>/summary/<n>.md`: one Summary beat each, plain Markdown of at most 90 words,
  with an optional `figure` (a plot) in its frontmatter. A Module has at most five beats. An
  optional `arabic` is the beat's Arabic note (Module 1's first beat has one).
- `modules/<NN>-<slug>/worked/<n>.json`: one Worked example each (JSON or YAML). A step's
  optional `arabic` is its Arabic note (steps 1 and 5 of `01-thermal-resistance/worked/1.json`).
- `modules/<NN>-<slug>/sims/<name>.json`: one Agent-built sim each (JSON or YAML): its `kind`, the
  `model` students never change, the Worked example's values it opens on (`start`), the ranges
  students tune (`tune`), and `recompute`. A live sim (`independent`) names the Worked example it
  sits in (`worked`) and maps that sheet's cells to the engine's quantities (`sheet`). A sim no
  recompute can check (`none`) gives a `stepThrough` instead: a plotted `figure` and `steps`
  that `add` and `ring` its elements.
- `modules/<NN>-<slug>/python/<name>.yaml` (JSON or YAML): one Pyodide tool each. `source` names
  its code, a `.py` file beside it that ends by setting `plot` to the elements it draws; `packages`
  lists the Pyodide packages it imports, `figure` the frame (caption and axes) its plot is drawn
  in, `labels` its elements' labels by id, and `worked` the Worked example it sits in.
- `pyodide/`: the Pyodide package files the tools load (here numpy's wheel), fetched with
  `npm run wheels` in the template and committed, so the site serves them itself.
- `build-records/recompute/<NN>-<slug>/<name>.json`: a live sim's recompute log, the inputs it
  took from the Materials and every number it worked out. Here each is written by a script in
  `tools/`, apart from the template's engines: `recompute-gradient-descent.py` and
  `recompute-tangent.py` in exact fractions, `recompute-full-adder.py` walking each net back to its
  gate, and `recompute-plane-wall.py` from the Fourier series.
- `build-records/recompute/<NN>-<slug>/worked-<n>.json`: a Worked example's recompute log, every
  number its sheet works out by cell (`cells`), for the cells no live sim maps; the worked-numbers
  gate compares the sheet with it. W01.1's is written by `tools/recompute-composite-wall.py`, W06.1's by `tools/recompute-tank-volume.py`, W07.1's by `tools/recompute-hub-volume.py`, W09.1's by `tools/recompute-blender.py`.
- `tools/recompute-control.py` recomputes Module 8's control sim with python-control (the machine
  venv's, run with `uv`) as the oracle, reads the settling band and rise limits from the style
  sheet's `pinned`, and records them in its log's `definitions`.
- A schematic sim (`kind: logic`) also gives its Layout hints (`layout`): each part's cell on the
  figure's coarse grid, its turn and label side, and the nets whose joints the figure dots; never a
  coordinate. `build-records/figure/<NN>-<slug>/<name>.json` is the Blind reader's account of its
  figure (parts by printed label, their place as fractions of the figure, turn and label side, and
  every net, dotted or not), which the Drawing gate checks the model and the drawing against.
- An STL sim (`kind: stl`, Module 06) holds its listing in STEP 7 source form (`model.source`), the
  operands a student sets (`model.inputs`) and the watch table (`model.watch`), each with its type,
  and multi-scan `cases`. `build-records/oracle/<NN>-<slug>/<name>.json` is awlsim's trace of it on
  every case, written by `npm run oracle -- write` in the template; the `stl` gate checks the
  interpreter against it bit for bit. The tank listing is the STL prototype's own (#37), no
  Professor's text.
- An SCL sim (`kind: scl`, Module 09) holds its listing (`model.source`), the FUNCTION_BLOCK a scan
  calls (`model.block`), the watch table by variable path (`model.watch`), multi-scan `cases`, its
  build steps (`walkthrough`, with a syntax `fragment`) and a Divergence line (`divergences`). The
  `scl` gate runs it on the blind interpreter at every build, so no oracle log is kept. The blending
  station is written for the Fixture Course, no Professor's text, and its Divergence (REAL_TO_INT
  of 12.5) is a fixture ruling, not the Owner's.
- A ladder or FBD sim (`kind: ladder`, Module 10) holds its networks as a netlist of the PLC pack's
  symbols (each part with its `network`, `operand` and `params`), the scan `cycle`, the example's
  input bits (`start`) and timeline (`scenario`), and more timelines as `cases`. Its log in
  `build-records/oracle/<NN>-<slug>/<name>.json` is awlsim's run of the networks compiled to STL,
  scan by scan; the `ladder` gate checks the engine against it bit for bit.
- A pneumatic sim (`kind: pneumatic`, Module 12) holds its circuit as a netlist of the pneumatic pack
  (cylinders with their stroke-end `notes` and `rest`, 5/2 valves with their rest side, roller and
  push-button valves, air sources), the stated `sequence`, the buttons the example `press`es and the
  `signals` its timing diagram draws. Its log in `build-records/recompute/` carries the recompute's
  `trace` of the cycle.
- A state-machine sim (`kind: fsm`, Module 14) holds a Moore state diagram as `states` (each with the
  `label` the figure prints, a `kind` of `state` or the accepting `state-accepting`, and the outputs it
  sets in `out`) and `edges` labelled with input patterns, with the `initial` state, `inputs`,
  `outputs`, the state `encoding` and the printed `equations`, and the `stimulus` the Worked example
  clocks. Its Layout hints give each state's cell and self-loop side (`loop`) and an edge's `bow` where
  the figure bends it. `build-records/figure/<NN>-<slug>/<name>.json` is the Blind reader's account of
  the diagram (each state's kind, place, output and loop side, every edge with its printed label and
  bow, the start arrow), which the `state-diagram` gate checks the model and the drawing against.
- A GRAFCET sim (`kind: grafcet`, Module 14) holds its steps (`step`, and the double-square
  `step-initial`; ids `X0`…) and the receptivity on each link as the figure prints it (`m·a`, `b`), each
  step's actions in `out`, the `inputs` and the `stimulus`. Its log in `build-records/recompute/` carries
  the recompute's `table` of every reachable situation under every input combination, which the
  `state-table` gate checks the engine's against.
- A mechanism (`kind: mechanism`, Module 11) holds a `model` of one of two types: a `four-bar` (its
  four links in mm, the `assembly`, an optional `couplerPoint`) or a `gear-pair` (module, teeth,
  pressure angle, face width); students turn the driver's angle (`start.theta`, `tune.theta`), never
  the links. Its log in `build-records/recompute/<NN>-<slug>/<name>.json` is the independent
  recompute's: the sheet's `values` at the example's angle and a `trace` of one driver turn at 1°
  (each moving link's angle, every pin off the ground), which the `kinematics` gate holds the
  viewer's motion to at 360 steps; the `gear-interference` gate checks a pair's teeth at 0.5°.
- A Nernst sim (`kind: nernst`, Module 13) holds a galvanic cell as `model.first` and `model.second`:
  each half-cell a `metal`, its `ion` as mhchem writes it (`Cu^2+`), its `charge` z and its
  standard reduction potential `e0`. The cell is written first | second, the first electrode
  oxidised as written. Students tune `c1`, `c2` (mol/L) and `T` (K); `plot.isotherms` lists the
  temperatures of the E against log Q plot's lines, and past four it says `many: toggle`. Its
  log in `build-records/recompute/` carries a `sweep` of the whole slider grid (729 states) with
  each state's E and anode, which the `nernst` gate checks the engine's against.
- `modules/<NN>-<slug>/molecules/<name>.json` (JSON only): one molecule each, its `name` as the
  Materials print it, its `smiles` and printed `formula`. `<name>.svg` (its 2D structure, in
  graphite) and `<name>.sdf` (its 3D conformer), `build-records/molecules/<NN>-<slug>/<name>.json`
  (RDKit's record) are written by `npm run molecules` in the template, with the machine venv's
  RDKit, and committed; `build-records/pubchem/<NN>-<slug>/<name>.json` is PubChem's answer for
  the name, from `npm run pubchem` (online, once). Never edit any of them by hand.
- `further` in `module.yaml`: credited links to other sites' pages (a title, an https `url`, the
  `credit` its makers ask for and a `licence`), shown at the end of the Module as "Go further".
- `modules/<NN>-<slug>/parts/<name>.json` (JSON only) and `<name>.py`: one machine part each, its
  build123d script and the dimensions its drawing gives (each between two points on the part, with
  its Provenance tag; `confirmed` once the Owner has ruled on a scaled or assumed one). `<name>.glb`
  and `build-records/parts/<NN>-<slug>/<name>.json` (its part record) are written by
  `npm run parts` in the template, with the machine venv's build123d, and committed.
  `build-records/recompute/<NN>-<slug>/parts/<name>.json` is its independent volume, summed from
  the drawing's primitives (by a script in `tools/`).
- `sittings/<id>/` (the sitting's Exam room, built only for a complete sitting with a past paper):
  `papers/<name>.yaml` is one past paper, in the Professor's order with its marks (`key: professor`
  with each numeric answer's printed `key`, or `key: solved` for one the build solved for the Owner to
  confirm); `mocks/<name>.yaml` is a mock (`pattern: dna`, written to the papers' question DNA, or
  `pattern: announced`, exactly the announced format); `format.yaml` is the format the Professor
  announced (`minutes` and `slots`, each a question `type` and its `marks`). A question has its
  `module` (a Module the sitting covers), its `type`, `reverse` (it gives the result and asks for an
  input), `marks`, its `question` text and an `answer` (`numeric`, or `prose` with one `earns` point
  per mark). The midterm's 2025 paper is keyed by the (synthetic) Professor; its mocks are one
  pattern-matched mock and the written announced-format one. Their recompute logs, by question
  number, are `build-records/recompute/sittings/<id>/<name>.json`, written by
  `tools/recompute-midterm.py` in exact fractions.
- `modules/<NN>-<slug>/practice/<n>.yaml`: one Practice item each (JSON or YAML). A `numeric`
  item has an `answer` (`value`, `unit`, `tolerance`) the site checks; a `prose` item lists what
  `earns` the mark, one point per mark, for the student to mark themselves against.

Every Worked example, Practice item and Summary beat tags each number it shows in a `provenance`
block: `stated` (in the Materials), `derived` (worked out, no official key), `scaled` (measured
off a drawing) or `assumed` (supplied here). A value can be written bare (`0.25`) or in context
(`$L = 0.25\ \text{m}$`), and every number in it counts as tagged. `slips` (`value`, `sheet`,
`note`, and in a Worked example the `cell` it corrects) and `divergences` (`value`, `note`) record the Owner's rulings. The provenance gate
blocks a number no list tags. In this synthetic Course, "the sheet" and "the Professor" are
invented too: the Slip on the Worked example and the Divergence on Practice item 1 are there to
exercise the page.

A Worked example is solved the Professor's way, step by step:

- `artefact`: the artefact the Professor solves on, declared by its `kind` (`table` is the one
  the template ships). A table's `given` columns are printed with the question; every other
  non-blank cell is worked out by a step.
- `fillOrder`: how the Professor writes values in within a step, `columns` (column by column,
  top to bottom) or `rows`.
- `figure` (optional): the question figure, a `plot` with axes and elements (`point`, `line`,
  `guide`). `question` lists the elements the question itself shows.
- `steps`: each has a short `title` and a `note`; `fill` names the cells it writes (column letter
  and row number, e.g. `D2`), `marks` the cells the red pen rings, and `figure.add` / `figure.ring`
  the figure elements it draws and rings.

The teaching-method gate holds them to it: the artefact is declared and shipped, the fill order
is declared and every worked-out value is written exactly once, the first step shows the figure
as the question sets it, and nothing is ringed before it is on the sheet.

Each live sim sits inline in its Worked example, checked three ways against its recompute log and
the sheet, on synthetic numbers worked out here:

- Module 1: `sims/plate.json` (plane wall), in W01.2, a 40 mm plate cooling from both faces,
  checked against the Fourier series. It is the Fixture Course's heatmap.
- Module 3 (gradient descent): `sims/descent.json`, in W03.1, a line fit to three points.
  `sims/descent-steps.json` is marked `recompute: none` only to exercise the step-through a sim
  falls back to; it sits in the Lab and the Tool gallery. `python/normal-equation.yaml` is its
  Pyodide tool, below W03.1: numpy solves the same line by the normal equation, and it is the Tool
  gallery's Pyodide timing run.
- Module 5 (derivatives): `sims/tangent.json` (tangent), in W05.1, the secants of a cubic closing
  on its tangent, checked by direct evaluation.

Module 7 (flanged hub) carries the machine part: `parts/hub.py` builds the hub of W07.1 (a flange
with four bolt holes, a hub and a bore), whose table sums its volume from the drawing's primitives.
Its overall height is tagged scaled and its bolt holes' size assumed, both confirmed, so the
Fixture Course raises no Checkpoint item; `tools/recompute-flanged-hub.py` is its independent
volume, summed by hand.

Module 4 (full adder) carries the logic sim, on a synthetic full adder (two XORs, two ANDs and an
OR, the figure the sim-layout prototype drew). W04.1 fills its truth table net by net;
`sims/adder.json` sits inline in it, checked bit for bit against its recompute log and the sheet,
and drawn by the layout core from its hints, checked against the Blind reader's reading of the
figure.

Module 8 (root locus) carries the control sim, on the synthetic loop K/(s(s + 2)) under unity
feedback. W08.1 works the loop at K = 4 (ωn, ζ, the poles, overshoot, peak, rise and settling
times by the style sheet's definitions, and the phase margin); `sims/loop.json` sits inline in it,
checked three ways against python-control and the sheet, and its block diagram is drawn by the
layout core from its hints, checked against the Blind reader's reading of the figure.

Module 10 (two conveyors) carries the ladder sim: a start/stop latch on conveyor 1 and a TON that
starts conveyor 2 five seconds later. W10.1 fills a timing table from the example's timeline
(Start pressed at 1.0 s, Stop at 8.0 s), the key the `ladder` gate checks three ways. Its figure is
a synthetic STEP 7 LAD editor screenshot (`build-records/figure/10-two-conveyors/conveyors.png`); a
Blind reader read it, never seeing a builder file, keying each part by network, kind and operand.

Module 12 (pneumatic cascade) carries the pneumatic sim: cylinders A and B run A+ B+ B− A− in two
groups, switched by the cascade valve CV. W12.1 draws the displacement-step diagram, the key the
`timing-key` gate checks three ways; `tools/recompute-cascade.py` walks each line back to the supply
or an exhaust, apart from the engine. Its figure is synthetic, described by the Blind reader's
reading in `build-records/figure/12-cascade/`.
Module 11 (mechanisms) carries the mechanism sim, twice: a standard spur gear pair (module 2, 18 and
36 teeth, 20°) in W11.1 and a crank-rocker four-bar (ground 100, crank 40, coupler 120, rocker 80 mm,
with a coupler point) in W11.2, each sim sitting below its Worked example. Both are synthetic, no
Professor's figure. The recompute logs are written by `tools/recompute-gear-pair.py` (the
path-of-contact formulas and rolling) and `tools/recompute-four-bar.py` (Freudenstein's equation in
half-angle form), never by hand: run `python fixture-course/tools/recompute-four-bar.py` (or
`recompute-gear-pair.py`) from the repo root, and the sheets' values are read off their output.

Module 13 (cell potential) carries the Nernst sim and a molecule. The cell is a copper concentration
cell, Cu | Cu²⁺ ‖ Cu²⁺ | Cu at 298.15 K with c₁ = 0.010 mol/L and c₂ = 1.0 mol/L and E° = +0.34 V
for both electrodes, so E° of the cell is 0 and the sliders can take E below 0 and turn the cell
round. W13.1 works Q, E and ΔG at the example's values, the sheet the `nernst` gate checks three
ways; `tools/recompute-nernst.py` works each half-cell's own Nernst potential, apart from the
engine, and walks all 729 slider states. The plot has five isotherms, four shown. Glycine
(`molecules/glycine.json`, SMILES `NCC(=O)O`) is drawn by RDKit as a 2D structure and a 3D
conformer, checked against PubChem's recorded answer for "glycine" (CID 750); the recorded
response was captured live once with `npm run pubchem -- --save`. The module's `further` link
is PhET's Concentration, credited as PhET asks, CC BY-NC 4.0, opening in a new tab.

Module 14 (state machines) carries the FSM and GRAFCET sims. The detector is a Moore machine that
watches its input x for 1, 0, 1 with overlaps. Its synthetic figure has S0 at the left middle, its
self-loop below it and the start arrow coming in from the left; S1 above and S2 below in the middle
column, S1's self-loop above; S3, the double circle, at the right middle; and the two arcs between S2
and S3, S2's to S3 bowed below and S3's to S2 above. W14.1 traces it period by period on the input
0, 1, 1, 0, 1, 0, 1, 0, 0, the key the `timing-key` gate checks three ways against the detector's
strip. The drill is a GRAFCET: steps 0, 1 and 2 in one column, step 0 a double square, the actions KM1
and KM2 in boxes on the right of steps 1 and 2, and the return link from step 2 to step 0 running up
the left. W14.2 traces it on the inputs m, a and b, keyed the same way. `tools/recompute-state-machines.py`
recomputes both apart from the engine, the detector from a hand-read lookup table and the drill from
IEC 60848's firing rules, and writes each sim's whole table to its log in `build-records/recompute/`.
Both figures are synthetic, described by the Blind reader's readings in
`build-records/figure/14-state-machines/`.

Every string is prose: math is written between `$…$` (inline) or `$$…$$` (display), `\ce{…}`
renders chemistry, and a literal dollar sign is written `\$`. In JSON every backslash is doubled;
in YAML use single quotes or a block scalar.
