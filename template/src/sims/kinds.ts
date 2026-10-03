// The Agent-built sim kinds this template ships, each with its engine. A kind's engine is a pure
// function of the model and the inputs students tune; the number gate runs it in Node, and the
// page runs the same code for the student.
import type { z } from "astro/zod";
import type { sim } from "../content/contract.ts";
import * as gradientDescent from "./gradient-descent/engine.ts";
import type { Inputs } from "./tuning.ts";

export type Sim = z.output<typeof sim>;
export type SimKind = Sim["kind"];
type SimOf<K extends SimKind> = Extract<Sim, { kind: K }>;

interface Kind<K extends SimKind> {
  /** Every number the engine gives for the model at `inputs`, by the name sheets and recompute logs use. */
  quantities(model: SimOf<K>["model"], inputs: NonNullable<SimOf<K>["start"]>): Record<string, number>;
}

export const KINDS: { [K in SimKind]: Kind<K> } = {
  "gradient-descent": {
    quantities: (model, inputs) => gradientDescent.quantities(gradientDescent.descend(model, inputs)),
  },
};

/** A sim an independent recompute checks, which ships live: it opens on `start`, tuned over `tune`. */
export type LiveSim = Sim & { start: NonNullable<Sim["start"]>; tune: NonNullable<Sim["tune"]> };

/** Whether the sim ships live. One no recompute can check ships as its step-through instead. */
export const isLive = (s: Sim): s is LiveSim =>
  s.recompute === "independent" && s.start !== undefined && s.tune !== undefined;

/** Runs a sim's engine at `inputs` (the example's values by default). */
export function engineQuantities(s: LiveSim, inputs: Inputs = s.start): Record<string, number> {
  return KINDS[s.kind].quantities(s.model, { ...s.start, ...inputs });
}
