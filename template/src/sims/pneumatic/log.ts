// What the independent recompute leaves for a pneumatic sim: the recompute log plus the cycle it
// ran, state by state. Only the gates import this file: it imports `three-way.ts`, which imports
// the sim kinds, which import the engine, so the engine must never import it back.
import { z } from "astro/zod";
import { recomputeLog } from "../three-way.ts";
import type { Cycle, StepState } from "./engine.ts";

const level = z.union([z.literal(0), z.literal(1)]);

export const stepState = z.strictObject({
  cylinders: z.record(z.string(), level),
  motion: z.record(z.string(), z.union([z.literal(-1), z.literal(0), z.literal(1)])),
  spools: z.record(z.string(), z.enum(["12", "14"])),
  lines: z.record(z.string(), level),
  made: z.record(z.string(), level),
});

export const pneumaticLog = recomputeLog.extend({
  /** The cycle as the recompute ran it: the circuit at rest, then at every step line from the press until it is back at rest. */
  trace: z.strictObject({ rest: stepState, steps: z.array(stepState).min(2) }),
});
export type PneumaticLog = z.output<typeof pneumaticLog>;

const FIELDS = ["cylinders", "motion", "spools", "lines", "made"] as const;

const signed = (v: number) => (v < 0 ? `−${-v}` : String(v));

/** How one field's value reads in a mismatch: a cylinder out or back, a roller made or freed. */
function say(field: (typeof FIELDS)[number], value: number | string | undefined): string {
  if (value === undefined) return "nothing";
  switch (field) {
    case "cylinders":
      return value === 1 ? "out" : "back";
    case "made":
      return value === 1 ? "made" : "freed";
    case "motion":
      return signed(Number(value));
    default:
      return String(value);
  }
}

const subject = (field: (typeof FIELDS)[number], key: string) => {
  switch (field) {
    case "cylinders":
      return key;
    case "motion":
      return `${key}'s motion`;
    case "spools":
      return `${key}'s spool`;
    case "lines":
      return `line ${key}`;
    case "made":
      return key;
  }
};

/** Every state, field by field: `at step 3, VB's spool is 12 in the engine and 14 in the recompute`. */
export function compareTrace(
  cycle: Cycle,
  trace: PneumaticLog["trace"],
): { mismatches: string[]; states: number; values: number } {
  const mismatches: string[] = [];
  if (cycle.steps.length !== trace.steps.length)
    mismatches.push(`the engine's cycle has ${cycle.steps.length} steps, the recompute's ${trace.steps.length}`);
  const engine: StepState[] = [cycle.rest, ...cycle.steps];
  const recompute = [trace.rest, ...trace.steps] as StepState[];
  const states = Math.min(engine.length, recompute.length);
  let values = 0;
  for (let i = 0; i < states; i++) {
    const [a, b] = [engine[i] as StepState, recompute[i] as StepState];
    const when = i === 0 ? "at rest" : `at step ${i}`;
    for (const field of FIELDS) {
      for (const [key, value] of Object.entries(a[field])) {
        values += 1;
        const other = (b[field] as Record<string, number | string>)[key];
        if (other !== value)
          mismatches.push(
            `${when}, ${subject(field, key)} is ${say(field, value)} in the engine and ${say(field, other)} in the recompute`,
          );
      }
    }
  }
  return { mismatches, states, values };
}
