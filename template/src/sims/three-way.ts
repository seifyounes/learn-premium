// Every number a live sim gives, checked three ways: the engine replayed in Node, the independent
// recompute (which never sees the engine or the writer, and logs what it worked out), and the
// Worked example's sheet at its printed precision. Engine ≠ recompute is a bug, so it blocks; the
// two agreeing against the sheet is the Professor's call, so it goes to the Owner as a Checkpoint
// item, unless the Owner already ruled on it: a Divergence ships as printed, and a Slip the sheet
// still prints blocks, since the site ships the corrected value. A truth table is checked exactly
// instead: bits have no last digit to round, and the recompute works out every row the engine
// gives. Pure: the gate reads the files.
import { z } from "astro/zod";
import { parseCell } from "../worked/cells.ts";
import { definitions, type PinnedDefinitions } from "./definitions.ts";
import { engineQuantities, type LiveSim } from "./kinds.ts";
import { agreesAtPrint, printAt, readPrinted, rulingValues, type Printed } from "./precision.ts";

export const RECOMPUTE_LOG = "learn-premium recompute log v1";

/** What the independent recompute leaves in the Course's build records for one sim. */
export const recomputeLog = z.strictObject({
  recompute: z.literal(RECOMPUTE_LOG),
  /** Who or what recomputed it, and how. */
  by: z.string().min(1),
  /** The inputs it took from the Materials: the sim must open on the same. */
  inputs: z.strictObject({ model: z.unknown(), start: z.record(z.string(), z.number()) }),
  /** The Course style sheet's definitions it worked to (the settling band…), as it read them. */
  definitions: definitions.optional(),
  /** Every number it worked out, by the engine's names for them. */
  values: z.record(z.string(), z.number()),
});
export type RecomputeLog = z.output<typeof recomputeLog>;

/**
 * The Worked example's table as printed, and the Owner's rulings on it: each Divergence's value,
 * and each Slip's value as the sheet printed it. A ruling is matched by its number, since it names
 * no cell.
 */
export interface Sheet {
  rows: readonly (readonly string[])[];
  divergences: readonly string[];
  slips: readonly string[];
}

export interface Disagreement {
  outcome: "block" | "checkpoint";
  /** Where it is fixed: the sim (the builder's or the recompute's to fix) or the sheet (the Owner's to rule). */
  on: "sim" | "sheet";
  message: string;
}

export interface ThreeWay {
  problems: Disagreement[];
  /** Sheet cells compared three ways. */
  sheetValues: number;
  /** Recompute-log values compared with the engine. */
  recomputedValues: number;
}

/** Off the sheet there is no printed precision: engine and recompute agree to float rounding. */
const RELATIVE = 1e-9;

export interface Comparison {
  /** Bit for bit, every value the engine gives recomputed: a truth table. Else at the sheet's printed precision. */
  exact: boolean;
  /** The Course style sheet's pinned definitions, which the engine works to. */
  pinned?: PinnedDefinitions | undefined;
}

export function threeWay(
  s: LiveSim,
  log: RecomputeLog,
  sheet: Sheet | undefined,
  { exact, pinned }: Comparison = { exact: false },
): ThreeWay {
  const result: ThreeWay = { problems: [], sheetValues: 0, recomputedValues: 0 };
  const agrees = (value: number, printed: Printed) => (exact ? value === printed.value : agreesAtPrint(value, printed));
  const print = (value: number, decimals: number) => (exact ? String(value) : printAt(value, decimals));
  const atPrecision = (decimals: number) => (exact ? "" : `, at the sheet's ${decimals} decimals`);
  const block = (message: string) => result.problems.push({ outcome: "block", on: "sim", message });

  const changed = [
    ...differences(log.inputs.model, s.model, "model"),
    ...differences(log.inputs.start, s.start, "start"),
  ];
  if (changed.length > 0) {
    block(
      `the recompute log was worked from other inputs (${changed.join("; ")}): the sim opens on the example's values, so fix the sim or recompute from the Materials`,
    );
    return result;
  }

  let engine: Record<string, number>;
  try {
    engine = engineQuantities(s, s.start, pinned);
  } catch (error) {
    block(`can't run the engine: ${(error as Error).message}`);
    return result;
  }
  // Each ruling settles one cell: a value ruled once doesn't also settle another cell printing it.
  const counts = (written: readonly string[] = []) => {
    const found = new Map<number, number>();
    for (const n of written.flatMap(rulingValues)) found.set(n, (found.get(n) ?? 0) + 1);
    return found;
  };
  const take = (remaining: Map<number, number>, value: number) => {
    const n = remaining.get(value) ?? 0;
    if (n > 0) remaining.set(value, n - 1);
    return n > 0;
  };
  const divergences = counts(sheet?.divergences);
  const slips = counts(sheet?.slips);
  const onSheet = new Set<string>();
  for (const [cell, quantity] of Object.entries(s.sheet)) {
    onSheet.add(quantity);
    const { row, col } = parseCell(cell);
    const text = sheet?.rows[row]?.[col];
    if (text === undefined) {
      block(`sheet cell ${cell} (${quantity}) isn't on the Worked example's table`);
      continue;
    }
    const printed = readPrinted(text);
    if (typeof printed === "string") {
      block(`sheet cell ${cell} (${quantity}) can't be compared: ${printed}`);
      continue;
    }
    const fromEngine = engine[quantity];
    const fromRecompute = log.values[quantity];
    if (fromEngine === undefined) {
      block(`sheet cell ${cell} maps ${quantity}, which the engine doesn't give at the example's inputs`);
      continue;
    }
    if (fromRecompute === undefined) {
      block(`sheet cell ${cell} maps ${quantity}, which the recompute log doesn't give`);
      continue;
    }
    result.sheetValues += 1;
    const d = printed.decimals;
    if (!agrees(fromEngine, { ...printed, value: fromRecompute })) {
      block(
        `${quantity} (sheet cell ${cell}): the engine gives ${print(fromEngine, d)} but the independent recompute gives ${print(fromRecompute, d)}${atPrecision(d)}; fix whichever is wrong`,
      );
    } else if (!agrees(fromEngine, printed) && !take(divergences, Math.abs(printed.value))) {
      const computed = `${print(fromEngine, d)} (${quantity})`;
      result.problems.push(
        take(slips, Math.abs(printed.value))
          ? {
              outcome: "block",
              on: "sheet",
              message: `sheet cell ${cell} prints ${printed.written}, which the Owner ruled a Slip: the site ships the corrected value, ${computed}`,
            }
          : {
              outcome: "checkpoint",
              on: "sheet",
              message: `sheet cell ${cell} prints ${printed.written}, but the engine and the independent recompute both give ${computed}: rule it a Slip or a Divergence`,
            },
      );
    }
  }

  for (const [quantity, fromRecompute] of Object.entries(log.values)) {
    const fromEngine = engine[quantity];
    if (fromEngine === undefined) {
      block(`the recompute log gives ${quantity}, which the engine doesn't`);
      continue;
    }
    result.recomputedValues += 1;
    if (onSheet.has(quantity)) continue;
    const off = exact
      ? fromEngine !== fromRecompute
      : Math.abs(fromEngine - fromRecompute) > RELATIVE * Math.max(1, Math.abs(fromRecompute));
    if (off) {
      block(
        `${quantity}: the engine gives ${fromEngine} but the independent recompute gives ${fromRecompute}; fix whichever is wrong`,
      );
    }
  }
  if (exact) {
    for (const quantity of Object.keys(engine)) {
      if (!(quantity in log.values))
        block(`the recompute log doesn't give ${quantity}: a truth table's recompute works out every row`);
    }
  }
  return result;
}

/** Leaf paths where `log` and `sim` differ, each as `path: <log> in the log, <sim> in the sim`. */
function differences(log: unknown, sim: unknown, path: string): string[] {
  if (Array.isArray(log) && Array.isArray(sim) && log.length === sim.length)
    return log.flatMap((item, i) => differences(item, sim[i], `${path}.${i}`));
  const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  if (isRecord(log) && isRecord(sim)) {
    const keys = [...new Set([...Object.keys(log), ...Object.keys(sim)])];
    return keys.flatMap((key) => differences(log[key], sim[key], `${path}.${key}`));
  }
  if (JSON.stringify(log) === JSON.stringify(sim)) return [];
  return [`${path}: ${JSON.stringify(log) ?? "nothing"} in the log, ${JSON.stringify(sim) ?? "nothing"} in the sim`];
}
