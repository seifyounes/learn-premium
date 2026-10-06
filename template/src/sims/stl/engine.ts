// The STL sim's engine: a Professor's listing run on the S7 core, a statement or a scan at a time,
// with a trace entry for every statement (the accumulators, AR 1, the status word and every byte it
// wrote). A pure function of the listing and the inputs, the same code in Node for the build gate
// and in the page for the student. Students set the inputs; they never edit the listing.

import {
  AREA_SIZES,
  fits,
  formatAddress,
  fromPattern,
  parseAddress,
  S7Memory,
  statusValue,
  toPattern,
  WIDTH_OF,
  type Address,
  type Area,
  type ByteWrite,
  type S7Type,
} from "../s7/core.ts";
import {
  createCpu,
  execute,
  INSTRUCTIONS,
  startScan,
  unsupported,
  type Cpu,
  type InstructionTable,
  type Register,
} from "./instructions.ts";
import { parseStl, type Program, type Statement } from "./parse.ts";

/** What an STL sim's model holds: the listing, the operands students set, and the watch table. */
export interface StlModel {
  /** The listing in STEP 7 source form: one ORGANIZATION_BLOCK OB 1. */
  source: string;
  /** Each operand a student (or a gate case) sets before a scan, with its type: `"PIW 256": "INT"`. */
  inputs: Readonly<Record<string, S7Type>>;
  /** The watch table: each operand shown after a scan, with its type. */
  watch: Readonly<Record<string, S7Type>>;
}

/** Input values by operand, as a student or a gate case sets them. */
export type Inputs = Readonly<Record<string, number>>;

/** One statement as it ran: where it is, the registers after it, and what it wrote. */
export interface TraceEntry {
  statement: number;
  line: number;
  lastLine: number;
  op: string;
  text: string;
  accu1: number;
  accu2: number;
  ar1: number;
  /** The status word as STEP 7 reads it (/FC is bit 0). */
  status: number;
  /** Registers a library block left that no statement has written since, by the block that left them. */
  leftBy: Partial<Record<Register, string>>;
  writes: ByteWrite[];
  jumpedTo?: number;
  call?: { block: string; inputs: Record<string, number>; outputs: Record<string, number> };
}

/** An operand of the model, as an address the inputs and the watch table can use. */
export function operandAddress(operand: string, type: S7Type): Address {
  const a = parseAddress(operand);
  if (!a) throw new Error(`"${operand}" isn't an absolute address like I 0.1, MW 20 or PIW 256`);
  if (a.width !== WIDTH_OF[type]) throw new Error(`${operand} is a ${a.width}, so it can't hold a ${type}`);
  return a;
}

/** Writes the inputs into memory before a scan, as the operating system copies the inputs in. */
export function applyInputs(mem: S7Memory, model: StlModel, inputs: Inputs): ByteWrite[] {
  const writes: ByteWrite[] = [];
  for (const [operand, type] of Object.entries(model.inputs)) {
    const value = inputs[operand];
    if (value === undefined) continue;
    if (!fits(type, value)) throw new Error(`${operand} can't hold ${value}: it is a ${type}`);
    writes.push(...mem.write(operandAddress(operand, type), toPattern(type, value)));
  }
  return writes;
}

/** The watch table's values after a scan, by operand. */
export function watchValues(mem: S7Memory, model: StlModel): Record<string, number> {
  return Object.fromEntries(
    Object.entries(model.watch).map(([operand, type]) => [
      operand,
      fromPattern(type, mem.read(operandAddress(operand, type))),
    ]),
  );
}

/** The statements the interpreter can't run, each with why: a listing with any ships as a step-through. */
export function unsupportedStatements(program: Program): { statement: Statement; why: string }[] {
  return program.statements.flatMap((statement) => {
    const why = unsupported(statement);
    return why ? [{ statement, why }] : [];
  });
}

const entryOf = (cpu: Cpu, statement: Statement, effect: ReturnType<typeof execute>["effect"]): TraceEntry => ({
  statement: statement.index,
  line: statement.line,
  lastLine: statement.lastLine,
  op: statement.op,
  text: statement.text,
  accu1: cpu.accu1,
  accu2: cpu.accu2,
  ar1: cpu.ar1,
  status: statusValue(cpu.status),
  leftBy: { ...cpu.leftBy },
  writes: effect.writes,
  ...(effect.jumpedTo === undefined ? {} : { jumpedTo: effect.jumpedTo }),
  ...(effect.call ? { call: effect.call } : {}),
});

/**
 * How the interpreter runs: its instruction table and what OB 1's start does. Only a negative
 * control (`mutants.ts`) changes either, to prove the gate sees the defect it plants.
 */
export interface Interpreter {
  instructions: InstructionTable;
  startScan: (cpu: Cpu) => void;
}
export const INTERPRETER: Interpreter = { instructions: INSTRUCTIONS, startScan };

/** A listing running scan after scan: memory persists, the registers start cleared each scan. */
export class StlRun {
  readonly model: StlModel;
  readonly program: Program;
  readonly cpu: Cpu;
  readonly interpreter: Interpreter;
  /** Scans begun so far. */
  scans = 0;
  /** Statements run in the current scan. */
  steps = 0;
  /** A scan stops here: a listing that loops longer than this never ends its scan. */
  static readonly STEP_LIMIT = 100_000;

  constructor(model: StlModel, program: Program = parseStl(model.source), interpreter: Interpreter = INTERPRETER) {
    this.model = model;
    this.program = program;
    this.interpreter = interpreter;
    this.cpu = createCpu();
    this.cpu.ended = true;
  }

  /** Whether the current scan has reached OB 1's block end (or none has begun). */
  get between(): boolean {
    return this.cpu.ended;
  }

  /** Begins a scan: the inputs are copied in and OB 1 is called. */
  begin(inputs: Inputs): void {
    applyInputs(this.cpu.mem, this.model, inputs);
    this.interpreter.startScan(this.cpu);
    this.scans += 1;
    this.steps = 0;
  }

  /** Runs one statement of the current scan. */
  step(): TraceEntry {
    if (this.cpu.ended) throw new Error("no scan is running: begin one first");
    if (++this.steps > StlRun.STEP_LIMIT)
      throw new Error(`the scan ran ${StlRun.STEP_LIMIT} statements without ending`);
    const { statement, effect } = execute(this.cpu, this.program, this.interpreter.instructions);
    return entryOf(this.cpu, statement, effect);
  }

  /** Runs a whole scan with these inputs; returns its trace. */
  scan(inputs: Inputs): TraceEntry[] {
    this.begin(inputs);
    const trace: TraceEntry[] = [];
    while (!this.cpu.ended) trace.push(this.step());
    return trace;
  }

  watch(): Record<string, number> {
    return watchValues(this.cpu.mem, this.model);
  }
}

/** Every value the engine gives for a model at these inputs: the watch table after one scan from cleared memory. */
export function quantities(model: StlModel, inputs: Inputs): Record<string, number> {
  const run = new StlRun(model);
  run.scan(inputs);
  return run.watch();
}

/** A gate case: the inputs before each scan, from a cleared CPU. */
export interface GateCase {
  name: string;
  scans: Inputs[];
}

/** A range a student tunes an input over. */
export interface TuneRange {
  min: number;
  max: number;
  step: number;
}

/**
 * The cases the build runs through the engine and the oracle: the example's values, each tuned
 * input alone at its slider's min, mid and max, and the cases the builder wrote (each scan's inputs
 * on top of the example's, carried to the next scan).
 */
export function gateCases(
  start: Inputs,
  tune: Readonly<Record<string, TuneRange>>,
  written: readonly { name: string; scans: readonly Inputs[] }[] = [],
): GateCase[] {
  const cases: GateCase[] = [{ name: "the example's values", scans: [start] }];
  for (const [operand, range] of Object.entries(tune)) {
    const mid = range.min + Math.round((range.max - range.min) / 2 / range.step) * range.step;
    for (const [end, value] of [
      ["min", range.min],
      ["mid", mid],
      ["max", range.max],
    ] as const) {
      cases.push({ name: `${operand} = ${value} (its slider's ${end})`, scans: [{ ...start, [operand]: value }] });
    }
  }
  for (const c of written) {
    let held: Inputs = start;
    cases.push({ name: c.name, scans: c.scans.map((scan) => (held = { ...held, ...scan })) });
  }
  return cases;
}

/** One scan of a case as the engine ran it: every statement, and memory after. */
export interface ScanResult {
  trace: TraceEntry[];
  memory: Record<Area, Uint8Array>;
}

/** Runs a case on a fresh CPU. Throws where the engine can't go on (an error names the line). */
export function runCase(
  model: StlModel,
  scans: readonly Inputs[],
  program?: Program,
  interpreter: Interpreter = INTERPRETER,
): ScanResult[] {
  const run = new StlRun(model, program, interpreter);
  return scans.map((inputs) => {
    const trace = run.scan(inputs);
    const m = run.cpu.mem.areas;
    return { trace, memory: { I: m.I.slice(), Q: m.Q.slice(), M: m.M.slice() } };
  });
}

/**
 * What a gate case must show for an instruction to count as exercised: the mnemonic with its
 * operand's kind (`L MD`, `L real`, `A I`, `A OV`, `JC label`, `CALL FC105`). Loading a REAL constant
 * and loading a word from memory are different paths through the interpreter, so each must run.
 */
export function instructionKey(s: Statement): string {
  const o = s.operand;
  switch (o.kind) {
    case "none":
      return s.op;
    case "address": {
      const a = o.address;
      return `${s.op} ${formatAddress(a).split(" ")[0]}`;
    }
    case "indirect":
      return `${s.op} ${o.area}${o.width === "bit" ? "" : o.width[0]?.toUpperCase()} [AR1]`;
    case "condition":
      return `${s.op} ${o.condition}`;
    case "constant":
      return `${s.op} ${o.type.toLowerCase()}`;
    case "label":
      return `${s.op} label`;
    case "block":
      return `CALL FC${o.number}`;
    case "unknown":
      return `${s.op} ${o.text}`;
  }
}

export { AREA_SIZES, parseStl };
export type { Program, Statement };
