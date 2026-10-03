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
- `build-records/recompute/<NN>-<slug>/<name>.json`: a live sim's recompute log, the inputs it
  took from the Materials and every number it worked out. Here it is written by
  `tools/recompute-gradient-descent.py`, in exact fractions, apart from the template's engine.
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

Module 3 (gradient descent) carries the Fixture Course's sims, on a synthetic line fit whose numbers
are worked out here. `sims/descent.json` is the live sim inline in W03.1, checked three ways against
its recompute log and the sheet. `sims/descent-steps.json` is marked `recompute: none` only to
exercise the step-through a sim falls back to; it sits in the Lab and the Tool gallery.

Every string is prose: math is written between `$…$` (inline) or `$$…$$` (display), `\ce{…}`
renders chemistry, and a literal dollar sign is written `\$`. In JSON every backslash is doubled;
in YAML use single quotes or a block scalar.
