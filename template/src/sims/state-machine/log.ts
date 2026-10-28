// What the independent recompute leaves for a state-machine sim: the recompute log plus the table it
// worked, every situation the machine can reach under every combination of its inputs. Only the gates
// import this file: it imports `three-way.ts`, which imports the sim kinds, which import the engine, so
// the engine must never import it back.
import { z } from "astro/zod";
import { recomputeLog } from "../three-way.ts";
import { stateName, type Machine, type TableRow } from "./engine.ts";

const bit = z.union([z.literal(0), z.literal(1)]);

export const tableRow = z.strictObject({
  from: z.array(z.string()).min(1),
  inputs: z.record(z.string(), bit),
  to: z.array(z.string()),
  outputs: z.record(z.string(), bit),
});

export const stateMachineLog = recomputeLog.extend({
  /** Every reachable situation under every input combination, as the recompute worked it. */
  table: z.array(tableRow).min(1),
});
export type StateMachineLog = z.output<typeof stateMachineLog>;

/** A row's identity: the situation and the combination, in the machine's own order. */
const keyOf = (machine: Machine, row: Pick<TableRow, "from" | "inputs">) =>
  `${[...row.from].sort().join(",")}|${machine.model.inputs.map((i) => row.inputs[i]).join("")}`;

/**
 * Row by row, keyed by the situation and the combination: order doesn't matter. Names each wrong
 * target, wrong output, missing row and extra row; `situations` counts the engine's distinct `from`
 * and `rows` the engine's rows.
 */
export function compareTable(
  machine: Machine,
  engine: readonly TableRow[],
  logged: readonly TableRow[],
): { mismatches: string[]; situations: number; rows: number } {
  const mismatches: string[] = [];
  const names = (ids: readonly string[]) =>
    ids
      .map((id) => {
        const s = machine.model.states.find((q) => q.id === id);
        return s ? stateName(machine.family, s) : id;
      })
      .join(" and ");
  const when = (row: Pick<TableRow, "from" | "inputs">) =>
    `${names(row.from)} active and ${machine.model.inputs.map((i) => `${i} = ${row.inputs[i]}`).join(", ")}`;
  const theirs = new Map(logged.map((row) => [keyOf(machine, row), row]));
  const ours = new Set(engine.map((row) => keyOf(machine, row)));
  for (const row of engine) {
    const other = theirs.get(keyOf(machine, row));
    if (!other) {
      mismatches.push(`the recompute's table has no row for ${when(row)}`);
      continue;
    }
    if ([...row.to].sort().join() !== [...other.to].sort().join())
      mismatches.push(`with ${when(row)}, the engine goes to ${names(row.to)} and the recompute to ${names(other.to)}`);
    for (const output of machine.model.outputs)
      if (row.outputs[output] !== other.outputs[output])
        mismatches.push(
          `with ${when(row)}, the engine gives ${output} = ${row.outputs[output]} and the recompute ${output} = ${other.outputs[output]}`,
        );
  }
  for (const row of logged)
    if (!ours.has(keyOf(machine, row)))
      mismatches.push(`the recompute's table has a row for ${when(row)}, which the engine never reaches`);
  return { mismatches, situations: new Set(engine.map((r) => r.from.join())).size, rows: engine.length };
}
