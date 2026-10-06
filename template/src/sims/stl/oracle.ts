// The STL build oracle's side of the engine: the listing as awlsim reads it, the request the build
// sends awlsim, the log it keeps in the Course's build records, and the bit-for-bit comparison of
// the engine with that log, statement by statement: ACCU 1, ACCU 2, AR 1, the status word and every
// byte written, then all of memory after each scan. Registers a library block left behind are the
// only values not compared. Pure: the gate and `oracle/cli.ts` read and write the files.

import { z } from "astro/zod";
import { AREAS, AREA_SIZES, STATUS_BITS, toPattern, WIDTH_BYTES, type Area } from "../s7/core.ts";
import { operandAddress, runCase, type GateCase, type Inputs, type StlModel, type TraceEntry } from "./engine.ts";
import type { Register } from "./instructions.ts";
import { parseStl, type Program } from "./parse.ts";

export const ORACLE_LOG = "learn-premium awlsim log v1";

/** A memory area after a scan, as its runs of non-zero bytes: [offset, hex] each. */
const spans = z.array(z.tuple([z.number().int().nonnegative(), z.string().regex(/^([0-9a-f]{2})+$/)]));

/** One OB 1 statement as awlsim ran it: [line, ACCU 1, ACCU 2, AR 1, status word, [area, offset, byte]…]. */
const step = z.tuple([
  z.number().int(),
  z.number().int(),
  z.number().int(),
  z.number().int(),
  z.number().int(),
  z.array(z.tuple([z.enum(AREAS), z.number().int(), z.number().int()])),
]);

/** What `oracle/cli.ts` leaves in the build records for one listing. */
export const oracleLog = z.strictObject({
  oracle: z.literal(ORACLE_LOG),
  /** The awlsim release that ran it. */
  awlsim: z.string().min(1),
  /** A hash of the request awlsim ran: the listing and every case. A listing changed since doesn't match it. */
  request: z.string().regex(/^[0-9a-f]{64}$/),
  cases: z.array(
    z.strictObject({
      name: z.string().min(1),
      /** The inputs before each scan, as the engine is given them. */
      inputs: z.array(z.record(z.string(), z.number())).min(1),
      scans: z.array(z.strictObject({ steps: z.array(step), memory: z.record(z.enum(AREAS), spans) })).min(1),
    }),
  ),
});
export type OracleLog = z.output<typeof oracleLog>;

/**
 * An input written before a scan: whole bytes at an offset, or one bit (bits share their byte, so a
 * bit is written alone, as the engine writes it).
 */
export type InputWrite =
  [area: "I" | "M", offset: number, bytes: number[]] | [area: "I" | "M", offset: number, bit: number, value: number];

/** What awlsim is sent: the listing in its form, the area sizes, and each scan's input writes, in order. */
export interface OracleRequest {
  awl: string;
  sizes: Record<Area, number>;
  cases: { name: string; scans: InputWrite[][] }[];
}

/** The library blocks a listing calls, by number, as FC105 is called: `CALL FC 105`. */
export function calledBlocks(program: Program): number[] {
  return [...new Set(program.statements.flatMap((s) => (s.operand.kind === "block" ? [s.operand.number] : [])))].sort(
    (a, b) => a - b,
  );
}

/** An absolute address written for awlsim: `MW20` → `MW 20`, `PIW256` → `PIW 256`. */
const spaced = (text: string) => text.replace(/^(PI|I|Q|M)(B|W|D)?(\d)/i, "$1$2 $3");

/**
 * The listing as awlsim's parser takes it, line for line, so awlsim's line numbers are the
 * listing's: a CALL's parameters go in brackets on the lines they sit on, and each called library
 * block's STL (`libraries`, by number) follows the listing.
 */
export function awlsimSource(source: string, libraries: Readonly<Record<number, string>>): string {
  const program = parseStl(source);
  const lines = program.lines.slice();
  for (const s of program.statements) {
    if (s.op !== "CALL" || !s.params) continue;
    const names = Object.keys(s.params);
    lines[s.line] = `${(lines[s.line] ?? "").replace(/\/\/.*$/, "").trimEnd()} (`;
    names.forEach((name, i) => {
      const last = i === names.length - 1;
      lines[s.line + 1 + i] = `\t\t${name} := ${spaced(s.params?.[name] ?? "")}${last ? " )" : ","}`;
    });
    if (names.length === 0) lines[s.line] = `${lines[s.line]} )`;
  }
  for (const s of program.statements) {
    if (s.operand.kind !== "address" && s.operand.kind !== "indirect") continue;
    const line = lines[s.line] ?? "";
    lines[s.line] = line.replace(s.text, s.operand.kind === "address" ? spaced(s.text) : s.text);
  }
  const blocks = calledBlocks(program).map((n) => {
    const awl = libraries[n];
    if (awl === undefined) throw new Error(`the oracle has no STL for FC${n}`);
    return awl;
  });
  return [lines.join("\n"), ...blocks].join("\n");
}

/** The request for a listing's cases. */
export function oracleRequest(
  model: StlModel,
  cases: readonly GateCase[],
  libraries: Readonly<Record<number, string>>,
): OracleRequest {
  return {
    awl: awlsimSource(model.source, libraries),
    sizes: { ...AREA_SIZES },
    cases: cases.map((c) => ({ name: c.name, scans: c.scans.map((inputs) => inputWrites(model, inputs)) })),
  };
}

/** A scan's inputs as the writes the engine makes, in the model's order. */
export function inputWrites(model: StlModel, inputs: Inputs): InputWrite[] {
  const writes: InputWrite[] = [];
  for (const [operand, type] of Object.entries(model.inputs)) {
    const value = inputs[operand];
    if (value === undefined) continue;
    const a = operandAddress(operand, type);
    if (a.area === "Q") throw new Error(`${operand}: an input is an I or M address, not an output`);
    if (a.width === "bit") {
      writes.push([a.area, a.byte, a.bit, value ? 1 : 0]);
      continue;
    }
    const pattern = toPattern(type, value);
    const count = WIDTH_BYTES[a.width];
    writes.push([
      a.area,
      a.byte,
      Array.from({ length: count }, (_, i) => Math.floor(pattern / 256 ** (count - 1 - i)) & 0xff),
    ]);
  }
  return writes;
}

// ---- the comparison ----------------------------------------------------------------------------

const h = (n: number) => `16#${(n >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;

/** The status bits a library block left behind, as a mask of the bits still compared. */
const statusMask = (leftBy: TraceEntry["leftBy"]) =>
  STATUS_BITS.reduce((mask, b, i) => (leftBy[b] ? mask & ~(1 << i) : mask), 0x1ff);

const spansOf = (bytes: Uint8Array): [number, string][] => {
  const found: [number, string][] = [];
  let start = -1;
  for (let i = 0; i <= bytes.length; i++) {
    const b = i < bytes.length ? (bytes[i] ?? 0) : 0;
    if (b && start < 0) start = i;
    else if (!b && start >= 0) {
      found.push([start, Array.from(bytes.subarray(start, i), (x) => x.toString(16).padStart(2, "0")).join("")]);
      start = -1;
    }
  }
  return found;
};

export interface Agreement {
  /** One line per disagreement, naming the case, scan, line and register. */
  mismatches: string[];
  /** Values compared (a register after a statement, a byte written, an area after a scan). */
  values: number;
  /** Statements compared. */
  statements: number;
  /** Register values not compared because a library block left them behind. */
  leftBehind: number;
  /** Each statement index some case ran. */
  ran: Set<number>;
}

/**
 * Replays every case on the engine and compares it with awlsim's log of the same cases, bit for bit.
 * The cases are the listing's own (a log keeps its inputs only to be read: JSON loses a REAL's −0).
 * `run` runs a case: the engine, or a negative control's broken one.
 */
export function compareWithOracle(
  model: StlModel,
  cases: readonly GateCase[],
  log: OracleLog,
  run: (scans: readonly Inputs[]) => ReturnType<typeof runCase> = (scans) => runCase(model, scans),
): Agreement {
  const result: Agreement = { mismatches: [], values: 0, statements: 0, leftBehind: 0, ran: new Set() };
  const miss = (m: string) => result.mismatches.push(m);
  if (cases.length !== log.cases.length || cases.some((c, i) => c.name !== log.cases[i]?.name))
    miss(`the log ran other cases than the listing has: run \`npm run oracle -- write\``);
  for (const [i, c] of log.cases.entries()) {
    const scans = cases[i]?.scans;
    if (!scans || scans.length !== c.scans.length) continue;
    let ours;
    try {
      ours = run(scans);
    } catch (error) {
      miss(`${c.name}: the engine stops: ${(error as Error).message}`);
      continue;
    }
    c.scans.forEach((theirs, si) => {
      const where = `${c.name}, scan ${si + 1}`;
      const mine = ours[si];
      if (!mine) {
        miss(`${where}: the engine ran no such scan`);
        return;
      }
      if (mine.trace.length !== theirs.steps.length)
        miss(`${where}: the engine ran ${mine.trace.length} statements, awlsim ${theirs.steps.length}`);
      for (let k = 0; k < Math.min(mine.trace.length, theirs.steps.length); k++) {
        const t = mine.trace[k] as TraceEntry;
        const [line, a1, a2, ar1, stw, writes] = theirs.steps[
          k
        ] as OracleLog["cases"][number]["scans"][number]["steps"][number];
        result.ran.add(t.statement);
        result.statements += 1;
        const implicit = t.op === "BE" && t.text === "" && line === -1;
        if (!implicit && (line - 1 < t.line || line - 1 > t.lastLine)) {
          miss(`${where}: statement ${k + 1} is line ${t.line + 1} (${t.op}), but awlsim ran line ${line}`);
          return;
        }
        const at = `${where}, after line ${t.line + 1} (${[t.op, t.text].filter(Boolean).join(" ")})`;
        const ourWrites = t.writes.map((w) => `${w.area}${w.offset}=${w.value}`).sort();
        const theirWrites = writes.map(([area, offset, value]) => `${area}${offset}=${value}`).sort();
        result.values += Math.max(ourWrites.length, theirWrites.length);
        if (ourWrites.join() !== theirWrites.join())
          miss(
            `${at}: the engine wrote ${ourWrites.join(" ") || "nothing"}, awlsim ${theirWrites.join(" ") || "nothing"}`,
          );
        // awlsim reports a CALL before its block runs: its registers show on the statements after.
        if (t.op === "CALL") continue;
        const registers: [string, number, number, Register | undefined, number][] = [
          ["ACCU 1", t.accu1, a1, "ACCU1", 0xffffffff],
          ["ACCU 2", t.accu2, a2, "ACCU2", 0xffffffff],
          ["AR 1", t.ar1, ar1, "AR1", 0xffffffff],
          ["the status word", t.status, stw, undefined, statusMask(t.leftBy)],
        ];
        for (const [name, x, y, register, mask] of registers) {
          if (register && t.leftBy[register]) {
            result.leftBehind += 1;
            continue;
          }
          result.values += 1;
          if ((x & mask) >>> 0 !== (y & mask) >>> 0) miss(`${at}: ${name} is ${h(x & mask)}, awlsim ${h(y & mask)}`);
        }
      }
      for (const area of AREAS) {
        result.values += 1;
        const a = JSON.stringify(spansOf(mine.memory[area]));
        const b = JSON.stringify(theirs.memory[area] ?? []);
        if (a !== b) miss(`${where}: ${area} after the scan differs from awlsim's (${a} vs ${b})`);
      }
    });
  }
  return result;
}
