// The state-machine sims' engine: one token engine for an FSM and a GRAFCET. A situation is the set
// of active states (an FSM's always has one). At each clock every edge whose source is active and
// whose label holds fires at once: the fired edges' sources leave and their targets enter, entering
// winning (IEC 60848's rule: a step both left and entered stays active). An FSM is its one-token
// case. Pure functions of the model, so the page runs exactly what the build's gates replay. The
// kinds, the gates and the island import the engine only through this file.
import { quantityOf, type TimingRow } from "../timing/diagram.ts";
import { evaluate, namesIn, parseExpression, type Bit } from "./expressions.ts";
import type { Family, MachineModel } from "./model.ts";

export * from "./model.ts";
export type { Bit } from "./expressions.ts";

/** The active states, in model order. */
export type Situation = readonly string[];

export class MachineError extends Error {}

export interface CompiledEdge {
  from: string;
  to: string;
  label: string;
  holds(bits: Readonly<Record<string, number>>): boolean;
}

export interface Machine {
  family: Family;
  model: MachineModel;
  edges: readonly CompiledEdge[];
  initial: Situation;
}

const nameOf = (m: MachineModel, id: string) => m.states.find((s) => s.id === id)?.label ?? id;

/** An FSM edge's label: input patterns, one `0`, `1` or `-` per input, several joined by commas. */
function patternsOf(model: MachineModel, edge: { from: string; to: string; label: string }) {
  const patterns = edge.label.split(",").map((p) => p.replace(/\s+/g, ""));
  for (const p of patterns)
    if (p.length !== model.inputs.length || !/^[01-]+$/.test(p))
      throw new MachineError(
        `${nameOf(model, edge.from)} → ${nameOf(model, edge.to)}'s label "${edge.label}" isn't an input pattern: one 0, 1 or - per input, several joined by commas`,
      );
  return patterns;
}

/** Compiles the model's labels. Throws a MachineError naming a label it can't read. */
export function machineOf(family: Family, model: MachineModel): Machine {
  const edges: CompiledEdge[] = model.edges.map((edge) => {
    if (family === "fsm") {
      const patterns = patternsOf(model, edge);
      return {
        ...edge,
        holds: (bits) =>
          patterns.some((p) => [...p].every((c, i) => c === "-" || bits[model.inputs[i] as string] === Number(c))),
      };
    }
    let expr;
    try {
      expr = parseExpression(edge.label);
    } catch (error) {
      throw new MachineError(
        `${edge.from} → ${edge.to}'s receptivity "${edge.label}" can't be read: ${(error as Error).message}`,
      );
    }
    const unknown = namesIn(expr).find((n) => !model.inputs.includes(n));
    if (unknown !== undefined)
      throw new MachineError(`${edge.from} → ${edge.to}'s receptivity names ${unknown}, which isn't an input`);
    return { ...edge, holds: (bits) => evaluate(expr, bits) === 1 };
  });
  const initial =
    family === "fsm"
      ? model.initial === undefined
        ? []
        : [model.initial]
      : model.states.filter((s) => s.kind === "step-initial").map((s) => s.id);
  return { family, model, edges, initial };
}

export interface Semantics {
  /** Whether an edge fires at the clock: its source active and its label holding. */
  firable(sourceActive: boolean, holds: boolean): boolean;
  /** The active states after the clock: the fired edges' sources leave, then their targets enter. */
  step(active: ReadonlySet<string>, fired: readonly { from: string; to: string }[]): Set<string>;
  /** The situation a period's Moore outputs are read in: the present one. */
  outputsIn(present: Situation, next: Situation): Situation;
  /** The inputs the clock samples in period k (1-based): the stimulus's own. */
  sample(stimulus: Readonly<Record<string, string>>, inputs: readonly string[], k: number): Record<string, Bit>;
}

export const SEMANTICS: Semantics = {
  firable: (sourceActive, holds) => sourceActive && holds,
  step(active, fired) {
    const next = new Set(active);
    for (const f of fired) next.delete(f.from);
    for (const f of fired) next.add(f.to);
    return next;
  },
  outputsIn: (present) => present,
  sample: (stimulus, inputs, k) =>
    Object.fromEntries(inputs.map((name) => [name, stimulus[name]?.[k - 1] === "1" ? 1 : 0])) as Record<string, Bit>,
};

const inOrder = (machine: Machine, active: ReadonlySet<string>): Situation =>
  machine.model.states.filter((s) => active.has(s.id)).map((s) => s.id);

/** One clock: the edges that fire (by index) and the situation after. */
export function fire(
  machine: Machine,
  active: Situation,
  bits: Readonly<Record<string, number>>,
  semantics: Semantics = SEMANTICS,
): { next: Situation; taken: number[] } {
  const here = new Set(active);
  const taken = machine.edges.flatMap((edge, i) =>
    semantics.firable(here.has(edge.from), edge.holds(bits)) ? [i] : [],
  );
  const fired = taken.map((i) => machine.edges[i] as CompiledEdge);
  return { next: inOrder(machine, semantics.step(here, fired)), taken };
}

/** Each output at 1 while some active state lists it. */
export function outputsOf(machine: Machine, active: Situation): Record<string, Bit> {
  const on = new Set(active);
  return Object.fromEntries(
    machine.model.outputs.map((o) => [o, machine.model.states.some((s) => on.has(s.id) && s.out?.includes(o)) ? 1 : 0]),
  ) as Record<string, Bit>;
}

/** An FSM's code bits by variable (an OR over the active states); a GRAFCET's step activities `X0`…. */
export function stateBits(machine: Machine, active: Situation): Record<string, Bit> {
  const on = new Set(active);
  if (machine.family === "grafcet")
    return Object.fromEntries(machine.model.states.map((s) => [s.id, on.has(s.id) ? 1 : 0])) as Record<string, Bit>;
  const encoding = machine.model.encoding;
  if (!encoding) return {};
  return Object.fromEntries(
    encoding.variables.map((v, i) => [v, [...on].some((id) => encoding.codes[id]?.[i] === "1") ? 1 : 0]),
  ) as Record<string, Bit>;
}

export interface Period {
  k: number;
  inputs: Record<string, Bit>;
  active: Situation;
  outputs: Record<string, Bit>;
  taken: number[];
  next: Situation;
}

/** The example's stimulus, period by period, from the start situation. */
export function run(machine: Machine, semantics: Semantics = SEMANTICS): Period[] {
  const { model } = machine;
  const n = Math.max(0, ...Object.values(model.stimulus).map((s) => s.length));
  const periods: Period[] = [];
  let active = machine.initial;
  for (let k = 1; k <= n; k++) {
    const inputs = semantics.sample(model.stimulus, model.inputs, k);
    const { next, taken } = fire(machine, active, inputs, semantics);
    periods.push({
      k,
      inputs,
      active,
      outputs: outputsOf(machine, semantics.outputsIn(active, next)),
      taken,
      next,
    });
    active = next;
  }
  return periods;
}

/** The strip's rows: the inputs, then the state variables (an FSM's code bits, a GRAFCET's steps), then the outputs. */
export function timingRows(machine: Machine): TimingRow[] {
  const { model } = machine;
  const variables = machine.family === "grafcet" ? model.states.map((s) => s.id) : (model.encoding?.variables ?? []);
  return [...model.inputs, ...variables, ...model.outputs].map((id) => ({
    id,
    label: id,
    kind: "signal",
    at: "intervals",
  }));
}

/** Every row's level in every period, by quantity name (`x[3]`, `Q1[5]`, `z[6]`). */
export function levelsOf(machine: Machine, periods: readonly Period[]): Record<string, number> {
  const levels: Record<string, number> = {};
  for (const p of periods) {
    for (const [name, v] of Object.entries(p.inputs)) levels[quantityOf(name, p.k)] = v;
    for (const [name, v] of Object.entries(stateBits(machine, p.active))) levels[quantityOf(name, p.k)] = v;
    for (const [name, v] of Object.entries(p.outputs)) levels[quantityOf(name, p.k)] = v;
  }
  return levels;
}

/** Every number the engine gives for the model: the strip's levels over the example. */
export function quantities(family: Family, model: MachineModel): Record<string, number> {
  const machine = machineOf(family, model);
  return levelsOf(machine, run(machine));
}

/** Every combination of the inputs, in binary order, the first input most significant. */
export const combos = (inputs: readonly string[]): Record<string, Bit>[] =>
  Array.from({ length: 2 ** inputs.length }, (_, row) =>
    Object.fromEntries(inputs.map((name, i) => [name, ((row >> (inputs.length - 1 - i)) & 1) as Bit])),
  );

export interface TableRow {
  from: string[];
  inputs: Record<string, Bit>;
  to: string[];
  outputs: Record<string, Bit>;
}

export const MAX_SITUATIONS = 256;

/** Every reachable situation under every input combination, breadth first from the start. */
export function machineTable(machine: Machine, semantics: Semantics = SEMANTICS): TableRow[] {
  const rows: TableRow[] = [];
  const seen = new Set<string>([machine.initial.join()]);
  const queue: Situation[] = [machine.initial];
  for (let head = 0; head < queue.length; head++) {
    const from = queue[head] as Situation;
    for (const inputs of combos(machine.model.inputs)) {
      const { next } = fire(machine, from, inputs, semantics);
      rows.push({
        from: [...from],
        inputs,
        to: [...next],
        outputs: outputsOf(machine, semantics.outputsIn(from, next)),
      });
      if (!seen.has(next.join())) {
        seen.add(next.join());
        queue.push(next);
        if (queue.length > MAX_SITUATIONS)
          throw new MachineError(
            `more than ${MAX_SITUATIONS} situations are reachable: the machine is too big to tabulate`,
          );
      }
    }
  }
  return rows;
}
