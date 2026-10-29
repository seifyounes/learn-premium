// What the independent recompute leaves for a Nernst sim: the three-way log, plus the whole slider
// grid. The sweep is each tuned input at 9 points, every combination, with the cell's potential and
// its anode worked out by the recompute's own reasoning: the electrode with the lower reduction
// potential is oxidised.
import { z } from "astro/zod";
import { recomputeLog } from "../three-way.ts";
import type { Range } from "../tuning.ts";

export const SWEEP_POINTS = 9;

/**
 * Each tuned input at 9 points, min to max inclusive (v_k = min + k·(max − min)/8), every
 * combination. The first `tune` key varies slowest.
 */
export function sweepGrid(tune: Record<string, Range>): Record<string, number>[] {
  let grid: Record<string, number>[] = [{}];
  for (const [name, { min, max }] of Object.entries(tune)) {
    const points = Array.from({ length: SWEEP_POINTS }, (_, k) => min + (k * (max - min)) / (SWEEP_POINTS - 1));
    grid = grid.flatMap((state) => points.map((value) => ({ ...state, [name]: value })));
  }
  return grid;
}

export const nernstLog = z.strictObject({
  ...recomputeLog.shape,
  sweep: z.array(
    z.strictObject({
      inputs: z.record(z.string(), z.number()),
      E: z.number(),
      anode: z.enum(["first", "second"]).nullable(),
    }),
  ),
});
export type NernstLog = z.output<typeof nernstLog>;
