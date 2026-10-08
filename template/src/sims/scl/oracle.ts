// The SCL build oracle's side of the engine: every gate case run on the engine and compared, scan by
// scan, with the blind interpreter's run of the same case (`oracle/scl-blind.ts`, written from the
// S7-SCL manual alone): every output, static and DB variable, bit for bit. Where the two part, the
// manual decides. Where the blind interpreter stops because the manual leaves the result undefined,
// or the builder found the manual silent on a value they part on, it is the Owner's: a Checkpoint
// item until it is ruled. Pure: the gate runs the blind interpreter and passes its scans in.

import { gateCases as casesFrom, type TuneRange } from "../stl/engine.ts";
import {
  INTERPRETER,
  runCase,
  type GateCase,
  type Inputs,
  type Interpreter,
  type Leaf,
  type SclModel,
} from "./engine.ts";
import { parseScl } from "./parse.ts";

export type { GateCase };

/** The cases the gate runs: the example's values, each tuned input at its slider's min, mid and max, and the written ones. */
export const gateCases = (
  start: Inputs,
  tune: Readonly<Record<string, TuneRange>>,
  written: readonly { name: string; scans: readonly Inputs[] }[] = [],
): GateCase[] => casesFrom(start, tune, written);

/** One scan as the blind interpreter left it (its own types, the same shape). */
export type BlindScan = { values: Record<string, Leaf> } | { stopped: { line: number; point: string; manual: string } };

/** Where the two interpreters part on something the manual leaves to the Owner. */
export interface SilentPoint {
  /** The variable they part on, or `line N` where the blind interpreter stopped. */
  at: string;
  where: string;
  /** What the manual leaves open, and what each interpreter gives. */
  detail: string;
}

export interface Agreement {
  /** Disagreements no ruling can settle: one side can't run, or stops where the other goes on. */
  mismatches: string[];
  /** Values the two give differently: the manual decides (a block), unless the builder found it silent. */
  parted: SilentPoint[];
  /** Where the blind interpreter stopped because the manual leaves the result undefined: the Owner's. */
  stopped: SilentPoint[];
  /** Values compared (each variable after each scan). */
  values: number;
  scans: number;
  /** Every listing line some case ran. */
  ran: Set<number>;
  /** Every construct some case ran. */
  constructs: Set<string>;
}

const show = (leaf: Leaf | undefined) =>
  leaf ? `${Object.is(leaf.value, -0) ? "-0" : String(leaf.value)} (${leaf.type})` : "nothing";

/**
 * Runs every case on the engine (or a negative control's broken one) and compares each scan with
 * the blind interpreter's. `blind[i]` is case i's scans as the blind interpreter ran them, or why it
 * couldn't run the listing.
 */
export function compareWithBlind(
  model: SclModel,
  cases: readonly GateCase[],
  blind: readonly (BlindScan[] | Error)[],
  interpreter: Interpreter = INTERPRETER,
): Agreement {
  const result: Agreement = {
    mismatches: [],
    parted: [],
    stopped: [],
    values: 0,
    scans: 0,
    ran: new Set(),
    constructs: new Set(),
  };
  const unit = parseScl(model.source);
  cases.forEach((c, ci) => {
    const theirs = blind[ci];
    if (theirs instanceof Error || theirs === undefined) {
      result.mismatches.push(`${c.name}: the blind interpreter can't run the listing: ${theirs?.message ?? "no run"}`);
      return;
    }
    let ours;
    try {
      ours = runCase(model, c.scans, interpreter, unit);
    } catch (error) {
      result.mismatches.push(`${c.name}: the engine can't run the listing: ${(error as Error).message}`);
      return;
    }
    for (const l of ours.ran) result.ran.add(l);
    for (const k of ours.constructs) result.constructs.add(k);
    for (const si of c.scans.keys()) {
      const where = `${c.name}, scan ${si + 1}`;
      const mine = ours.scans[si];
      const other = theirs[si];
      if (!mine || !other) {
        if (mine || other) result.mismatches.push(`${where}: only the ${mine ? "engine" : "blind interpreter"} ran it`);
        return;
      }
      result.scans += 1;
      if ("stopped" in other) {
        const { line, point, manual } = other.stopped;
        if (mine.error !== undefined) return; // Both stop: neither gives a value.
        result.stopped.push({
          at: `line ${line}`,
          where,
          detail: `the blind interpreter stops on line ${line} (${point}; ${manual}), where the engine goes on`,
        });
        return;
      }
      if (mine.error !== undefined) {
        result.mismatches.push(`${where}: the engine stops (${mine.error}), the blind interpreter goes on`);
        return;
      }
      const paths = new Set([...Object.keys(mine.values), ...Object.keys(other.values)]);
      for (const path of paths) {
        result.values += 1;
        const a = mine.values[path];
        const b = other.values[path];
        if (a && b && a.type === b.type && Object.is(a.value, b.value)) continue;
        result.parted.push({
          at: path,
          where,
          detail: `${path} is ${show(a)} in the engine, ${show(b)} in the blind interpreter`,
        });
      }
    }
  });
  return result;
}
