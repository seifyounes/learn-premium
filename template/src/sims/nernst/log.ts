// What the independent recompute leaves for a Nernst sim: the three-way log, plus the whole slider
// grid. The sweep is each tuned input at 9 points, every combination, with the cell's potential and
// its anode worked out by the recompute's own reasoning: the electrode with the lower reduction
// potential is oxidised.
import { z } from "astro/zod";
import { recomputeLog } from "../three-way.ts";
import type { Range } from "../tuning.ts";

export const SWEEP_POINTS = 9;

/** The order the grid is walked in, c1 slowest, whatever order `tune` is written in. */
export const SWEEP_ORDER = ["c1", "c2", "T"] as const;
const rank = (name: string) => {
  const place = (SWEEP_ORDER as readonly string[]).indexOf(name);
  return place < 0 ? SWEEP_ORDER.length : place;
};

/** The tuned inputs' names in the grid's order (c1, c2, T). */
export const sweepOrder = (tune: Record<string, unknown>): string[] =>
  Object.keys(tune).sort((a, b) => rank(a) - rank(b));

/**
 * Each tuned input at 9 points, min to max inclusive (v_k = min + k·(max − min)/8), every
 * combination. c1 varies slowest, then c2, then T: the order is fixed here, the recompute brief and
 * the Fixture recompute script, not read from the order the sim file happens to list `tune` in.
 */
export function sweepGrid(tune: Record<string, Range>): Record<string, number>[] {
  let grid: Record<string, number>[] = [{}];
  for (const name of sweepOrder(tune)) {
    const { min, max } = tune[name] as Range;
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
