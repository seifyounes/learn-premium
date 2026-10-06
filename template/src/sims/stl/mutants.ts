// The stl gate's negative controls, run on every listing at every build: each mutant is the
// interpreter broken one known way, and the gate's comparison with awlsim must catch every mutant
// whose defect the listing's cases actually reach. A mutant counts as exercised only when its run
// really differs from the interpreter's (the float64 lesson of #37: a defect the cases never reach
// proves nothing), and an exercised mutant the comparison passes means the gate is blind to it.

import { scale, toReal, int16, type LibraryBlock, LIBRARY, STATUS_BITS } from "../s7/core.ts";
import { INTERPRETER, runCase, type GateCase, type Interpreter, type ScanResult, type StlModel } from "./engine.ts";
import { callWith, INSTRUCTIONS, type Context, type Instruction, type InstructionTable } from "./instructions.ts";
import { compareWithOracle, type OracleLog } from "./oracle.ts";
import { parseStl } from "./parse.ts";

/** What a negative control came to on one listing. */
export interface ControlResult {
  id: string;
  defect: string;
  /**
   * `caught`: its defect showed and the comparison with awlsim saw it. `missed`: it showed, and the
   * comparison passed it (the gate is blind to it). `not-used`: the listing has none of its
   * instructions. `not-reached`: it has them, but no case reaches the defect.
   */
  outcome: "caught" | "missed" | "not-used" | "not-reached";
  /** Where it first showed, or what the comparison said. */
  detail?: string;
}

/** Where a broken run first differs from the interpreter's, register by register; registers a block left are skipped. */
function firstDifference(
  good: ScanResult[][],
  broken: (ScanResult[] | Error)[],
  cases: readonly GateCase[],
): string | undefined {
  for (const [ci, runs] of good.entries()) {
    const other = broken[ci];
    const name = cases[ci]?.name ?? `case ${ci + 1}`;
    if (other instanceof Error) return `${name}: the broken interpreter stops: ${other.message}`;
    for (const [si, scan] of runs.entries()) {
      const theirs = other?.[si];
      if (!theirs) return `${name}, scan ${si + 1}: the broken interpreter ran no such scan`;
      if (theirs.trace.length !== scan.trace.length)
        return `${name}, scan ${si + 1}: it runs another number of statements`;
      for (const [k, t] of scan.trace.entries()) {
        const u = theirs.trace[k];
        if (!u) break;
        const mask = STATUS_BITS.reduce((m, b, i) => (t.leftBy[b] ? m & ~(1 << i) : m), 0x1ff);
        const differs =
          u.statement !== t.statement ||
          (!t.leftBy.ACCU1 && u.accu1 !== t.accu1) ||
          (!t.leftBy.ACCU2 && u.accu2 !== t.accu2) ||
          u.ar1 !== t.ar1 ||
          (u.status & mask) !== (t.status & mask) ||
          JSON.stringify(u.writes) !== JSON.stringify(t.writes);
        if (differs) return `${name}, scan ${si + 1}, line ${t.line + 1} (${t.op})`;
      }
      for (const area of ["I", "Q", "M"] as const)
        if (theirs.memory[area].join() !== scan.memory[area].join())
          return `${name}, scan ${si + 1}: ${area} after the scan`;
    }
  }
  return undefined;
}

/**
 * Runs every mutant on the listing's cases. Each exercised mutant must be caught by the same
 * comparison with awlsim the listing itself passed.
 */
export function runControls(model: StlModel, cases: readonly GateCase[], log: OracleLog): ControlResult[] {
  const program = parseStl(model.source);
  const used = new Set(program.statements.map((s) => s.op));
  const good = cases.map((c) => runCase(model, c.scans, program));
  return MUTANTS.map(({ id, defect, ops, interpreter }) => {
    if (ops.length > 0 && !ops.some((op) => used.has(op))) return { id, defect, outcome: "not-used" };
    const broken = cases.map((c) => {
      try {
        return runCase(model, c.scans, program, interpreter);
      } catch (error) {
        return error as Error;
      }
    });
    const showed = firstDifference(good, broken, cases);
    if (!showed) return { id, defect, outcome: "not-reached" };
    const agreement = compareWithOracle(model, cases, log, (scans) => {
      const i = cases.findIndex((c) => c.scans === scans);
      const run = broken[i];
      if (run instanceof Error) throw run;
      if (!run) throw new Error("no such case");
      return run;
    });
    return agreement.mismatches.length > 0
      ? { id, defect, outcome: "caught", detail: agreement.mismatches[0] ?? "" }
      : { id, defect, outcome: "missed", detail: `it shows at ${showed}, but the comparison with awlsim passes it` };
  });
}

export interface Mutant {
  id: string;
  /** The defect, as a gate report names it. */
  defect: string;
  /** The mnemonics whose behaviour it changes; empty when it changes every scan's start. */
  ops: readonly string[];
  interpreter: Interpreter;
}

const COMPARES = ["==", "<>", ">", "<", ">=", "<="].flatMap((r) => ["I", "D", "R"].map((t) => `${r}${t}`));

/** The table with each named instruction's run replaced. */
function patched(ops: readonly string[], run: (original: Instruction, c: Context) => void): InstructionTable {
  const table: Record<string, Instruction> = { ...INSTRUCTIONS };
  for (const op of ops) {
    const original = INSTRUCTIONS[op];
    if (!original) throw new Error(`no instruction ${op} to break`);
    table[op] = { operands: original.operands, run: (c) => run(original, c) };
  }
  return table;
}

const withTable = (instructions: InstructionTable): Interpreter => ({ ...INTERPRETER, instructions });

const unclampedLibrary: Readonly<Record<number, LibraryBlock>> = {
  ...LIBRARY,
  105: {
    ...(LIBRARY[105] as LibraryBlock),
    run: (p) => {
      const K1 = p.BIPOLAR ? -27648 : 0;
      const clamped = scale(p.IN ?? 0, p.HI_LIM ?? 0, p.LO_LIM ?? 0, p.BIPOLAR ?? 0);
      const fraction = toReal(toReal(int16(p.IN ?? 0) - K1) / toReal(27648 - K1));
      const lo = toReal(p.LO_LIM ?? 0);
      return { OUT: toReal(toReal(toReal(toReal(p.HI_LIM ?? 0) - lo) * fraction) + lo), RET_VAL: clamped.RET_VAL };
    },
  },
};

const OVERFLOWING = ["+I", "-I", "*I", "/I", "+D", "-D", "*D", "/D", "MOD", "NEGI", "NEGD", "+R", "-R", "*R", "/R"];

export const MUTANTS: readonly Mutant[] = [
  {
    id: "mul-i-16-bit",
    defect: "*I keeps a 16-bit product (the spike's defect: the manual leaves the 32-bit product in ACCU 1)",
    ops: ["*I"],
    interpreter: withTable(
      patched(["*I"], (original, c) => {
        original.run(c);
        c.cpu.accu1 = (c.cpu.accu1 & 0xffff) >>> 0;
      }),
    ),
  },
  {
    id: "compare-ands-rlo",
    defect: "a compare ANDs its result into an open logic string instead of writing the RLO",
    ops: COMPARES,
    interpreter: withTable(
      patched(COMPARES, (original, c) => {
        const open = c.cpu.status["/FC"];
        const before = c.cpu.status.RLO;
        original.run(c);
        if (open) c.cpu.status.RLO = (c.cpu.status.RLO & before) as 0 | 1;
      }),
    ),
  },
  {
    id: "int-no-wrap",
    defect: "+I and -I keep the exact result: no 16-bit wrap and no OV",
    ops: ["+I", "-I"],
    interpreter: withTable(
      patched(["+I", "-I"], (original, c) => {
        const a2 = int16(c.cpu.accu2);
        const a1 = int16(c.cpu.accu1);
        original.run(c);
        c.cpu.accu1 = (c.statement.op === "+I" ? a2 + a1 : a2 - a1) >>> 0;
        c.cpu.status.OV = 0;
      }),
    ),
  },
  {
    id: "os-not-latched",
    defect: "an overflow sets OV, but OS doesn't latch it",
    ops: OVERFLOWING,
    interpreter: withTable(
      patched(OVERFLOWING, (original, c) => {
        const os = c.cpu.status.OS;
        original.run(c);
        c.cpu.status.OS = os;
      }),
    ),
  },
  {
    id: "real-operands-swapped",
    defect: "-R and /R take ACCU 1 first: ACCU 1 − ACCU 2 instead of ACCU 2 − ACCU 1",
    ops: ["-R", "/R"],
    interpreter: withTable(
      patched(["-R", "/R"], (original, c) => {
        [c.cpu.accu1, c.cpu.accu2] = [c.cpu.accu2, c.cpu.accu1];
        const accu1 = c.cpu.accu1;
        original.run(c);
        c.cpu.accu2 = accu1;
      }),
    ),
  },
  {
    id: "transfer-little-endian",
    defect: "T writes a word or double word low byte first",
    ops: ["T"],
    interpreter: withTable(
      patched(["T"], (original, c) => {
        const o = c.statement.operand;
        const width =
          o.kind === "address" || o.kind === "indirect" ? (o.kind === "address" ? o.address.width : o.width) : "byte";
        const value = c.cpu.accu1;
        if (width === "word")
          c.cpu.accu1 = ((value & 0xffff0000) | ((value & 0xff) << 8) | ((value >> 8) & 0xff)) >>> 0;
        if (width === "dword")
          c.cpu.accu1 =
            (((value & 0xff) << 24) | ((value & 0xff00) << 8) | ((value >> 8) & 0xff00) | (value >>> 24)) >>> 0;
        original.run(c);
        c.cpu.accu1 = value;
      }),
    ),
  },
  {
    id: "jump-keeps-rlo",
    defect: "a conditional jump leaves the RLO and /FC as it found them (the manual sets RLO 1 and /FC 0)",
    ops: ["JC", "JCN", "JCB", "JNB"],
    interpreter: withTable(
      patched(["JC", "JCN", "JCB", "JNB"], (original, c) => {
        const { RLO, "/FC": fc } = c.cpu.status;
        original.run(c);
        c.cpu.status.RLO = RLO;
        c.cpu.status["/FC"] = fc;
      }),
    ),
  },
  {
    id: "fc105-unclamped",
    defect: "FC105 scales an input past its range instead of clamping it to the limit",
    ops: ["CALL"],
    interpreter: withTable({ ...INSTRUCTIONS, CALL: { operands: ["block"], run: callWith(unclampedLibrary) } }),
  },
  {
    id: "registers-kept",
    defect: "OB 1 starts with the registers the last scan left, not cleared",
    ops: [],
    interpreter: {
      ...INTERPRETER,
      startScan: (cpu) => {
        cpu.pc = 0;
        cpu.ended = false;
        cpu.parens = [];
      },
    },
  },
];
