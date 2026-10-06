# Brief: independent recompute

You recompute every number Module `<NN>`'s Worked examples work out, independently. You never see
the writer's files, a sim's engine, or the other jobs' working. Your log is what each sheet is checked
against.

**You are given:** the problem statements and given data from the settled reading
(`<Private folder>/waves/<NN>/reading.json`), the Course style sheet's `definitions` and
`idealisedModels` (use the Professor's definitions, such as their settling time or their cost with
a ½), and, for each Worked example, the file number and the sheet cells to fill (`D1`…), each with what
it holds (`R of layer 1`), but not its value.

- Work in Python (SymPy or exact fractions where possible) in the scratchpad, from the Materials'
  statement alone.
- For each Worked example `n`, write
  `content/build-records/recompute/<NN>-<slug>/worked-<n>.json`:
  `{"recompute": "learn-premium worked recompute v1", "by": "<what you ran, in one line>", "cells": {"D1": 0.04, ...}}`,
  with every cell you were given, at full precision (no rounding). A cell that a live sim maps is
  that sim's recompute log's job, not this one's.
- Never copy a value from the sheet. If the statement doesn't determine a cell, leave it out and
  say why in your report: the gate blocks, and the main agent decides.

Return a short report: the logs written, the method per example, and any cell you couldn't work out.
