// What makes a ladder or FBD sim hold together before anything runs: its networks draw (every pin in
// one net, a hint for every part, every element at turn 0 as STEP 7 draws it) and run (operands that
// fit their elements, a network that settles in one pass), the example's values set every input,
// and each timeline's changes fall on scans. The content contract reports each problem.

import type { LayoutHints } from "../layout/drawing.ts";
import { schematicProblems } from "../layout/validate.ts";
import type { Timeline, TuneRange } from "./engine.ts";
import { ladderProblems, schematicOf, type LadderModel } from "./model.ts";

type Problem = { path: (string | number)[]; message: string };

/** A timeline's changes: each on a scan (a whole number of cycles), by the end, setting only inputs. */
export function timelineProblems(
  timeline: Timeline,
  inputs: readonly string[],
  cycle: number,
  path: (string | number)[],
): Problem[] {
  const out: Problem[] = [];
  if (timeline.until % cycle !== 0)
    out.push({ path: [...path, "until"], message: `${timeline.until} ms isn't a whole number of ${cycle} ms scans` });
  timeline.events.forEach((event, i) => {
    if (event.at % cycle !== 0 || event.at > timeline.until)
      out.push({
        path: [...path, "events", i, "at"],
        message: `${event.at} ms isn't a scan's time: scans run every ${cycle} ms up to ${timeline.until} ms`,
      });
    for (const operand of Object.keys(event.set))
      if (!inputs.includes(operand))
        out.push({ path: [...path, "events", i, "set", operand], message: `${operand} isn't one of the inputs` });
  });
  return out;
}

export function ladderSimProblems(s: {
  model: LadderModel;
  layout?: LayoutHints | undefined;
  cycle: number;
  start: Readonly<Record<string, number>>;
  tune?: Readonly<Record<string, TuneRange>> | undefined;
  scenario?: Timeline | undefined;
  cases: readonly (Timeline & { name: string })[];
}): Problem[] {
  const out: Problem[] = [];
  // The networks are judged once they draw: a pin in no net isn't also an element with no input.
  const structure = s.layout ? schematicProblems(schematicOf(s.model), s.layout) : [];
  for (const message of structure.length > 0 ? structure : ladderProblems(s.model))
    out.push({ path: ["model"], message });
  for (const [id, hint] of Object.entries(s.layout?.parts ?? {}))
    if ((hint.turn ?? 0) !== 0 || hint.flip)
      out.push({
        path: ["layout", "parts", id],
        message: "a ladder or FBD element reads left to right, as STEP 7 draws it: no turn and no flip",
      });
  for (const key of ["start", "tune"] as const) {
    const given = Object.keys(s[key] ?? {});
    if (s[key] !== undefined && given.join() !== s.model.inputs.join())
      out.push({
        path: [key],
        message: `${key} gives ${given.join(", ") || "nothing"}, but the inputs are ${s.model.inputs.join(", ")}, in that order`,
      });
  }
  for (const [operand, range] of Object.entries(s.tune ?? {}))
    if (range.min !== 0 || range.max !== 1 || range.step !== 1)
      out.push({ path: ["tune", operand], message: "an input bit is tuned from 0 to 1 in steps of 1" });
  if (s.scenario) out.push(...timelineProblems(s.scenario, s.model.inputs, s.cycle, ["scenario"]));
  s.cases.forEach((c, i) => out.push(...timelineProblems(c, s.model.inputs, s.cycle, ["cases", i])));
  return out;
}
