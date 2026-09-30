# Fixture Course

A small synthetic Course that the Site template builds on every change. It is written from
textbook physics, with no Professor's material, so it can live in this repo. Every value in it is
worked out here, not copied from any Course's Materials.

Layout (content contract v0):

- `course.yaml`: the course config (name, pad, Credit line).
- `modules/<NN>-<slug>/module.yaml`: one Module; the folder name is its route.
- `modules/<NN>-<slug>/summary/<n>.md`: one Summary beat each, plain Markdown.
- `modules/<NN>-<slug>/worked/<n>.json`: one Worked example each (JSON or YAML).
- `modules/<NN>-<slug>/practice/<n>.yaml`: one Practice item each (JSON or YAML).

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

Every string is prose: math is written between `$…$` (inline) or `$$…$$` (display), `\ce{…}`
renders chemistry, and a literal dollar sign is written `\$`. In JSON every backslash is doubled;
in YAML use single quotes or a block scalar.
