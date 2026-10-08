// What a control sim's block diagram must be for its engine to model it: the unity-negative-feedback
// loop, R(s) into the summing junction's plus, the error through the gain K and the plant G(s), and
// Y(s) fed back to the junction's minus. The content contract reports any other wiring: the engine
// would model a loop the figure doesn't draw. Pure.
import type { ModelNet, ModelPart } from "../layout/drawing.ts";

/** Which part of the figure plays each role in the loop, by its id. */
export interface LoopRoles {
  input: string;
  sum: string;
  gain: string;
  plant: string;
  output: string;
}

const KIND_OF: Record<keyof LoopRoles, string> = {
  input: "port",
  sum: "sum",
  gain: "block",
  plant: "block",
  output: "port",
};

export function loopProblems(model: {
  loop: LoopRoles;
  parts: readonly ModelPart[];
  nets: readonly ModelNet[];
}): string[] {
  const { loop, parts, nets } = model;
  const out: string[] = [];
  for (const [role, id] of Object.entries(loop) as [keyof LoopRoles, string][]) {
    const part = parts.find((p) => p.id === id);
    if (!part) out.push(`the loop's ${role} is ${id}, which the model doesn't have`);
    else if (part.kind !== KIND_OF[role])
      out.push(`the loop's ${role} is ${id}, a ${part.kind}: the ${role} is a ${KIND_OF[role]}`);
  }
  if (out.length > 0) return out;
  const want = [
    [`${loop.input}.t`, `${loop.sum}.in1`],
    [`${loop.sum}.out`, `${loop.gain}.in`],
    [`${loop.gain}.out`, `${loop.plant}.in`],
    [`${loop.plant}.out`, `${loop.output}.t`, `${loop.sum}.in2`],
  ];
  const same = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && a.every((pin) => b.includes(pin));
  for (const pins of want) {
    if (!nets.some((n) => same(n.pins, pins)))
      out.push(
        `the block diagram isn't a unity-feedback loop: no net joins exactly ${pins.join(", ")}, as the engine's loop does`,
      );
  }
  if (nets.length !== want.length)
    out.push(`the block diagram has ${nets.length} nets; the unity-feedback loop has ${want.length}`);
  return out;
}
