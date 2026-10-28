// The state-table gate's negative control: four broken engines, each a defect an engine might have.
// Each is run on the sim being checked; where it changes what the engine gives (the strip's levels or
// the table), the independent recompute must disagree with it, or the gate can't see what it claims to.
import {
  levelsOf,
  machineOf,
  machineTable,
  run,
  SEMANTICS,
  type Family,
  type MachineModel,
  type Semantics,
  type TableRow,
} from "./engine.ts";
import { compareTable } from "./log.ts";

export const MUTANTS: readonly { defect: string; semantics: Semantics }[] = [
  {
    defect: "an edge that fires on its label alone, its source not active (enabling ignored)",
    semantics: { ...SEMANTICS, firable: (_, holds) => holds },
  },
  {
    defect: "the clock samples the previous period's inputs (an input a clock late)",
    semantics: {
      ...SEMANTICS,
      sample: (stimulus, inputs, k) =>
        k === 1
          ? Object.fromEntries(inputs.map((name) => [name, 0 as const]))
          : SEMANTICS.sample(stimulus, inputs, k - 1),
    },
  },
  {
    defect: "a Moore output read after the clock, in the next situation (a Mealy reading)",
    semantics: { ...SEMANTICS, outputsIn: (_, next) => next },
  },
  {
    defect: "a source that stays active when its edge fires (the token copied, not moved)",
    semantics: {
      ...SEMANTICS,
      step: (active, fired) => new Set([...active, ...fired.map((f) => f.to)]),
    },
  },
];

interface Logged {
  values: Record<string, number>;
  table: readonly TableRow[];
}

const sameValues = (a: Record<string, number>, b: Record<string, number>) => {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
};

/**
 * Each broken engine against the sim: `not-reached` when the example and the table never show its
 * defect, `caught` when they do and the recompute's log disagrees with it, `missed` when the recompute
 * agrees with the broken engine (so the gate could not tell it from the truth). A throw counts as
 * reached and caught.
 */
export function runControls(
  family: Family,
  model: MachineModel,
  log: Logged,
): { defect: string; outcome: "caught" | "missed" | "not-reached" }[] {
  const machine = machineOf(family, model);
  const truth: Logged = { values: levelsOf(machine, run(machine)), table: machineTable(machine) };
  const differs = (a: Logged, b: Logged) =>
    !sameValues(a.values, b.values) || compareTable(machine, a.table, b.table).mismatches.length > 0;
  return MUTANTS.map(({ defect, semantics }) => {
    let broken: Logged;
    try {
      broken = { values: levelsOf(machine, run(machine, semantics)), table: machineTable(machine, semantics) };
    } catch {
      return { defect, outcome: "caught" as const };
    }
    if (!differs(broken, truth)) return { defect, outcome: "not-reached" as const };
    return { defect, outcome: differs(broken, log) ? ("caught" as const) : ("missed" as const) };
  });
}
