// What the STL sim's page shows, worked out apart from the island so it can be tested: the trace
// entry's registers as the student reads them, the status word bit by bit, the watch table, and the
// step-through a listing with an unsupported instruction plays instead (awlsim's own trace).

import {
  bitsToReal,
  formatAddress,
  formatReal,
  formatRegister,
  formatValue,
  int16,
  LIBRARY,
  parseAddress,
  S7Memory,
  STATUS_BITS,
  type Address,
  type ByteWrite,
  type StatusBit,
} from "../s7/core.ts";
import { applyInputs, operandAddress, type Inputs, type StlModel, type TraceEntry } from "./engine.ts";
import type { OracleLog } from "./oracle.ts";
import { decodeOperand, parseStl } from "./parse.ts";

/** A status bit as the trace shows it: its value, or `?` where a library block left it undefined. */
export interface ShownBit {
  bit: StatusBit;
  value: 0 | 1 | "?";
  /** The block that left it undefined. */
  leftBy?: string;
}

export function statusBits(entry: Pick<TraceEntry, "status" | "leftBy">): ShownBit[] {
  return STATUS_BITS.map((bit, i) => {
    const leftBy = entry.leftBy[bit];
    return leftBy ? { bit, value: "?", leftBy } : { bit, value: ((entry.status >> i) & 1) as 0 | 1 };
  });
}

const REAL_OPS = /^(\+R|-R|\*R|\/R|ABS|NEGR|SQRT?|EXP|LN|A?SIN|A?COS|A?TAN|DTR|[=<>]{1,2}R)$/;

/** How to read an accumulator after a statement: as a REAL when the statement works in REALs, else as an integer. */
export interface Reading {
  hex: string;
  /** The value as the statement's type has it: `57.3`, `-5`, `L#70000`. */
  value: string;
  type: "REAL" | "INT" | "DINT";
}

/** Statements whose result fills all 32 bits of ACCU 1 as an integer. */
const DINT_OPS =
  /^(\+D|-D|\*D|\/D|MOD|NEGD|INVD|ITD|\*I|RND[+-]?|TRUNC|TAR1|SLD|SRD|SSD|RLD|RRD|RLDA|RRDA|AD|OD|XOD|CAD)$/;
/** Statements that leave both accumulators as they were. */
const KEEPS_ACCUMULATORS =
  /^(A|AN|O|ON|X|XN|[AOX]N?\(|\)|NOT|SET|CLR|SAVE|=|S|R|FP|FN|T|J[A-Z]*|BE[UC]?|NOP|LAR1|\+AR1|[=<>]{1,2}[IDR])$/;

export type AccumulatorType = Reading["type"];

/** A REAL constant as STEP 7 writes one. */
const REAL_LITERAL = /^[+-]?(\d+\.\d*|\.\d+|\d+e[+-]?\d+)(e[+-]?\d+)?$/i;

/** The memory a load or transfer names: its address (an indirect one resolved through AR 1), or none. */
function addressOf(op: string, text: string, ar1: number): Address | undefined {
  const o = decodeOperand(op, text);
  if (o.kind === "address") return o.address;
  if (o.kind === "indirect") {
    const bits = (ar1 & 0x7ffff) + o.offset;
    return { area: o.area, width: o.width, byte: bits >> 3, bit: bits & 7 };
  }
  return undefined;
}

/** What a load puts in ACCU 1: a constant's type, the model's type for its operand, or the type last transferred there. */
function loadType(
  text: string,
  a: Address | undefined,
  model: StlModel,
  stored: Map<string, AccumulatorType>,
): AccumulatorType {
  const literal = text.trim();
  if (REAL_LITERAL.test(literal)) return "REAL";
  if (/^(L#|DW#|P#)/i.test(literal)) return "DINT";
  if (!a) return "INT";
  const declared = declaredType(a, model);
  if (declared === "REAL") return "REAL";
  if (declared === "DINT" || declared === "DWORD") return "DINT";
  if (declared) return "INT";
  return stored.get(formatAddress(a)) ?? (a.width === "dword" ? "DINT" : "INT");
}

/**
 * What each accumulator holds after each statement of a scan, as a type: set by the statement that
 * last wrote it (a load carries ACCU 1's type into ACCU 2), so a REAL reads as a REAL after the
 * logic and jumps that follow it. A load reads the model's type for its operand, or else the type
 * last transferred to that address (an indirect address resolved through AR 1).
 */
export function accumulatorTypes(
  trace: readonly (Pick<TraceEntry, "op" | "text" | "ar1"> & Partial<Pick<TraceEntry, "line">>)[],
  model: StlModel,
  /** The types transferred to memory in scans before this one (memory outlasts a scan); updated here. */
  stored = new Map<string, AccumulatorType>(),
): { accu1: AccumulatorType; accu2: AccumulatorType }[] {
  let accu1: AccumulatorType = "INT";
  let accu2: AccumulatorType = "INT";
  const calls = callOutputs(model);
  return trace.map(({ op, text, ar1, line }) => {
    const a = op === "L" || op === "T" ? addressOf(op, text, ar1) : undefined;
    // A library block's outputs are typed by the block: FC105's OUT is a REAL wherever it lands.
    if (op === "CALL" && line !== undefined) for (const [at, type] of calls.get(line) ?? []) stored.set(at, type);
    if (op === "L") [accu2, accu1] = [accu1, loadType(text, a, model, stored)];
    else if (op === "T") {
      if (a && a.width !== "bit") stored.set(formatAddress(a), accu1);
    } else if (op === "PUSH") accu2 = accu1;
    else if (op === "TAR1" && !text) [accu2, accu1] = [accu1, "DINT"];
    else if (op === "TAK") [accu1, accu2] = [accu2, accu1];
    else if (op === "POP") accu1 = accu2;
    else if (!KEEPS_ACCUMULATORS.test(op) && op !== "TAR1")
      accu1 = REAL_OPS.test(op)
        ? "REAL"
        : DINT_OPS.test(op) || (op === "+" && /^L#/i.test(text.trim()))
          ? "DINT"
          : "INT";
    return { accu1, accu2 };
  });
}

export function readAccumulator(value: number, type: AccumulatorType): Reading {
  const hex = formatRegister(value);
  if (type === "REAL") return { hex, value: formatReal(bitsToReal(value)), type };
  if (type === "DINT") return { hex, value: `L#${value | 0}`, type };
  return { hex, value: String(int16(value)), type };
}

/** The type the model declares for an address, if its inputs or watch table name it. */
function declaredType(a: Address, model: StlModel) {
  const key = formatAddress(a);
  for (const table of [model.inputs, model.watch])
    for (const [name, type] of Object.entries(table)) {
      const named = parseAddress(name);
      if (named && formatAddress(named) === key) return type;
    }
  return undefined;
}

/** Each CALL's output addresses with the types its library block writes there, by the CALL's line. */
function callOutputs(model: StlModel): Map<number, [string, AccumulatorType][]> {
  const found = new Map<number, [string, AccumulatorType][]>();
  let program;
  try {
    program = parseStl(model.source);
  } catch {
    return found;
  }
  for (const s of program.statements) {
    if (s.operand.kind !== "block") continue;
    const block = LIBRARY[s.operand.number];
    if (!block) continue;
    const outputs: [string, AccumulatorType][] = [];
    for (const [name, type] of Object.entries(block.outputs)) {
      const a = parseAddress(s.params?.[name] ?? "");
      if (a && a.width !== "bit")
        outputs.push([formatAddress(a), type === "REAL" ? "REAL" : type === "DINT" ? "DINT" : "INT"]);
    }
    found.set(s.line, outputs);
  }
  return found;
}

/** The types memory holds once a scan has run, from those it held before (cleared only by a cold start). */
export function typesAfter(
  trace: readonly (Pick<TraceEntry, "op" | "text" | "ar1"> & Partial<Pick<TraceEntry, "line">>)[],
  model: StlModel,
  before: ReadonlyMap<string, AccumulatorType>,
): Map<string, AccumulatorType> {
  const stored = new Map(before);
  accumulatorTypes(trace, model, stored);
  return stored;
}

/** AR 1 as the pointer it holds: `P#60.0`. */
export const pointer = (ar1: number) => `P#${(ar1 & 0x7ffff) >> 3}.${ar1 & 7}`;

/** One watch-table row: its operand, its value as its type prints, and whether the last statement wrote it. */
export interface WatchRow {
  operand: string;
  value: string;
  written: boolean;
}

export function watchRows(mem: S7Memory, model: StlModel, writes: readonly ByteWrite[] = []): WatchRow[] {
  return Object.entries(model.watch).map(([operand, type]) => {
    const a = operandAddress(operand, type);
    const bytes = a.width === "bit" ? 1 : a.width === "byte" ? 1 : a.width === "word" ? 2 : 4;
    const written = writes.some((w) => w.area === a.area && w.offset >= a.byte && w.offset < a.byte + bytes);
    return { operand, value: formatValue(type, mem.read(a)), written };
  });
}

/** The bytes a statement wrote, as a line: `MB 24..27 = 3F 80 00 00`. */
export function describeWrites(writes: readonly ByteWrite[]): string[] {
  const sorted = [...writes].sort((a, b) => a.area.localeCompare(b.area) || a.offset - b.offset);
  const runs: ByteWrite[][] = [];
  for (const w of sorted) {
    const run = runs.at(-1);
    const last = run?.at(-1);
    if (run && last && last.area === w.area && last.offset + 1 === w.offset) run.push(w);
    else runs.push([w]);
  }
  return runs.map((run) => {
    const first = run[0] as ByteWrite;
    const end = first.offset + run.length - 1;
    const where = run.length === 1 ? `${first.area}B ${first.offset}` : `${first.area}B ${first.offset}..${end}`;
    return `${where} = ${run.map((w) => w.value.toString(16).toUpperCase().padStart(2, "0")).join(" ")}`;
  });
}

/** One scan of a step-through: awlsim's trace of it, and memory before it began. */
export interface ReplayScan {
  trace: TraceEntry[];
  /** Every area's bytes before the scan's first statement, as [area, offset, byte] for the non-zero ones. */
  before: [string, number, number][];
}

/**
 * A listing the interpreter can't run, as awlsim ran it on the example's values: one entry a
 * statement, from its oracle log. Registers a library block left are awlsim's own values here, never
 * the engine's, so none is marked.
 */
export function replayOf(model: StlModel, log: OracleLog, start: Inputs): ReplayScan[] {
  const program = parseStl(model.source);
  const [example] = log.cases;
  if (!example) return [];
  const statementAt = (line: number) =>
    line === -1
      ? program.statements.at(-1)
      : program.statements.find((s) => line - 1 >= s.line && line - 1 <= s.lastLine);
  const mem = new S7Memory();
  return example.scans.map((scan, si) => {
    // The example's first scan is `start` itself: the log's JSON keeps no REAL's −0.
    applyInputs(mem, model, si === 0 ? start : (example.inputs[si] ?? start));
    const before = (["I", "Q", "M"] as const).flatMap((area) =>
      Array.from(mem.areas[area].entries())
        .filter(([, b]) => b !== 0)
        .map(([offset, b]): [string, number, number] => [area, offset, b]),
    );
    const trace = scan.steps.map(([line, accu1, accu2, ar1, status, writes]): TraceEntry => {
      const s = statementAt(line);
      for (const [area, offset, value] of writes) mem.areas[area][offset] = value;
      return {
        statement: s?.index ?? -1,
        line: s?.line ?? 0,
        lastLine: s?.lastLine ?? 0,
        op: s?.op ?? "",
        text: s?.text ?? "",
        accu1,
        accu2,
        ar1,
        status,
        leftBy: {},
        writes: writes.map(([area, offset, value]) => ({ area, offset, value })),
      };
    });
    return { trace, before };
  });
}
