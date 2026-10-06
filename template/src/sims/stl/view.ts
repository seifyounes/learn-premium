// What the STL sim's page shows, worked out apart from the island so it can be tested: the trace
// entry's registers as the student reads them, the status word bit by bit, the watch table, and the
// step-through a listing with an unsupported instruction plays instead (awlsim's own trace).

import {
  bitsToReal,
  formatReal,
  formatRegister,
  formatValue,
  int16,
  S7Memory,
  STATUS_BITS,
  type ByteWrite,
  type StatusBit,
} from "../s7/core.ts";
import { applyInputs, operandAddress, type Inputs, type StlModel, type TraceEntry } from "./engine.ts";
import type { OracleLog } from "./oracle.ts";
import { parseStl } from "./parse.ts";

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

const DINT_OPS = /^(\+D|-D|\*D|\/D|MOD|NEGD|INVD|ITD|\*I|RND[+-]?|TRUNC|TAR1)$/;
/** Statements that leave both accumulators as they were. */
const KEEPS_ACCUMULATORS =
  /^(A|AN|O|ON|X|XN|[AOX]N?\(|\)|NOT|SET|CLR|SAVE|=|S|R|FP|FN|T|J[A-Z]*|BE[UC]?|NOP|LAR1|\+AR1|[=<>]{1,2}[IDR])$/;

export type AccumulatorType = Reading["type"];

/** The type a statement's result in ACCU 1 has. */
function resultType(op: string, text: string, model: StlModel): AccumulatorType {
  const loads = op === "L" ? declaredType(text, model) : undefined;
  const literal = op === "L" ? text.trim() : "";
  if (REAL_OPS.test(op) || loads === "REAL" || /^[+-]?(\d+\.\d*|\.\d+|\d+e[+-]?\d+)(e[+-]?\d+)?$/i.test(literal))
    return "REAL";
  if (DINT_OPS.test(op) || loads === "DINT" || loads === "DWORD" || /^(L#|DW#|P#)/i.test(literal)) return "DINT";
  return "INT";
}

/**
 * What each accumulator holds after each statement of a scan, as a type: set by the statement that
 * last wrote it (a load carries ACCU 1's type into ACCU 2), so a REAL reads as a REAL after the
 * logic and jumps that follow it.
 */
export function accumulatorTypes(
  trace: readonly Pick<TraceEntry, "op" | "text">[],
  model: StlModel,
): { accu1: AccumulatorType; accu2: AccumulatorType }[] {
  let accu1: AccumulatorType = "INT";
  let accu2: AccumulatorType = "INT";
  return trace.map(({ op, text }) => {
    if (op === "L" || op === "PUSH" || (op === "TAR1" && !text)) [accu2, accu1] = [accu1, resultType(op, text, model)];
    else if (op === "TAK") [accu1, accu2] = [accu2, accu1];
    else if (op === "POP") accu1 = accu2;
    else if (!KEEPS_ACCUMULATORS.test(op) && op !== "TAR1") accu1 = resultType(op, text, model);
    if (op === "PUSH") accu1 = accu2;
    return { accu1, accu2 };
  });
}

export function readAccumulator(value: number, type: AccumulatorType): Reading {
  const hex = formatRegister(value);
  if (type === "REAL") return { hex, value: formatReal(bitsToReal(value)), type };
  if (type === "DINT") return { hex, value: `L#${value | 0}`, type };
  return { hex, value: String(int16(value)), type };
}

/** The type the model declares for an operand, if it names one. */
function declaredType(operand: string, model: StlModel) {
  const key = operand.replace(/\s+/g, " ").trim().toUpperCase();
  for (const table of [model.inputs, model.watch])
    for (const [name, type] of Object.entries(table)) if (name.replace(/\s+/g, " ").toUpperCase() === key) return type;
  return undefined;
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
    applyInputs(mem, model, example.inputs[si] ?? start);
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
