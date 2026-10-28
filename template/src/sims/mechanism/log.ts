// A mechanism's recompute log: the usual one (`src/sims/three-way.ts`) with the independent
// recompute's trace of one driver turn, θ = 0, 1, … 359, added to it: each moving link's angle and each
// pin off the ground. `values` holds only the sheet's quantities, which `threeWay` compares at the
// sheet's printed precision; the trace is what the kinematics gate holds the viewer's motion to.
import { z } from "astro/zod";
import { recomputeLog } from "../three-way.ts";
import { TRACE_STEPS } from "./engine.ts";

export const mechanismLog = z.strictObject({
  ...recomputeLog.shape,
  /** One driver turn, as the recompute worked it. */
  trace: z.strictObject({
    theta: z.array(z.number()).length(TRACE_STEPS),
    /** Each moving link's angle, in degrees. */
    angles: z.record(z.string(), z.array(z.number()).length(TRACE_STEPS)),
    /** Each pin off the ground, in mm in the sheet frame. */
    points: z.record(z.string(), z.array(z.tuple([z.number(), z.number()])).length(TRACE_STEPS)),
  }),
});
export type MechanismLog = z.output<typeof mechanismLog>;
