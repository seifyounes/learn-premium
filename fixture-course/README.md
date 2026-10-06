# Fixture Course

A small synthetic Course that the Site template builds on every change. It is written from
textbook physics, with no Professor's material, so it can live in this repo. Every value in it is
worked out here, not copied from any Course's Materials.

Layout (content contract v0):

- `course.yaml`: the course config (name, pad, Credit line, `owner` for the About page) and the
  Exam `sittings`, in exam order: each has an `id` (its route), a `name`, an optional `date`
  (`YYYY-MM-DD`), the `modules` it covers by folder name, and `complete`, which only the Owner sets.
  A complete sitting gets its Revision page.
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
  with an optional `figure` (a plot) in its frontmatter. A Module has at most five beats.
- `modules/<NN>-<slug>/worked/<n>.json`: one Worked example each (JSON or YAML).
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
- `modules/<NN>-<slug>/practice/<n>.yaml`: one Practice item each (JSON or YAML). A `numeric`
  item has an `answer` (`value`, `unit`, `tolerance`) the site checks; a `prose` item lists what
  `earns` the mark, one point per mark, for the student to mark themselves against.

Every Worked example, Practice item and Summary beat tags each number it shows in a `provenance`
block: `stated` (in the Materials), `derived` (worked out, no official key), `scaled` (measured
off a drawing) or `assumed` (supplied here). A value can be written bare (`0.25`) or in context
(`$L = 0.25\ \text{m}$`), and every number in it counts as tagged. `slips` (`value`, `sheet`,
`note`) and `divergences` (`value`, `note`) record the Owner's rulings. The provenance gate
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

Module 4 (full adder) carries the logic sim, on a synthetic full adder (two XORs, two ANDs and an
OR, the figure the sim-layout prototype drew). W04.1 fills its truth table net by net;
`sims/adder.json` sits inline in it, checked bit for bit against its recompute log and the sheet,
and drawn by the layout core from its hints, checked against the Blind reader's reading of the
figure.

Every string is prose: math is written between `$…$` (inline) or `$$…$$` (display), `\ce{…}`
renders chemistry, and a literal dollar sign is written `\$`. In JSON every backslash is doubled;
in YAML use single quotes or a block scalar.
