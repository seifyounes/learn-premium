// The ladder build oracle's side of the engine: the request awlsim runs (the model compiled to STL,
// each case's scans with their times and input bits), the log it keeps in the Course's build records,
// and the bit-for-bit comparison of the engine with that log after every scan: all of I, Q and M,
// every S5 timer's Q, running state and time left, every counter's count, and each TON's instance
// data. Pure: the gate and `oracle/cli.ts` read and write the files.

import { z } from "astro/zod";
import { AREAS, AREA_SIZES, type Area } from "../s7/core.ts";
import { compileLadder } from "./compile.ts";
import { runCase, SEMANTICS, type GateCase, type ScanResult, type Semantics } from "./engine.ts";
import { parseOperand, type LadderModel } from "./model.ts";

export const LADDER_LOG = "learn-premium awlsim ladder log v1";

const spans = z.array(z.tuple([z.number().int().nonnegative(), z.string().regex(/^([0-9a-f]{2})+$/)]));
const bit = z.union([z.literal(0), z.literal(1)]);

const scan = z.strictObject({
  at: z.number().int().nonnegative(),
  memory: z.record(z.enum(AREAS), spans),
  /** [n, Q, running, seconds left]. */
  timers: z.array(z.tuple([z.number().int(), bit, z.boolean(), z.number()])),
  /** [n, count]. */
  counters: z.array(z.tuple([z.number().int(), z.number().int()])),
  /** [db, IN, PT, Q, ET, STATE, STIME, ATIME]. */
  tons: z.array(z.array(z.number().int()).length(8)),
});

/** What `oracle/cli.ts` leaves in the build records for one ladder or FBD sim. */
export const ladderLog = z.strictObject({
  oracle: z.literal(LADDER_LOG),
  awlsim: z.string().min(1),
  /** A hash of the request awlsim ran: the compiled networks and every case. */
  request: z.string().regex(/^[0-9a-f]{64}$/),
  cases: z.array(z.strictObject({ name: z.string().min(1), scans: z.array(scan).min(1) })),
});
export type LadderLog = z.output<typeof ladderLog>;
export type LoggedScan = z.output<typeof scan>;

export interface LadderRequest {
  awl: string;
  sizes: Record<Area, number>;
  probe: { timers: number[]; counters: number[]; tons: number[] };
  cases: { name: string; scans: { at: number; writes: [area: "I", offset: number, bit: number, value: number][] }[] }[];
}

/** The timers, counters and TON instances a model uses, by number. */
export function probeOf(model: LadderModel): LadderRequest["probe"] {
  const numbers = (kind: "timer" | "counter" | "db") =>
    [
      ...new Set(
        model.parts.flatMap((p) => {
          const o = p.operand === undefined ? undefined : parseOperand(p.operand);
          if (o?.kind === kind) return [o.number];
          // A contact reading a timer or counter no coil or box of the model runs still reads it.
          return [];
        }),
      ),
    ].sort((a, b) => a - b);
  return { timers: numbers("timer"), counters: numbers("counter"), tons: numbers("db") };
}

/** The request for a model's cases. */
export function ladderRequest(model: LadderModel, cases: readonly GateCase[]): LadderRequest {
  return {
    awl: compileLadder(model),
    sizes: { ...AREA_SIZES },
    probe: probeOf(model),
    cases: cases.map((c) => ({
      name: c.name,
      scans: c.scans.map(({ ms, inputs }) => ({
        at: ms,
        writes: model.inputs.flatMap((operand) => {
          const o = parseOperand(operand);
          const value = inputs[operand];
          if (o?.kind !== "bit" || value === undefined) return [];
          return [["I", o.address.byte, o.address.bit, value ? 1 : 0] as ["I", number, number, number]];
        }),
      })),
    })),
  };
}

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

/** An area's bytes as its runs of non-zero bytes, as the log keeps them. */
export function spansOf(bytes: Uint8Array): [number, string][] {
  const found: [number, string][] = [];
  let start: number | undefined;
  for (let i = 0; i <= bytes.length; i++) {
    const b = bytes[i] ?? 0;
    if (b && start === undefined) start = i;
    else if (!b && start !== undefined) {
      found.push([start, hex(bytes.slice(start, i))]);
      start = undefined;
    }
  }
  return found;
}

/** The engine's scan in the log's form, to compare field for field. */
export function asLogged(model: LadderModel, result: ScanResult): LoggedScan {
  const probe = probeOf(model);
  return {
    at: result.ms,
    memory: { I: spansOf(result.memory.I), Q: spansOf(result.memory.Q), M: spansOf(result.memory.M) },
    timers: probe.timers.map((n) => {
      const t = result.state.timers[n];
      return [n, t?.status ?? 0, t?.running ?? false, t?.remaining ?? 0];
    }),
    counters: probe.counters.map((n) => [n, result.state.counters[n] ?? 0]),
    tons: probe.tons.map((n) => {
      const t = result.state.tons[n];
      return [n, t?.IN ?? 0, t?.PT ?? 0, t?.Q ?? 0, t?.ET ?? 0, t?.STATE ?? 0, t?.STIME ?? 0, t?.ATIME ?? 0];
    }),
  };
}

/** Where the engine and the log part on one scan, said plainly; empty when they agree. */
function scanDifferences(engine: LoggedScan, oracle: LoggedScan): string[] {
  const out: string[] = [];
  for (const area of AREAS) {
    const [e, o] = [JSON.stringify(engine.memory[area]), JSON.stringify(oracle.memory[area] ?? [])];
    if (e !== o) out.push(`${area} is ${e} in the engine, ${o} in awlsim`);
  }
  const named = <T extends unknown[]>(rows: T[], label: (row: T) => string) =>
    new Map(rows.map((row) => [label(row), JSON.stringify(row)]));
  const groups: [string, unknown[][], unknown[][], string[]][] = [
    ["T", engine.timers, oracle.timers, ["Q", "running", "seconds left"]],
    ["C", engine.counters, oracle.counters, ["count"]],
    ["DB", engine.tons, oracle.tons, ["IN", "PT", "Q", "ET", "STATE", "STIME", "ATIME"]],
  ];
  for (const [prefix, mine, theirs, fields] of groups) {
    const theirsByName = named(theirs, (row) => String(row[0]));
    for (const row of mine) {
      const other = theirs.find((r) => r[0] === row[0]);
      if (!other) {
        out.push(`awlsim's log has no ${prefix} ${String(row[0])}`);
        continue;
      }
      fields.forEach((field, i) => {
        if (row[i + 1] !== other[i + 1])
          out.push(
            `${prefix} ${String(row[0])}'s ${field} is ${String(row[i + 1])} in the engine, ${String(other[i + 1])} in awlsim`,
          );
      });
      theirsByName.delete(String(row[0]));
    }
  }
  return out;
}

export interface Agreement {
  /** Scans compared. */
  scans: number;
  /** Values compared: bytes, timer, counter and TON fields. */
  values: number;
  mismatches: string[];
  /** Each case's scans as the engine ran them, for the coverage checks. */
  runs: ScanResult[][];
}

/** A log that doesn't fit the cases it should hold, or undefined. */
export function logShapeProblem(cases: readonly GateCase[], log: LadderLog): string | undefined {
  if (log.cases.length !== cases.length)
    return `the oracle log has ${log.cases.length} cases, the sim ${cases.length}: run \`npm run oracle -- write\` again`;
  for (const [i, c] of cases.entries()) {
    const logged = log.cases[i];
    if (!logged || logged.scans.length !== c.scans.length)
      return `the oracle log's case "${c.name}" has ${logged?.scans.length ?? 0} scans, the sim ${c.scans.length}`;
  }
  return undefined;
}

/** The engine against awlsim's log, case by case, scan by scan. */
export function compareWithOracle(
  model: LadderModel,
  cases: readonly GateCase[],
  log: LadderLog,
  semantics: Semantics = SEMANTICS,
): Agreement {
  const agreement: Agreement = { scans: 0, values: 0, mismatches: [], runs: [] };
  const shape = logShapeProblem(cases, log);
  if (shape) {
    agreement.mismatches.push(shape);
    return agreement;
  }
  for (const [i, c] of cases.entries()) {
    let results: ScanResult[];
    try {
      results = runCase(model, c, semantics);
    } catch (error) {
      agreement.mismatches.push(`case "${c.name}": the engine stops: ${(error as Error).message}`);
      agreement.runs.push([]);
      continue;
    }
    agreement.runs.push(results);
    const logged = log.cases[i]?.scans ?? [];
    for (const [j, result] of results.entries()) {
      const oracle = logged[j];
      if (!oracle) continue;
      const mine = asLogged(model, result);
      agreement.scans += 1;
      agreement.values +=
        AREAS.reduce((n, a) => n + AREA_SIZES[a], 0) +
        mine.timers.length * 3 +
        mine.counters.length +
        mine.tons.length * 7;
      if (oracle.at !== mine.at) {
        agreement.mismatches.push(
          `case "${c.name}", scan ${j + 1}: awlsim ran it at ${oracle.at} ms, the engine at ${mine.at} ms`,
        );
        continue;
      }
      for (const d of scanDifferences(mine, oracle))
        agreement.mismatches.push(`case "${c.name}", the scan at ${mine.at} ms: ${d}`);
    }
  }
  return agreement;
}
