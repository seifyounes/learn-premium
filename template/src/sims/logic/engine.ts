// The logic engine: a gate netlist (the Professor's figure as a model) and its input bits in, every
// net's level out. Pure, so the truth-table gate runs it in Node and the page runs the same code
// as the student taps a row. Students set inputs; they never rewire the gates.
import { splitPin, type ModelNet } from "../layout/drawing.ts";
import type { SymbolKind } from "../layout/symbols.ts";

/** The symbols a logic figure is drawn with: terminals and the gates. */
export const LOGIC_KINDS = [
  "port",
  "and",
  "or",
  "xor",
  "nand",
  "nor",
  "xnor",
  "not",
] as const satisfies readonly SymbolKind[];
export type LogicKind = (typeof LOGIC_KINDS)[number];
export type Bit = 0 | 1;

export interface LogicModel {
  parts: readonly { id: string; kind: LogicKind; label?: string | undefined }[];
  nets: readonly ModelNet[];
  /** The input terminals, in the truth table's column order. */
  inputs: readonly string[];
  /** The output terminals, in the truth table's column order. */
  outputs: readonly string[];
}

const GATES: Record<Exclude<LogicKind, "port">, (ins: Bit[]) => Bit> = {
  and: (ins) => (ins.every((b) => b === 1) ? 1 : 0),
  or: (ins) => (ins.some((b) => b === 1) ? 1 : 0),
  xor: (ins) => (ins.filter((b) => b === 1).length % 2 === 1 ? 1 : 0),
  nand: (ins) => (ins.every((b) => b === 1) ? 0 : 1),
  nor: (ins) => (ins.some((b) => b === 1) ? 0 : 1),
  xnor: (ins) => (ins.filter((b) => b === 1).length % 2 === 1 ? 0 : 1),
  not: ([b]) => (b === 1 ? 0 : 1),
};

/** The net a pin is on. */
const netOf = (model: LogicModel, pin: string) => model.nets.find((n) => n.pins.includes(pin));

/** What breaks the model as a logic circuit, one line each: the engine can't run it until none do. */
export function logicProblems(model: LogicModel): string[] {
  const out: string[] = [];
  const kinds = new Map(model.parts.map((p) => [p.id, p.kind]));
  const ports = model.parts.filter((p) => p.kind === "port").map((p) => p.id);
  for (const id of model.inputs)
    if (kinds.get(id) !== "port") out.push(`input ${id} isn't a terminal (port) of the model`);
  for (const id of model.outputs)
    if (kinds.get(id) !== "port") out.push(`output ${id} isn't a terminal (port) of the model`);
  for (const id of ports) {
    const roles = Number(model.inputs.includes(id)) + Number(model.outputs.includes(id));
    if (roles !== 1) out.push(`terminal ${id} must be listed once, as an input or an output`);
  }
  for (const net of model.nets) {
    const drivers = net.pins.filter((pin) => {
      const [id, name] = splitPin(pin);
      return (kinds.get(id) !== "port" && name === "out") || model.inputs.includes(id);
    });
    if (drivers.length !== 1)
      out.push(
        `net ${net.id} has ${drivers.length === 0 ? "no driver" : `${drivers.length} drivers (${drivers.join(", ")})`}: a gate output or an input drives each net, once`,
      );
  }
  if (out.length === 0) {
    try {
      levels(model, Object.fromEntries(model.inputs.map((id) => [id, 0])));
    } catch (error) {
      out.push((error as Error).message);
    }
  }
  return out;
}

/** Every net's level with the inputs at `bits` (an input not given is 0). */
export function levels(model: LogicModel, bits: Readonly<Record<string, number>>): Record<string, Bit> {
  const level: Record<string, Bit> = {};
  for (const id of model.inputs) {
    const net = netOf(model, `${id}.t`);
    if (net) level[net.id] = bits[id] === 1 ? 1 : 0;
  }
  const gates = model.parts.filter((p) => p.kind !== "port");
  const done = new Set<string>();
  // Settle gates whose inputs are all known; a pass that settles none means a loop.
  while (done.size < gates.length) {
    let settled = 0;
    for (const gate of gates) {
      if (done.has(gate.id) || gate.kind === "port") continue;
      const inputs = (gate.kind === "not" ? ["in"] : ["in1", "in2"]).map((pin) => netOf(model, `${gate.id}.${pin}`));
      const known = inputs.map((n) => (n ? level[n.id] : undefined));
      if (known.some((b) => b === undefined)) continue;
      const out = netOf(model, `${gate.id}.out`);
      if (out) level[out.id] = GATES[gate.kind](known as Bit[]);
      done.add(gate.id);
      settled += 1;
    }
    if (settled === 0) {
      const stuck = gates.filter((g) => !done.has(g.id)).map((g) => g.id);
      throw new Error(
        `gates ${stuck.join(", ")} feed each other round a loop, or read a net nothing drives: a combinational netlist settles`,
      );
    }
  }
  return level;
}

/** A row's name: its input bits in column order, e.g. `101` for A = 1, B = 0, Cin = 1. */
export const rowName = (model: LogicModel, bits: Readonly<Record<string, number>>) =>
  model.inputs.map((id) => (bits[id] === 1 ? 1 : 0)).join("");

export interface TruthRow {
  name: string;
  bits: Record<string, Bit>;
  levels: Record<string, Bit>;
}

/** Every row of the truth table, from all inputs 0 up, the first input the most significant. */
export function truthTable(model: LogicModel): TruthRow[] {
  const n = model.inputs.length;
  return Array.from({ length: 2 ** n }, (_, row) => {
    const bits = Object.fromEntries(model.inputs.map((id, i) => [id, ((row >> (n - 1 - i)) & 1) as Bit]));
    return { name: rowName(model, bits), bits, levels: levels(model, bits) };
  });
}

/**
 * Every number the engine gives: each net's level on each row, named `net[row]` (e.g. `S[101]`).
 * The same for any inputs: a truth table is the whole of what the circuit does.
 */
export function quantities(model: LogicModel): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of truthTable(model))
    for (const [net, b] of Object.entries(row.levels)) out[`${net}[${row.name}]`] = b;
  return out;
}
