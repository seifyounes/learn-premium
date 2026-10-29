// What a state-machine sim's content contract checks that needs the engine: names, labels, the
// encoding, the outputs, the stimulus, a state's every input going somewhere, and equations that must
// reproduce the diagram. The static checks come first; the checks that run the engine only when
// those find nothing.
import { evaluate, namesIn, parseExpression, type Bit } from "./expressions.ts";
import {
  combos,
  machineOf,
  machineTable,
  stateBits,
  stateName,
  MachineError,
  type Family,
  type MachineModel,
} from "./engine.ts";

const MIN_PERIODS = 2;
const MAX_PERIODS = 16;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** `x = 0`, `m = 1, a = 1, b = 0`. */
const say = (inputs: Readonly<Record<string, number>>) =>
  Object.entries(inputs)
    .map(([name, v]) => `${name} = ${v}`)
    .join(", ");

export function machineProblems(family: Family, model: MachineModel): string[] {
  const statics = staticProblems(family, model);
  if (statics.length > 0) return statics;
  // The equations are run on the diagram only once every state says where each input takes it.
  const deterministic = determinismProblems(family, model);
  return deterministic.length > 0 ? deterministic : equationProblems(family, model);
}

function staticProblems(family: Family, model: MachineModel): string[] {
  const out: string[] = [];
  const ids = new Set(model.states.map((s) => s.id));
  const nameOfId = (id: string) => model.states.find((s) => s.id === id)?.label ?? id;

  // names
  // A GRAFCET's step ids are its state variables (`X0`…) on the strip.
  const variables = family === "fsm" ? (model.encoding?.variables ?? []) : model.states.map((s) => s.id);
  const groups: [string, readonly string[]][] = [
    ["an input", model.inputs],
    ["an output", model.outputs],
    ["a state variable", variables],
  ];
  groups.forEach(([a, as], i) =>
    groups.slice(i + 1).forEach(([b, bs]) => {
      for (const name of as) if (bs.includes(name)) out.push(`${name} names both ${a} and ${b}`);
    }),
  );
  for (const [what, names] of groups)
    names.forEach((name, i) => {
      if (names.indexOf(name) !== i) out.push(`${name} is listed twice among the ${what.replace(/^an? /, "")}s`);
    });
  if (family === "grafcet")
    for (const s of model.states)
      if (s.id !== `X${s.label}`) out.push(`step ${s.id}'s id isn't X followed by its number (${s.label})`);

  // labels
  for (const e of model.edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) continue;
    const name = `${e.from} → ${e.to}`;
    if (family === "fsm") {
      for (const p of e.label.split(",").map((q) => q.replace(/\s+/g, ""))) {
        if (!/^[01-]+$/.test(p))
          out.push(
            `${name}'s label "${e.label}" isn't an input pattern: one 0, 1 or - per input, several joined by commas`,
          );
        else if (p.length !== model.inputs.length)
          out.push(
            `${name}'s label "${e.label}" has ${plural(p.length, "bit")}, but the machine has ${plural(model.inputs.length, "input")} (${model.inputs.join(", ")}): one 0, 1 or - per input`,
          );
      }
    } else {
      try {
        const unknown = namesIn(parseExpression(e.label)).find((n) => !model.inputs.includes(n));
        if (unknown !== undefined) out.push(`${name}'s receptivity names ${unknown}, which isn't an input`);
      } catch (error) {
        out.push(`${name}'s receptivity "${e.label}" can't be read: ${(error as Error).message}`);
      }
    }
  }

  // the start, and an FSM's encoding
  if (family === "fsm") {
    if (model.initial !== undefined && !ids.has(model.initial))
      out.push(`the initial state ${model.initial} isn't a state of the model`);
    const encoding = model.encoding;
    if (encoding) {
      const seen = new Map<string, string>();
      for (const s of model.states) {
        const code = encoding.codes[s.id];
        if (code === undefined) out.push(`the encoding gives no code for ${nameOfId(s.id)}`);
        else if (code.length !== encoding.variables.length)
          out.push(
            `${nameOfId(s.id)}'s code ${code} has ${plural(code.length, "bit")}, but the encoding has ${plural(encoding.variables.length, "variable")}`,
          );
        else {
          const other = seen.get(code);
          if (other !== undefined) out.push(`${other} and ${nameOfId(s.id)} share the code ${code}`);
          seen.set(code, nameOfId(s.id));
        }
      }
      for (const id of Object.keys(encoding.codes))
        if (!ids.has(id)) out.push(`the encoding names ${id}, which the model doesn't have`);
    }
  } else if (!model.states.some((s) => s.kind === "step-initial"))
    out.push("the GRAFCET has no initial step: the figure draws one as a double square (step-initial)");

  // outputs
  for (const s of model.states)
    for (const o of s.out ?? [])
      if (!model.outputs.includes(o)) out.push(`${nameOfId(s.id)} sets ${o}, which isn't an output`);
  for (const o of model.outputs)
    if (!model.states.some((s) => s.out?.includes(o))) out.push(`output ${o} is set by no state`);

  // the stimulus
  const given = Object.keys(model.stimulus);
  if (given.join() !== model.inputs.join())
    out.push(
      `the stimulus gives ${given.join(", ") || "nothing"}, but the inputs are ${model.inputs.join(", ")}, in that order`,
    );
  else {
    const lengths = given.map((name) => (model.stimulus[name] as string).length);
    if (new Set(lengths).size > 1)
      out.push(
        `the stimulus's inputs run ${lengths.slice(0, -1).join(", ")} and ${lengths.at(-1)} periods: give every input for every period`,
      );
    else if ((lengths[0] ?? 0) < MIN_PERIODS || (lengths[0] ?? 0) > MAX_PERIODS)
      out.push(`the stimulus runs ${plural(lengths[0] ?? 0, "period")}: give ${MIN_PERIODS} to ${MAX_PERIODS}`);
  }
  return out;
}

/** Every state takes each input combination somewhere (an FSM), exclusively (a GRAFCET's alternative branch). */
function determinismProblems(family: Family, model: MachineModel): string[] {
  let machine;
  try {
    machine = machineOf(family, model);
  } catch (error) {
    return error instanceof MachineError ? [error.message] : [];
  }
  const out: string[] = [];
  for (const s of model.states) {
    const name = stateName(family, s);
    const mine = machine.edges.filter((e) => e.from === s.id);
    if (family === "fsm") {
      for (const bits of combos(model.inputs)) {
        const holding = mine.filter((e) => e.holds(bits));
        if (holding.length === 0) {
          out.push(
            `${name} has no edge for ${say(bits)}: a state machine's every state says where each input takes it`,
          );
          break;
        }
        const [first, second] = holding;
        if (first && second) {
          const named = (e: typeof first) => `${nameOf(model, e.from)} → ${nameOf(model, e.to)} ("${e.label}")`;
          out.push(`${named(first)} and ${named(second)} both take ${say(bits)}: one input takes one edge`);
          break;
        }
      }
    } else {
      let reported = false;
      for (const bits of combos(model.inputs)) {
        const holding = mine.filter((e) => e.holds(bits));
        const [first, second] = holding;
        if (!reported && first && second) {
          out.push(
            `${name}'s receptivities ${first.label} and ${second.label} can both hold (${say(bits)}): an alternative branch takes exclusive receptivities`,
          );
          reported = true;
        }
      }
    }
  }
  return out;
}

const nameOf = (model: MachineModel, id: string) => model.states.find((s) => s.id === id)?.label ?? id;

/** Equations read, name real variables, and reproduce the diagram on every reachable situation. */
function equationProblems(family: Family, model: MachineModel): string[] {
  const equations = model.equations;
  if (!equations) return [];
  const out: string[] = [];
  const variables = family === "grafcet" ? model.states.map((s) => s.id) : (model.encoding?.variables ?? []);
  const known = new Set([...model.inputs, ...variables]);
  const parsed: { name: string; gives: string; expr: string; tree: ReturnType<typeof parseExpression> }[] = [];
  const gave = new Set<string>();
  for (const eq of equations) {
    if (gave.has(eq.gives)) out.push(`the equations give ${eq.gives} twice`);
    gave.add(eq.gives);
    let tree;
    try {
      tree = parseExpression(eq.expr);
    } catch (error) {
      out.push(`equation ${eq.name} can't be read: ${(error as Error).message}`);
      continue;
    }
    const unknown = namesIn(tree).find((n) => !known.has(n));
    if (unknown !== undefined) out.push(`equation ${eq.name} names ${unknown}, which is no input or state variable`);
    if (!variables.includes(eq.gives) && !model.outputs.includes(eq.gives))
      out.push(`equation ${eq.name} gives ${eq.gives}, which is no state variable or output`);
    parsed.push({ ...eq, tree });
  }
  if (out.length > 0) return out;

  const machine = machineOf(family, model);
  const rows = machineTable(machine);
  for (const eq of parsed) {
    for (const row of rows) {
      const bits = { ...row.inputs, ...stateBits(machine, row.from) };
      const value: Bit = evaluate(eq.tree, bits);
      const isVariable = variables.includes(eq.gives);
      const diagram = isVariable ? stateBits(machine, row.to)[eq.gives] : row.outputs[eq.gives];
      if (diagram === undefined || diagram === value) continue;
      const active = row.from.map((id) => nameOf(model, id)).join(" and ");
      out.push(
        `${eq.name} = ${eq.expr} gives ${value} with ${active} active and ${say(row.inputs)}, but the diagram gives ${eq.gives} = ${diagram}${isVariable ? " next" : ""}`,
      );
      break;
    }
  }
  return out;
}
