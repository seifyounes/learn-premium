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

**A live pneumatic sim.** Its log is `recompute/<NN>-<slug>/<name>.json`, a recompute log plus a `trace`:
the circuit at rest, then at every step line from the start press until it is back at rest. Each state
gives every cylinder's end (0/1), its motion, every 5/2 valve's side, every line's pressure and every
roller or button made. `values` holds the timing diagram as `row[k]`: each cylinder at each step line,
each signal line during each movement. Work it by walking each line back to the supply or an exhaust,
never by the template's engine.

A live state machine's log (`kind: fsm` or `grafcet`) is `recompute/<NN>-<slug>/<name>.json`, a recompute log plus a
`table`: every situation the machine can reach from its start, under every combination of its inputs, with where
the clock takes it and its outputs there. `values` holds the timing strip as `row[k]`: each input, state variable
(an FSM's code bits, a GRAFCET's `X0`…) and output in each clock period of the example. Work it from the figure
by hand (a lookup table for an FSM, IEC 60848's firing rules for a GRAFCET), never by the template's engine.

**A sitting's papers and mocks.** For a Sitting wave you recompute every numeric question of each past
paper and each mock instead, from the question text alone (the settled reading's text for a past paper,
the question as the mock states it), without the Professor's key, the vault writer's, mock writer's or
solver's answers. Write `content/build-records/recompute/sittings/<ID>/<name>.json`, one per paper or mock:
`{"recompute": "learn-premium paper recompute v1", "by": "<what you ran, in one line>", "answers": {"1": 0.25,
"2": 0.1}}`, every numeric question by its number as the paper numbers it (question `n` is its place in
the file), at full precision. A paper or mock with no numeric question still gets its log, with `{}`
answers. Leave out a question the statement doesn't determine and say why: the gate blocks, and the main
agent decides.

**A live mechanism.** A live mechanism's log is `recompute/<NN>-<slug>/<name>.json`, in the sim recompute's
format with a `trace` added: `values` holds the sheet cells' quantities at the example's angle, and
`trace` holds one driver turn at 1° (`theta` 0 … 359, `angles` for every moving link, `points` for every
pin off the ground, each `[x, y]` in mm). Work it by a method of your own (Freudenstein's equation, a
vector-loop solve), never the template's engine.
