// The STL instructions the interpreter runs, on a two-accumulator S7-300 CPU. Each one is written
// to agree bit for bit with awlsim, the build oracle, on the accumulators, AR 1, the status word
// and memory; where the Siemens STL manual leaves a case open, awlsim's choice is the one taken.
// The template's own awlsim corpus (`test/stl/`) runs every instruction here, so none is supported
// on trust (the spike's 16-bit `*I` is the lesson).
//
// A register a library block left behind (`leftBy`) has no known value: Siemens doesn't publish what
// FC105 leaves there. A statement that reads one stops the run with an error naming it, and one
// that overwrites it makes it known again. Reads go through `accu1`, `accu2` and `bit` so none
// slips past that rule.

import {
  add,
  bitsToReal,
  clearedStatus,
  divide,
  fromPattern,
  int16,
  int32,
  isInfBits,
  isNaNBits,
  LIBRARY,
  multiply,
  NAN_BITS,
  negate,
  parseAddress,
  realClass,
  realClassOfBits,
  realToBits,
  realToDint,
  S7Memory,
  subtract,
  toPattern,
  type Address,
  type ByteWrite,
  type Rounding,
  type StatusBit,
  type StatusWord,
} from "../s7/core.ts";
import type { Condition, Operand, Program, Statement } from "./parse.ts";

/** A register a statement can leave: the two accumulators, AR 1, or a status bit. */
export type Register = "ACCU1" | "ACCU2" | "AR1" | StatusBit;

/** What a library block leaves undefined: everything its insides may touch, bar what its block end sets. */
const LEFT_BY_A_BLOCK: readonly Register[] = ["ACCU1", "ACCU2", "RLO", "CC0", "CC1", "OV", "BR"];

export interface Cpu {
  mem: S7Memory;
  accu1: number;
  accu2: number;
  ar1: number;
  status: StatusWord;
  /** The next statement to run, by index. */
  pc: number;
  /** OB 1 has reached its block end this scan. */
  ended: boolean;
  /** The nesting stack of `A(`…`)`: the RLO, /FC and OR each opening saved. */
  parens: { op: string; RLO: number; FC: number; OR: number }[];
  /**
   * Registers a library block left behind that no statement has written since, each naming the
   * block ("FC105"). The trace shows them as "left by FC105", and the gate never compares them.
   */
  leftBy: Partial<Record<Register, string>>;
}

export function createCpu(mem = new S7Memory()): Cpu {
  return { mem, accu1: 0, accu2: 0, ar1: 0, status: clearedStatus(), pc: 0, ended: false, parens: [], leftBy: {} };
}

/**
 * What the operating system does as it calls OB 1 each scan: the accumulators, AR 1 and the status
 * word start cleared. The manual is silent; awlsim clears them, and the engine follows it (#37).
 */
export function startScan(cpu: Cpu): void {
  cpu.accu1 = 0;
  cpu.accu2 = 0;
  cpu.ar1 = 0;
  cpu.status = clearedStatus();
  cpu.pc = 0;
  cpu.ended = false;
  cpu.parens = [];
  cpu.leftBy = {};
}

/** What one statement did. */
export interface Effect {
  writes: ByteWrite[];
  /** The statement index it jumped to, when it jumped. */
  jumpedTo?: number;
  /** A library block it called, with what went in and came out. */
  call?: { block: string; inputs: Record<string, number>; outputs: Record<string, number> };
}

interface Context {
  cpu: Cpu;
  program: Program;
  statement: Statement;
  effect: Effect;
}

type OperandKind = Operand["kind"];

interface Instruction {
  /** The operand kinds it takes; `none` when it may stand alone. */
  operands: readonly OperandKind[];
  run: (c: Context) => void;
}

// ---- reads: a register a library block left behind can't be read ------------------------------

const NAMES: Partial<Record<Register, string>> = { ACCU1: "ACCU 1", ACCU2: "ACCU 2", AR1: "AR 1" };

function known(c: Context, register: Register) {
  const block = c.cpu.leftBy[register];
  if (block)
    throw new Error(
      `${c.statement.op} reads ${NAMES[register] ?? register}, which ${block} left undefined (Siemens doesn't publish what ${block} leaves there)`,
    );
}
const accu1 = (c: Context) => (known(c, "ACCU1"), c.cpu.accu1);
const accu2 = (c: Context) => (known(c, "ACCU2"), c.cpu.accu2);
const bit = (c: Context, name: StatusBit) => (known(c, name), c.cpu.status[name]);
/** /FC is never left undefined: a block end clears it. */
const fc = (c: Context) => c.cpu.status["/FC"];

// ---- writes: each makes its register known again ---------------------------------------------

const setAccu1 = (c: Context, value: number) => {
  c.cpu.accu1 = value >>> 0;
  delete c.cpu.leftBy.ACCU1;
};
/** Only ACCU 1's low word: its high word keeps what it held. */
const setAccu1Low = (c: Context, value: number) => {
  c.cpu.accu1 = ((c.cpu.accu1 & 0xffff0000) | (value & 0xffff)) >>> 0;
};
const setAccu1Byte = (c: Context, value: number) => {
  c.cpu.accu1 = ((c.cpu.accu1 & 0xffffff00) | (value & 0xff)) >>> 0;
};
/** ACCU 1 into ACCU 2, carrying whether it was left undefined. */
const pushAccu = (c: Context) => {
  c.cpu.accu2 = c.cpu.accu1;
  const left = c.cpu.leftBy.ACCU1;
  if (left) c.cpu.leftBy.ACCU2 = left;
  else delete c.cpu.leftBy.ACCU2;
};
const setBits = (c: Context, bits: Partial<Record<StatusBit, number>>) => {
  const written = Object.entries(bits) as [StatusBit, number][];
  for (const [name, value] of written) c.cpu.status[name] = value ? 1 : 0;
  if (written.some(([name]) => c.cpu.leftBy[name]))
    c.cpu.leftBy = Object.fromEntries(Object.entries(c.cpu.leftBy).filter(([register]) => !(register in bits)));
};
/** OV set, and OS latched. */
const overflow = (c: Context) => setBits(c, { OV: 1, OS: 1 });

// ---- operands -------------------------------------------------------------------------------

function addressOf(c: Context): Address {
  const o = c.statement.operand;
  if (o.kind === "address") return o.address;
  if (o.kind === "indirect") {
    known(c, "AR1");
    const bits = (c.cpu.ar1 & 0x7ffff) + o.offset;
    return { area: o.area, width: o.width, byte: bits >> 3, bit: o.width === "bit" ? bits & 7 : 0 };
  }
  throw new Error(`${c.statement.op} needs an address, not "${c.statement.text}"`);
}

const read = (c: Context, a: Address) => c.cpu.mem.read(a);
const write = (c: Context, a: Address, value: number) => c.effect.writes.push(...c.cpu.mem.write(a, value));

function conditionBit(c: Context, condition: Condition): number {
  if (condition === "OV" || condition === "OS" || condition === "BR") return bit(c, condition);
  const cc1 = bit(c, "CC1");
  const cc0 = bit(c, "CC0");
  switch (condition) {
    case "==0":
      return (cc0 ^ 1) & (cc1 ^ 1);
    case "<>0":
      return cc0 | cc1;
    case ">0":
      return (cc0 ^ 1) & cc1;
    case "<0":
      return cc0 & (cc1 ^ 1);
    case ">=0":
      return cc0 ^ 1;
    case "<=0":
      return cc1 ^ 1;
    case "UO":
      return cc0 & cc1;
  }
}

/** The bit a logic instruction checks: a memory bit or a status condition. */
function bitOperand(c: Context): number {
  const o = c.statement.operand;
  return o.kind === "condition" ? conditionBit(c, o.condition) : read(c, addressOf(c));
}

/** What `L` loads: memory zero-extended, or a constant's pattern. */
function loadValue(c: Context): number {
  const o = c.statement.operand;
  return o.kind === "constant" ? o.pattern : read(c, addressOf(c));
}

// ---- bit logic: the RLO is read only inside an open logic string (/FC = 1) -------------------

const BIT = ["address", "indirect", "condition"] as const;
const MEMORY = ["address", "indirect"] as const;

function and(c: Context, negated: boolean) {
  const sta = bitOperand(c);
  const value = negated ? sta ^ 1 : sta;
  if (fc(c)) {
    const or = c.cpu.status.OR;
    setBits(c, { RLO: (bit(c, "RLO") & value) | or, OR: or, STA: sta, "/FC": 1 });
  } else setBits(c, { RLO: value, OR: 0, STA: sta, "/FC": 1 });
}

function orBit(c: Context, negated: boolean) {
  const sta = bitOperand(c);
  const rlo = fc(c) ? bit(c, "RLO") : 0;
  setBits(c, { OR: 0, STA: sta, RLO: rlo | (negated ? sta ^ 1 : sta), "/FC": 1 });
}

function xor(c: Context, negated: boolean) {
  const sta = bitOperand(c);
  const rlo = fc(c) ? bit(c, "RLO") : 0;
  setBits(c, { OR: 0, STA: sta, RLO: rlo ^ (negated ? sta ^ 1 : sta), "/FC": 1 });
}

function openParen(c: Context) {
  const open = fc(c);
  c.cpu.parens.push({ op: c.statement.op, RLO: open ? bit(c, "RLO") : 0, FC: open, OR: c.cpu.status.OR });
  setBits(c, { OR: 0, STA: 1, "/FC": 0 });
}

function closeParen(c: Context) {
  const saved = c.cpu.parens.pop();
  if (!saved) throw new Error(") closes no open parenthesis");
  const r = bit(c, "RLO");
  if (saved.op === "A(" || saved.op === "AN(") {
    const inner = saved.op === "A(" ? r : r ^ 1;
    const or = saved.OR & saved.FC;
    setBits(c, { RLO: ((saved.RLO | (saved.FC ^ 1)) & inner) | or, OR: or, STA: 1, "/FC": 1 });
  } else {
    const inner = saved.op === "O(" || saved.op === "X(" ? r : r ^ 1;
    const outer = saved.RLO & saved.FC;
    const rlo = saved.op === "O(" || saved.op === "ON(" ? outer | inner : outer ^ inner;
    setBits(c, { RLO: rlo, OR: 0, STA: 1, "/FC": 1 });
  }
}

/** `O` alone: AND before OR. */
function orAlone(c: Context) {
  if (fc(c)) {
    const rlo = bit(c, "RLO");
    setBits(c, { OR: rlo | c.cpu.status.OR, STA: 1, "/FC": rlo });
  } else setBits(c, { OR: 0, STA: 1, "/FC": 0 });
}

function assign(c: Context, store: "=" | "S" | "R") {
  const rlo = bit(c, "RLO");
  const a = addressOf(c);
  if (store === "=") write(c, a, rlo);
  else if (rlo) write(c, a, store === "S" ? 1 : 0);
  setBits(c, { OR: 0, STA: rlo, "/FC": 0 });
}

function edge(c: Context, rising: boolean) {
  const rlo = bit(c, "RLO");
  const a = addressOf(c);
  const memory = read(c, a);
  write(c, a, rlo);
  setBits(c, { OR: 0, STA: rlo, "/FC": 1, RLO: rising ? rlo & (memory ^ 1) : (rlo ^ 1) & memory });
}

// ---- integer arithmetic ------------------------------------------------------------------------

/** CC 1 and CC 0 from a result's sign. */
const signBits = (value: number | bigint) =>
  value == 0 ? { CC1: 0, CC0: 0 } : value < 0 ? { CC1: 0, CC0: 1 } : { CC1: 1, CC0: 0 };

/** +I, -I: ACCU 1's low word takes the 16-bit result; CC from the wrapped result. */
function intOp(c: Context, op: "+" | "-") {
  const a2 = int16(accu2(c));
  const a1 = int16(accu1(c));
  const r = op === "+" ? add(a2, a1, 16) : subtract(a2, a1, 16);
  setAccu1Low(c, r.value);
  setBits(c, { ...signBits(r.value), OV: 0 });
  if (r.ov) overflow(c);
}

/** +D, -D (CC from the wrapped result), *D, and *I, whose 32-bit product fills ACCU 1 (CC from the true product). */
function dintOp(c: Context, op: "+D" | "-D" | "*D" | "*I") {
  const wide = op === "*I";
  const a2 = wide ? int16(accu2(c)) : int32(accu2(c));
  const a1 = wide ? int16(accu1(c)) : int32(accu1(c));
  const r = op === "+D" ? add(a2, a1, 32) : op === "-D" ? subtract(a2, a1, 32) : multiply(a2, a1, 32);
  setAccu1(c, r.value);
  setBits(c, { ...signBits(op === "*D" || wide ? r.exact : r.value), OV: 0 });
  if (wide ? r.exact > 32767n || r.exact < -32768n : r.ov) overflow(c);
}

/** /I (quotient in the low word, remainder in the high), /D and MOD. By 0, ACCU 1 is kept and OV, OS and CC set. */
function divOp(c: Context, op: "/I" | "/D" | "MOD") {
  const word = op === "/I";
  const a2 = word ? int16(accu2(c)) : int32(accu2(c));
  const a1 = word ? int16(accu1(c)) : int32(accu1(c));
  const d = divide(a2, a1, word ? 16 : 32);
  if (d.byZero) {
    setBits(c, { CC1: 1, CC0: 1, OV: 1, OS: 1 });
    return;
  }
  if (op === "MOD") {
    setAccu1(c, d.remainder);
    setBits(c, { ...signBits(d.remainder), OV: 0 });
    return;
  }
  const exact = Math.trunc(a2 / a1);
  setAccu1(c, word ? ((d.remainder & 0xffff) << 16) | (d.quotient & 0xffff) : d.quotient);
  setBits(c, { ...signBits(exact), OV: 0 });
  if (exact > (word ? 32767 : 2147483647)) overflow(c);
}

/** NEGI, NEGD: the two's complement, OV on the one value with no negative. */
function negOp(c: Context, bits: 16 | 32) {
  const r = negate(bits === 16 ? int16(accu1(c)) : int32(accu1(c)), bits);
  if (bits === 16) setAccu1Low(c, r.value);
  else setAccu1(c, r.value);
  setBits(c, { ...signBits(r.value), OV: 0 });
  if (r.ov) overflow(c);
}

// ---- REAL arithmetic -------------------------------------------------------------------------

/** CC and OV from a REAL result's class; OS latches OV. */
function realStatus(c: Context, k: { cc1: number; cc0: number; ov: number }) {
  setBits(c, { CC1: k.cc1, CC0: k.cc0, OV: k.ov });
  if (k.ov) setBits(c, { OS: 1 });
}

/** A REAL result into ACCU 1, CC and OV from the exact result. A NaN result is stored as all ones. */
function realResult(c: Context, exact: number) {
  setAccu1(c, realToBits(exact));
  realStatus(c, realClass(exact));
}

const real = (bits: number) => bitsToReal(bits);

function multiplyReal(c: Context) {
  const b1 = accu1(c);
  const b2 = accu2(c);
  if (isInfBits(b1) || isInfBits(b2)) {
    const zero = (b: number) => (b & 0x7fffffff) === 0;
    const bits = zero(b1) || zero(b2) ? 0xffffffff : (b2 ^ (b1 & 0x80000000)) >>> 0;
    setAccu1(c, bits);
    realStatus(c, realClassOfBits(bits));
    overflow(c);
    return;
  }
  realResult(c, real(b1) * real(b2));
}

function divideReal(c: Context) {
  const b1 = accu1(c);
  const b2 = accu2(c);
  const a1 = real(b1);
  const a2 = real(b2);
  if (isInfBits(b1)) realResult(c, 0);
  else if (a1 !== 0) realResult(c, a2 / a1);
  else realResult(c, a2 >= 0 ? Infinity : -Infinity);
}

/** What a REAL function does with an input it has no number for: a fixed result, or `keep` ACCU 1. */
type Special = (bits: number, x: number) => number | "keep" | undefined;

function realFunction(c: Context, f: (x: number) => number, special: Special) {
  const bits = accu1(c);
  const x = real(bits);
  const s = special(bits, x);
  if (s === "keep") realStatus(c, realClassOfBits(bits));
  else if (s !== undefined) {
    setAccu1(c, s);
    realStatus(c, realClassOfBits(s));
  } else realResult(c, f(x));
}

const POS_INF = 0x7f800000;
const NEG_INF = 0xff800000;
const NEG_ZERO = 0x80000000;
const infinite = (bits: number) => bits === POS_INF || bits === NEG_INF;
/** awlsim snaps a trigonometric result within 1e-7 of −1, 0 or 1 onto it. */
const snapped = (y: number) => (Math.abs(y + 1) < 1e-7 ? -1 : Math.abs(y) < 1e-7 ? 0 : Math.abs(y - 1) < 1e-7 ? 1 : y);
const nanIn = (bits: number) => (isNaNBits(bits) ? NAN_BITS : undefined);

/** RND, RND+, RND-, TRUNC: a REAL outside DINT keeps ACCU 1 and sets OV and OS. */
function convert(c: Context, rounding: Rounding) {
  const r = realToDint(real(accu1(c)), rounding);
  if (r.ov) overflow(c);
  else setAccu1(c, r.value);
}

// ---- word logic, shifts and rotates ------------------------------------------------------------

function wordLogic(c: Context, op: "AND" | "OR" | "XOR", bits: 16 | 32) {
  const o = c.statement.operand;
  const mask = bits === 16 ? 0xffff : 0xffffffff;
  const a = accu1(c) & mask;
  const b = (o.kind === "constant" ? o.pattern : accu2(c)) & mask;
  const r = ((op === "AND" ? a & b : op === "OR" ? a | b : a ^ b) & mask) >>> 0;
  if (bits === 16) setAccu1Low(c, r);
  else setAccu1(c, r);
  setBits(c, { CC1: r ? 1 : 0, CC0: 0, OV: 0 });
}

/** A shift's count: its constant, or ACCU 2's low byte; capped at the width. */
function shiftCount(c: Context, max: number): number {
  const o = c.statement.operand;
  return Math.min(o.kind === "constant" ? o.pattern : accu2(c) & 0xff, max);
}

function shift(c: Context, op: "SLW" | "SRW" | "SLD" | "SRD" | "SSI" | "SSD") {
  const word = op === "SLW" || op === "SRW" || op === "SSI";
  const width = word ? 16 : 32;
  const count = shiftCount(c, width);
  const a1 = accu1(c);
  if (count <= 0) return;
  let value = BigInt(op === "SSI" ? int16(a1) : op === "SSD" ? int32(a1) : word ? a1 & 0xffff : a1 >>> 0);
  const left = op === "SLW" || op === "SLD";
  const out = Number((left ? value >> BigInt(width - count) : value >> BigInt(count - 1)) & 1n);
  value = left ? value << BigInt(count) : value >> BigInt(count);
  const result = Number(BigInt.asUintN(width, value));
  if (word) setAccu1Low(c, result);
  else setAccu1(c, result);
  setBits(c, { CC1: out, CC0: 0, OV: 0 });
}

function rotate(c: Context, left: boolean) {
  const count = shiftCount(c, 32);
  const v = accu1(c) >>> 0;
  if (count <= 0) return;
  const r = count === 32 ? v : (left ? (v << count) | (v >>> (32 - count)) : (v >>> count) | (v << (32 - count))) >>> 0;
  setAccu1(c, r);
  setBits(c, { CC0: 0, CC1: left ? r & 1 : (r >>> 31) & 1, OV: 0 });
}

/** RLDA, RRDA: rotate one bit through CC 1. */
function rotateThroughCc1(c: Context, left: boolean) {
  const cc1 = bit(c, "CC1");
  const v = accu1(c) >>> 0;
  setBits(c, { CC0: 0, CC1: left ? (v >>> 31) & 1 : v & 1, OV: 0 });
  setAccu1(c, left ? ((v & 0x7fffffff) << 1) | cc1 : (v >>> 1) | (cc1 << 31));
}

// ---- compares ------------------------------------------------------------------------------

type Relation = "==" | "<>" | ">" | "<" | ">=" | "<=";
const RELATIONS: readonly Relation[] = ["==", "<>", ">", "<", ">=", "<="];

/** Whether a relation holds, read off CC 1 and CC 0 as a compare (or awlsim's REAL difference) left them. */
function holds(relation: Relation, cc1: number, cc0: number): number {
  switch (relation) {
    case "==":
      return (cc0 ^ 1) & (cc1 ^ 1);
    case "<>":
      return cc0 | cc1;
    case ">":
      return (cc0 ^ 1) & cc1;
    case "<":
      return cc0 & (cc1 ^ 1);
    case ">=":
      return cc0 ^ 1;
    case "<=":
      return cc1 ^ 1;
  }
}

/** A compare writes the RLO outright (it never ANDs into an open string): ACCU 2 against ACCU 1. */
function compare(c: Context, relation: Relation, type: "I" | "D" | "R") {
  const b1 = accu1(c);
  const b2 = accu2(c);
  if (type === "R") {
    if (isNaNBits(b1) || isNaNBits(b2)) {
      setBits(c, { CC0: 1, CC1: 1, OV: 1, OS: 1, STA: 0, OR: 0, RLO: 0, "/FC": 1 });
      return;
    }
    // awlsim classes the difference ACCU 2 − ACCU 1 as a REAL result, OV and all.
    const k = realClass(real(b2) - real(b1));
    realStatus(c, k);
    const r = holds(relation, k.cc1, k.cc0);
    setBits(c, { STA: r, OR: 0, RLO: r, "/FC": 1 });
    return;
  }
  const a2 = type === "I" ? int16(b2) : int32(b2);
  const a1 = type === "I" ? int16(b1) : int32(b1);
  const cc = signBits(a2 === a1 ? 0 : a2 > a1 ? 1 : -1);
  const r = holds(relation, cc.CC1, cc.CC0);
  setBits(c, { ...cc, RLO: r, OV: 0, OR: 0, STA: r, "/FC": 1 });
}

// ---- jumps and block end ---------------------------------------------------------------------

function jumpTo(c: Context) {
  const o = c.statement.operand;
  if (o.kind !== "label") throw new Error(`${c.statement.op} needs a label`);
  const target = c.program.labels[o.name];
  if (target === undefined) throw new Error(`no label ${o.name}`);
  c.effect.jumpedTo = target;
}

/** A jump on the RLO: JC, JCN, and JCB and JNB, which also save the RLO in BR. */
function rloJump(c: Context, onOne: boolean, saveInBr: boolean) {
  const rlo = bit(c, "RLO");
  if (rlo === (onOne ? 1 : 0)) jumpTo(c);
  setBits(c, { ...(saveInBr ? { BR: rlo } : {}), OR: 0, STA: 1, RLO: 1, "/FC": 0 });
}

function brJump(c: Context, onOne: boolean) {
  if (bit(c, "BR") === (onOne ? 1 : 0)) jumpTo(c);
  setBits(c, { OR: 0, STA: 1, "/FC": 0 });
}

const ccJump = (c: Context, test: (cc1: number, cc0: number) => boolean) => {
  if (test(bit(c, "CC1"), bit(c, "CC0"))) jumpTo(c);
};

function blockEnd(c: Context) {
  setBits(c, { OS: 0, OR: 0, STA: 1, "/FC": 0 });
  c.cpu.ended = true;
}

// ---- library CALLs ---------------------------------------------------------------------------

function call(c: Context) {
  const o = c.statement.operand;
  if (o.kind !== "block") throw new Error("CALL needs a block");
  const block = LIBRARY[o.number];
  if (!block) throw new Error(`FC${o.number} isn't a library block this interpreter has`);
  const params = c.statement.params ?? {};
  const inputs: Record<string, number> = {};
  for (const [name, type] of Object.entries(block.inputs)) {
    const actual = params[name] === undefined ? undefined : parseActual(params[name]);
    if (!actual) throw new Error(`FC${o.number}: ${name} isn't given an address or constant`);
    inputs[name] = fromPattern(type, "pattern" in actual ? actual.pattern : read(c, actual));
  }
  const outputs = block.run(inputs);
  for (const [name, type] of Object.entries(block.outputs)) {
    const actual = params[name] === undefined ? undefined : parseActual(params[name]);
    if (!actual || "pattern" in actual || actual.peripheral)
      throw new Error(`FC${o.number}: ${name} isn't given an address to write`);
    write(c, actual, toPattern(type, outputs[name] ?? 0));
  }
  // The block's own end: OS, OR, /FC cleared, STA set (manual 10.2). What its insides leave in the
  // accumulators, the RLO, CC, OV and BR, Siemens doesn't publish.
  setBits(c, { OS: 0, OR: 0, STA: 1, "/FC": 0 });
  for (const register of LEFT_BY_A_BLOCK) c.cpu.leftBy[register] = `FC${o.number}`;
  c.effect.call = { block: `FC${o.number} ${block.name}`, inputs, outputs };
}

/** A CALL parameter's actual: an address (a peripheral input only going in), or a constant. */
export function parseActual(text: string): Address | { pattern: number } | undefined {
  const a = parseAddress(text);
  if (a) return a;
  const t = text.trim();
  if (/^TRUE$/i.test(t)) return { pattern: 1 };
  if (/^FALSE$/i.test(t)) return { pattern: 0 };
  if (/^[+-]?(\d+\.\d*|\.\d+)(e[+-]?\d+)?$/i.test(t) || /^[+-]?\d+e[+-]?\d+$/i.test(t))
    return { pattern: realToBits(Number(t)) };
  if (/^[+-]?\d+$/.test(t) && Math.abs(Number(t)) <= 32768) return { pattern: Number(t) & 0xffff };
  return undefined;
}

// ---- the table ---------------------------------------------------------------------------------

const NONE = ["none"] as const;
const CONSTANT_OR_NONE = ["none", "constant"] as const;
const LABEL = ["label"] as const;

const realUnary = (f: (x: number) => number, special: Special): Instruction => ({
  operands: NONE,
  run: (c) => realFunction(c, f, special),
});

const compares = Object.fromEntries(
  RELATIONS.flatMap((relation) =>
    (["I", "D", "R"] as const).map((type): [string, Instruction] => [
      `${relation}${type}`,
      { operands: NONE, run: (c) => compare(c, relation, type) },
    ]),
  ),
);

export const INSTRUCTIONS: Readonly<Record<string, Instruction>> = {
  // bit logic
  A: { operands: BIT, run: (c) => and(c, false) },
  AN: { operands: BIT, run: (c) => and(c, true) },
  O: { operands: ["none", ...BIT], run: (c) => (c.statement.operand.kind === "none" ? orAlone(c) : orBit(c, false)) },
  ON: { operands: BIT, run: (c) => orBit(c, true) },
  X: { operands: BIT, run: (c) => xor(c, false) },
  XN: { operands: BIT, run: (c) => xor(c, true) },
  "A(": { operands: NONE, run: openParen },
  "AN(": { operands: NONE, run: openParen },
  "O(": { operands: NONE, run: openParen },
  "ON(": { operands: NONE, run: openParen },
  "X(": { operands: NONE, run: openParen },
  "XN(": { operands: NONE, run: openParen },
  ")": { operands: NONE, run: closeParen },
  NOT: { operands: NONE, run: (c) => setBits(c, { STA: 1, RLO: bit(c, "RLO") ^ 1 }) },
  SET: { operands: NONE, run: (c) => setBits(c, { OR: 0, STA: 1, RLO: 1, "/FC": 0 }) },
  CLR: { operands: NONE, run: (c) => setBits(c, { OR: 0, STA: 0, RLO: 0, "/FC": 0 }) },
  SAVE: { operands: NONE, run: (c) => setBits(c, { BR: bit(c, "RLO") }) },
  "=": { operands: MEMORY, run: (c) => assign(c, "=") },
  S: { operands: MEMORY, run: (c) => assign(c, "S") },
  R: { operands: MEMORY, run: (c) => assign(c, "R") },
  FP: { operands: MEMORY, run: (c) => edge(c, true) },
  FN: { operands: MEMORY, run: (c) => edge(c, false) },

  // load, transfer, accumulators
  L: {
    operands: ["address", "indirect", "constant"],
    run: (c) => {
      const value = loadValue(c);
      pushAccu(c);
      setAccu1(c, value);
    },
  },
  T: { operands: MEMORY, run: (c) => write(c, addressOf(c), accu1(c)) },
  TAK: {
    operands: NONE,
    run: (c) => {
      const { accu1: a1, accu2: a2, leftBy } = c.cpu;
      const [left1, left2] = [leftBy.ACCU1, leftBy.ACCU2];
      c.cpu.accu1 = a2;
      c.cpu.accu2 = a1;
      delete leftBy.ACCU1;
      delete leftBy.ACCU2;
      if (left2) leftBy.ACCU1 = left2;
      if (left1) leftBy.ACCU2 = left1;
    },
  },
  PUSH: { operands: NONE, run: pushAccu },
  POP: {
    operands: NONE,
    run: (c) => {
      const left = c.cpu.leftBy.ACCU2;
      setAccu1(c, c.cpu.accu2);
      if (left) c.cpu.leftBy.ACCU1 = left;
    },
  },
  INC: { operands: ["constant"], run: (c) => setAccu1Byte(c, (accu1(c) & 0xff) + constant(c)) },
  DEC: { operands: ["constant"], run: (c) => setAccu1Byte(c, (accu1(c) & 0xff) - constant(c)) },
  "+": {
    operands: ["constant"],
    run: (c) => {
      const o = c.statement.operand;
      if (o.kind !== "constant") return;
      if (o.type === "DINT") setAccu1(c, int32(accu1(c)) + int32(o.pattern));
      else setAccu1Low(c, int16(accu1(c)) + int16(o.pattern));
    },
  },

  // integer arithmetic
  "+I": { operands: NONE, run: (c) => intOp(c, "+") },
  "-I": { operands: NONE, run: (c) => intOp(c, "-") },
  "*I": { operands: NONE, run: (c) => dintOp(c, "*I") },
  "/I": { operands: NONE, run: (c) => divOp(c, "/I") },
  "+D": { operands: NONE, run: (c) => dintOp(c, "+D") },
  "-D": { operands: NONE, run: (c) => dintOp(c, "-D") },
  "*D": { operands: NONE, run: (c) => dintOp(c, "*D") },
  "/D": { operands: NONE, run: (c) => divOp(c, "/D") },
  MOD: { operands: NONE, run: (c) => divOp(c, "MOD") },
  NEGI: { operands: NONE, run: (c) => negOp(c, 16) },
  NEGD: { operands: NONE, run: (c) => negOp(c, 32) },
  INVI: { operands: NONE, run: (c) => setAccu1Low(c, ~accu1(c)) },
  INVD: { operands: NONE, run: (c) => setAccu1(c, ~accu1(c)) },
  ITD: { operands: NONE, run: (c) => setAccu1(c, int16(accu1(c))) },
  DTR: { operands: NONE, run: (c) => setAccu1(c, realToBits(int32(accu1(c)))) },

  // REAL arithmetic
  "+R": { operands: NONE, run: (c) => realResult(c, real(accu2(c)) + real(accu1(c))) },
  "-R": { operands: NONE, run: (c) => realResult(c, real(accu2(c)) - real(accu1(c))) },
  "*R": { operands: NONE, run: multiplyReal },
  "/R": { operands: NONE, run: divideReal },
  ABS: { operands: NONE, run: (c) => setAccu1(c, accu1(c) & 0x7fffffff) },
  NEGR: { operands: NONE, run: (c) => setAccu1(c, accu1(c) ^ 0x80000000) },
  SQR: realUnary(
    (x) => x * x,
    (b) => nanIn(b) ?? (infinite(b) ? "keep" : undefined),
  ),
  SQRT: realUnary(Math.sqrt, (b, x) => nanIn(b) ?? (infinite(b) ? "keep" : x < 0 ? NAN_BITS : undefined)),
  EXP: realUnary(
    Math.exp,
    (b) => nanIn(b) ?? (infinite(b) ? "keep" : (b & 0x80000000) === 0 && b > 0x42b00000 ? POS_INF : undefined),
  ),
  LN: realUnary(Math.log, (b, x) => nanIn(b) ?? (infinite(b) ? "keep" : x <= 0 ? NAN_BITS : undefined)),
  SIN: realUnary(
    (x) => snapped(Math.sin(x)),
    (b) => nanIn(b) ?? (infinite(b) || b === NEG_ZERO ? "keep" : undefined),
  ),
  COS: realUnary(
    (x) => snapped(Math.cos(x)),
    (b) => nanIn(b) ?? (infinite(b) ? "keep" : undefined),
  ),
  TAN: realUnary(
    (x) => snapped(Math.tan(x)),
    (b, x) =>
      nanIn(b) ??
      (infinite(b) || b === NEG_ZERO
        ? "keep"
        : Math.abs(x - Math.PI / 2) < 1e-7
          ? POS_INF
          : Math.abs(x + Math.PI / 2) < 1e-7
            ? NEG_INF
            : undefined),
  ),
  ASIN: realUnary(Math.asin, (b, x) => (infinite(b) ? "keep" : isNaNBits(b) || x > 1 || x < -1 ? NAN_BITS : undefined)),
  ACOS: realUnary(Math.acos, (b, x) => (infinite(b) ? "keep" : isNaNBits(b) || x > 1 || x < -1 ? NAN_BITS : undefined)),
  ATAN: realUnary(Math.atan, (b) => nanIn(b) ?? (infinite(b) ? "keep" : undefined)),
  RND: { operands: NONE, run: (c) => convert(c, "nearest") },
  "RND+": { operands: NONE, run: (c) => convert(c, "up") },
  "RND-": { operands: NONE, run: (c) => convert(c, "down") },
  TRUNC: { operands: NONE, run: (c) => convert(c, "toward-zero") },

  ...compares,

  // word logic, shifts and rotates
  AW: { operands: CONSTANT_OR_NONE, run: (c) => wordLogic(c, "AND", 16) },
  OW: { operands: CONSTANT_OR_NONE, run: (c) => wordLogic(c, "OR", 16) },
  XOW: { operands: CONSTANT_OR_NONE, run: (c) => wordLogic(c, "XOR", 16) },
  AD: { operands: CONSTANT_OR_NONE, run: (c) => wordLogic(c, "AND", 32) },
  OD: { operands: CONSTANT_OR_NONE, run: (c) => wordLogic(c, "OR", 32) },
  XOD: { operands: CONSTANT_OR_NONE, run: (c) => wordLogic(c, "XOR", 32) },
  SLW: { operands: CONSTANT_OR_NONE, run: (c) => shift(c, "SLW") },
  SRW: { operands: CONSTANT_OR_NONE, run: (c) => shift(c, "SRW") },
  SLD: { operands: CONSTANT_OR_NONE, run: (c) => shift(c, "SLD") },
  SRD: { operands: CONSTANT_OR_NONE, run: (c) => shift(c, "SRD") },
  SSI: { operands: CONSTANT_OR_NONE, run: (c) => shift(c, "SSI") },
  SSD: { operands: CONSTANT_OR_NONE, run: (c) => shift(c, "SSD") },
  RLD: { operands: CONSTANT_OR_NONE, run: (c) => rotate(c, true) },
  RRD: { operands: CONSTANT_OR_NONE, run: (c) => rotate(c, false) },
  RLDA: { operands: NONE, run: (c) => rotateThroughCc1(c, true) },
  RRDA: { operands: NONE, run: (c) => rotateThroughCc1(c, false) },

  // jumps
  JU: { operands: LABEL, run: jumpTo },
  JC: { operands: LABEL, run: (c) => rloJump(c, true, false) },
  JCN: { operands: LABEL, run: (c) => rloJump(c, false, false) },
  JCB: { operands: LABEL, run: (c) => rloJump(c, true, true) },
  JNB: { operands: LABEL, run: (c) => rloJump(c, false, true) },
  JBI: { operands: LABEL, run: (c) => brJump(c, true) },
  JNBI: { operands: LABEL, run: (c) => brJump(c, false) },
  JO: { operands: LABEL, run: (c) => (bit(c, "OV") ? jumpTo(c) : undefined) },
  JOS: {
    operands: LABEL,
    run: (c) => {
      if (!bit(c, "OS")) return;
      jumpTo(c);
      setBits(c, { OS: 0 });
    },
  },
  JZ: { operands: LABEL, run: (c) => ccJump(c, (cc1, cc0) => (cc1 | cc0) === 0) },
  JN: { operands: LABEL, run: (c) => ccJump(c, (cc1, cc0) => (cc1 ^ cc0) === 1) },
  JP: { operands: LABEL, run: (c) => ccJump(c, (cc1, cc0) => cc1 === 1 && cc0 === 0) },
  JM: { operands: LABEL, run: (c) => ccJump(c, (cc1, cc0) => cc1 === 0 && cc0 === 1) },
  JPZ: { operands: LABEL, run: (c) => ccJump(c, (_, cc0) => cc0 === 0) },
  JMZ: { operands: LABEL, run: (c) => ccJump(c, (cc1) => cc1 === 0) },
  JUO: { operands: LABEL, run: (c) => ccJump(c, (cc1, cc0) => (cc1 & cc0) === 1) },
  LOOP: {
    operands: LABEL,
    run: (c) => {
      const count = ((accu1(c) & 0xffff) - 1) & 0xffff;
      setAccu1Low(c, count);
      if (count !== 0) jumpTo(c);
    },
  },

  // address register 1
  LAR1: {
    operands: ["none", "constant", "address"],
    run: (c) => {
      c.cpu.ar1 = (c.statement.operand.kind === "none" ? accu1(c) : loadValue(c)) >>> 0;
      delete c.cpu.leftBy.AR1;
    },
  },
  TAR1: {
    operands: ["none", "address"],
    run: (c) => {
      known(c, "AR1");
      if (c.statement.operand.kind !== "none") write(c, addressOf(c), c.cpu.ar1);
      else {
        pushAccu(c);
        setAccu1(c, c.cpu.ar1);
      }
    },
  },
  "+AR1": {
    operands: ["none", "constant"],
    run: (c) => {
      const o = c.statement.operand;
      const by = o.kind === "constant" ? o.pattern : int16(accu1(c));
      known(c, "AR1");
      const ar = c.cpu.ar1;
      c.cpu.ar1 = ((ar & 0xff000000) | (((ar & 0x00ffffff) + by) & 0x00ffffff)) >>> 0;
    },
  },

  // block end, no operation, library calls
  BE: { operands: NONE, run: blockEnd },
  BEU: { operands: NONE, run: blockEnd },
  BEC: {
    operands: NONE,
    run: (c) => (bit(c, "RLO") ? blockEnd(c) : setBits(c, { OR: 0, STA: 1, RLO: 1, "/FC": 0 })),
  },
  NOP: { operands: ["constant"], run: () => {} },
  CALL: { operands: ["block"], run: call },
};

function constant(c: Context): number {
  const o = c.statement.operand;
  if (o.kind !== "constant") throw new Error(`${c.statement.op} needs a constant`);
  return o.pattern;
}

const SHIFTS = /^(S[LR][WD]|SS[ID]|R[LR]D)$/;

/** Why the interpreter can't run a statement, or `undefined` when it can. */
export function unsupported(s: Statement): string | undefined {
  const instruction = INSTRUCTIONS[s.op];
  if (!instruction) return `${s.op} isn't an instruction this interpreter runs yet`;
  const o = s.operand;
  if (o.kind === "unknown") return `${s.op} can't read the operand "${o.text}"`;
  if (!instruction.operands.includes(o.kind))
    return o.kind === "none" ? `${s.op} needs an operand` : `${s.op} doesn't take the operand "${s.text}"`;
  if (o.kind === "address") {
    const a = o.address;
    if (a.peripheral && s.op !== "L") return `${s.op} ${s.text}: only L reads a peripheral input`;
    if ((s.op === "L" || s.op === "T") && a.width === "bit")
      return `${s.op} takes a byte, word or double word, not the bit ${s.text}`;
    if ((s.op === "LAR1" || s.op === "TAR1") && a.width !== "dword") return `${s.op} takes a double word`;
    if (a.width !== "bit" && /^(A|AN|O|ON|X|XN|=|S|R|FP|FN)$/.test(s.op)) return `${s.op} takes a bit, not ${s.text}`;
  }
  if (o.kind === "indirect" && (s.op === "L" || s.op === "T") === (o.width === "bit"))
    return `${s.op} doesn't take the operand "${s.text}"`;
  if (o.kind === "constant") {
    if ((s.op === "INC" || s.op === "DEC") && (o.type !== "INT" || o.pattern > 255))
      return `${s.op} takes a constant 0 to 255`;
    if (s.op === "+" && o.type !== "INT" && o.type !== "DINT") return "+ takes an INT or DINT constant";
    if (s.op === "NOP" && (o.type !== "INT" || o.pattern > 1)) return "NOP takes 0 or 1";
    if (/^(AW|OW|XOW)$/.test(s.op) && o.type !== "WORD") return `${s.op} takes a W#16# constant`;
    if (/^(AD|OD|XOD)$/.test(s.op) && o.type !== "DWORD") return `${s.op} takes a DW#16# constant`;
    if (SHIFTS.test(s.op) && (o.type !== "INT" || o.pattern > 32)) return `${s.op} takes a count 0 to 32`;
    if ((s.op === "LAR1" || s.op === "+AR1") && o.type !== "POINTER") return `${s.op} takes a P# pointer`;
  }
  if (o.kind === "block" && !LIBRARY[o.number])
    return `CALL FC ${o.number}: FC105 and FC106 are the only blocks this interpreter calls`;
  return undefined;
}

/** Runs the statement at `cpu.pc` and moves `pc` on; returns what it did. Throws on a statement it can't run. */
export function execute(cpu: Cpu, program: Program): { statement: Statement; effect: Effect } {
  const statement = program.statements[cpu.pc];
  if (!statement) throw new Error("OB 1 has no statement left to run");
  const why = unsupported(statement);
  if (why) throw new Error(`line ${statement.line + 1}: ${why}`);
  const effect: Effect = { writes: [] };
  try {
    INSTRUCTIONS[statement.op]?.run({ cpu, program, statement, effect });
  } catch (error) {
    throw new Error(`line ${statement.line + 1}: ${(error as Error).message}`, { cause: error });
  }
  cpu.pc = effect.jumpedTo ?? cpu.pc + 1;
  if (cpu.pc >= program.statements.length) cpu.ended = true;
  return { statement, effect };
}
