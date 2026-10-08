// The blind SCL interpreter: the build oracle for the page's SCL sims (ticket #55).
//
// A second interpreter for Siemens S7-SCL (STEP 7 V5.x classic, S7-300/400), written only from the
// manual "S7-SCL V5.3 for S7-300/400" (A5E00324650-01) and never from the page's own interpreter, so
// the two can be run on the same listing and compared. Its whole value is that independence.
// Citations name the manual's chapter and section title ("§11 Arithmetic Expressions"); where V5.3 is
// silent and Siemens' S7-300/400 SCL help in TIA Portal speaks, that is cited as "TIA S7-300/400 help".
//
// Policy: where the manual says a result is undefined, or says nothing about it, the scan comes back
// `stopped` with the point and the manual's position instead of an invented value, and no later scan
// runs. A listing it can't run (syntax error, unsupported construct, type error) throws.

export type BlindType = "BOOL" | "BYTE" | "WORD" | "DWORD" | "INT" | "DINT" | "REAL";
/** BOOL 0|1; BYTE/WORD/DWORD unsigned; INT/DINT signed; REAL the float32 value as a JS number (−0 and NaN kept; compared with Object.is). */
export interface BlindValue {
  type: BlindType;
  value: number;
}
export type BlindScan =
  | { values: Record<string, BlindValue> }
  /** The manual leaves the result undefined (or says nothing) here: no value is invented and no later scan runs. line is 1-based in the source. */
  | { stopped: { line: number; point: string; manual: string } };
export interface BlindRequest {
  /** The listing: any TYPE (UDT), DATA_BLOCK, FUNCTION and FUNCTION_BLOCK units, in any order. */
  source: string;
  /** The FUNCTION_BLOCK each scan calls once (one instance). */
  block: string;
  /** Each scan's VAR_INPUT values by name (BOOL as 0/1, REAL as a number). An input a scan doesn't name keeps its last value (first scan: its declared initial value, else 0). */
  scans: Record<string, number>[];
}

// ---------------------------------------------------------------- errors

/** The listing can't be run: thrown out of runBlind as "line N: …". */
class SclError extends Error {
  line = 0;
}
/** The manual leaves this result undefined or says nothing about it: the scan stops here. */
class Stop extends Error {
  line = 0;
  point: string;
  manual: string;
  constructor(point: string, manual: string) {
    super(point);
    this.point = point;
    this.manual = manual;
  }
}
function fail(message: string, line = 0): never {
  const e = new SclError(message);
  e.line = line;
  throw e;
}
function typeErr(message: string): never {
  return fail(`type error: ${message}`);
}
function stop(point: string, manual: string): never {
  throw new Stop(point, manual);
}
function at<T>(xs: readonly T[], i: number): T {
  const x = xs[i];
  if (x === undefined) fail(`internal: no element ${i}`);
  return x;
}

// The manual's positions, shared by several stop sites.
const M_INT_RANGE =
  "§7 Elementary Data Types: INT is -32768..32767 and DINT -2147483648..2147483647; §8 'OK flag': an overflow only sets OK to FALSE; the manual gives no result value";
const M_REAL_RANGE =
  "§7 Elementary Data Types: REAL is ±1.175495e-38..±3.402823e+38 and 0; the manual gives no value outside that range (an error only sets the OK flag)";
const M_TEMP =
  "§8 Declaring Temporary Variables: VAR_TEMP lives on the local stack, cannot be initialised and has no defined value until written";

// ---------------------------------------------------------------- types and values

interface ElemT {
  k: BlindType;
}
interface ArrayT {
  k: "ARRAY";
  dims: [number, number][];
  of: SclType;
}
interface StructT {
  k: "STRUCT";
  fields: Field[];
  map: Map<string, Field>;
}
type SclType = ElemT | ArrayT | StructT;
interface Field {
  name: string;
  key: string;
  type: SclType;
  init: InitItem[] | null;
  env: ConstEnv;
}
type ConstEnv = Map<string, TV>;

const ELEMS: readonly BlindType[] = ["BOOL", "BYTE", "WORD", "DWORD", "INT", "DINT", "REAL"];
const isBlindType = (s: string): s is BlindType => (ELEMS as readonly string[]).includes(s);
const isElem = (t: SclType): t is ElemT => t.k !== "ARRAY" && t.k !== "STRUCT";
const ET = {
  BOOL: { k: "BOOL" },
  BYTE: { k: "BYTE" },
  WORD: { k: "WORD" },
  DWORD: { k: "DWORD" },
  INT: { k: "INT" },
  DINT: { k: "DINT" },
  REAL: { k: "REAL" },
} satisfies Record<BlindType, ElemT>;

/** Elementary leaves are numbers (undefined = a VAR_TEMP or function value not yet written); arrays and structs are boxes keyed by declared index or member key. */
type Data = number | undefined | Box;
interface Box {
  [key: string]: Data;
}
/** A typed value; lit = an untyped constant, whose type adapts to its use (§9 Data types of constants). */
interface TV {
  t: SclType;
  v: Data;
  lit: boolean;
}
/** Where a variable lives: area tells a never-written VAR_TEMP and function value apart from data. */
interface Ref {
  type: SclType;
  obj: Box;
  key: string;
  area: "data" | "temp" | "ret";
}

function child(d: Data): Box {
  if (typeof d !== "object") fail("internal: container expected");
  return d;
}
function num(x: TV): number {
  if (typeof x.v !== "number") fail("internal: elementary value expected");
  return x.v;
}
function elemKind(x: TV): BlindType {
  if (!isElem(x.t)) return typeErr(`an ${x.t.k} is used where an elementary value is needed`);
  return x.t.k;
}
function clone(d: Data): Data {
  if (typeof d !== "object") return d;
  const o: Box = {};
  for (const k of Object.keys(d)) o[k] = clone(d[k]);
  return o;
}
function copyInto(dst: Box, src: Box): void {
  for (const k of Object.keys(src)) {
    const s = src[k];
    if (typeof s === "object") copyInto(child(dst[k]), s);
    else dst[k] = s;
  }
}
function sameData(a: Data, b: Data): boolean {
  if (typeof a !== "object" || typeof b !== "object") return Object.is(a, b);
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => sameData(a[k], b[k]));
}
const hasUnwritten = (d: Data): boolean =>
  d === undefined || (typeof d === "object" && Object.values(d).some(hasUnwritten));
const sameTV = (a: TV, b: TV): boolean => a.t.k === b.t.k && sameData(a.v, b.v);

function sameType(a: SclType, b: SclType): boolean {
  if (a === b) return true;
  if (isElem(a) || isElem(b)) return a.k === b.k;
  if (a.k === "ARRAY" && b.k === "ARRAY")
    return (
      a.dims.length === b.dims.length &&
      a.dims.every((d, i) => d[0] === at(b.dims, i)[0] && d[1] === at(b.dims, i)[1]) &&
      sameType(a.of, b.of)
    );
  if (a.k === "STRUCT" && b.k === "STRUCT")
    return (
      a.fields.length === b.fields.length &&
      a.fields.every((f, i) => f.key === at(b.fields, i).key && sameType(f.type, at(b.fields, i).type))
    );
  return false;
}

// ---------------------------------------------------------------- numerics

const RANGE: Record<BlindType, [number, number]> = {
  BOOL: [0, 1],
  BYTE: [0, 0xff],
  WORD: [0, 0xffff],
  DWORD: [0, 0xffffffff],
  INT: [-32768, 32767],
  DINT: [-2147483648, 2147483647],
  REAL: [-Infinity, Infinity],
};
const inRange = (k: BlindType, v: number) => v >= RANGE[k][0] && v <= RANGE[k][1];
// Class A implicit conversions run INT -> DINT -> REAL and BOOL -> BYTE -> WORD -> DWORD (§14 Data Type Conversion Functions).
const NUM_RANK: Partial<Record<BlindType, number>> = { INT: 1, DINT: 2, REAL: 3 };
const BIT_RANK: Partial<Record<BlindType, number>> = { BOOL: 1, BYTE: 2, WORD: 3, DWORD: 4 };
const WIDTH: Partial<Record<BlindType, number>> = { BYTE: 8, WORD: 16, DWORD: 32 };
const maskOf = (k: BlindType) => (k === "BYTE" ? 0xff : k === "WORD" ? 0xffff : 0xffffffff);
const SMALLEST_NORMAL = 2 ** -126;

/** An untyped integer constant takes the smallest type that holds it (§9 Data types of constants). */
function litInt(v: number): TV {
  const r = v + 0;
  const k: BlindType | null = inRange("INT", r)
    ? "INT"
    : inRange("DINT", r)
      ? "DINT"
      : inRange("DWORD", r)
        ? "DWORD"
        : null;
  if (!k || !Number.isInteger(r)) return fail(`integer constant ${v} is out of range`);
  return { t: ET[k], v: r, lit: true };
}

/** A REAL operand must be a REAL of the manual's range: NaN, infinities and denormals are not (§7). */
function realOperand(x: number, what: string): number {
  const r = Math.fround(x);
  if (Number.isNaN(r) || !Number.isFinite(r) || (r !== 0 && Math.abs(r) < SMALLEST_NORMAL))
    stop(`${what} on a REAL operand outside the REAL range (${String(r)})`, M_REAL_RANGE);
  return r;
}
/** REAL arithmetic is 32-bit IEEE: every result is rounded to float32 and must stay in the REAL range (§7). */
function realResult(x: number, what: string): number {
  const r = Math.fround(x);
  if (Number.isNaN(r)) stop(`${what} gives no REAL number (NaN)`, M_REAL_RANGE);
  if (!Number.isFinite(r)) stop(`${what} leaves the REAL range (overflow)`, M_REAL_RANGE);
  if (r !== 0 && Math.abs(r) < SMALLEST_NORMAL) stop(`${what} falls below the smallest REAL (underflow)`, M_REAL_RANGE);
  return r;
}

function arith(op: string, a: TV, b: TV): TV {
  const ka = elemKind(a);
  const kb = elemKind(b);
  const ra = NUM_RANK[ka];
  const rb = NUM_RANK[kb];
  if (ra === undefined || rb === undefined)
    return typeErr(`'${op}' needs INT, DINT or REAL operands, got ${ka} and ${kb} (§11 Arithmetic Expressions)`);
  const x = num(a);
  const y = num(b);
  // '**' always gives a REAL, whatever its operands (§11 Arithmetic Expressions, operation table).
  if (op === "**") {
    const p = realOperand(x, "**");
    const q = realOperand(y, "**");
    if (p === 0 && q <= 0)
      stop("0 ** 0 or 0 to a negative power", "§11 Arithmetic Expressions: the manual gives no value");
    if (p < 0 && !Number.isInteger(q))
      stop("a negative base to a fractional power", "§11 Arithmetic Expressions: the manual gives no value");
    return { t: ET.REAL, v: realResult(Math.pow(p, q), "**"), lit: false };
  }
  // The more powerful operand type is the type of the operation and its result (§11 Arithmetic Expressions).
  const k = ra >= rb ? ka : kb;
  if (k === "REAL") {
    if (op === "MOD" || op === "DIV")
      return typeErr(`${op} is only defined for INT and DINT (§11 Arithmetic Expressions)`);
    const p = realOperand(x, `REAL ${op}`);
    const q = realOperand(y, `REAL ${op}`);
    if (op === "/" && q === 0) stop("REAL division by 0", M_REAL_RANGE);
    const r = op === "+" ? p + q : op === "-" ? p - q : op === "*" ? p * q : p / q;
    return { t: ET.REAL, v: realResult(r, `REAL ${op}`), lit: a.lit && b.lit };
  }
  if (op === "/" || op === "DIV" || op === "MOD") {
    if (y === 0)
      stop(
        `integer ${op} by 0`,
        "§11 Arithmetic Expressions / §8 'OK flag': division by 0 is an error that sets OK to FALSE; the manual gives no result",
      );
    // INT / INT is an INT with the decimals dropped ("10/3 = 3"); for a negative operand the manual never says
    // whether the quotient rounds toward 0 or down, nor which sign MOD takes, so only exact cases are defined.
    if ((x < 0 || y < 0) && x % y !== 0)
      stop(
        `integer ${op} with a negative operand and a remainder (${x} ${op} ${y})`,
        "§11 Arithmetic Expressions: only '10/3 = 3' is shown; rounding of a negative quotient and the sign of MOD are not given",
      );
  }
  const r =
    (op === "+" ? x + y : op === "-" ? x - y : op === "*" ? x * y : op === "MOD" ? x % y : Math.trunc(x / y)) + 0;
  // Two constants form a constant expression the compiler folds; it is typed by its value like any constant.
  if (a.lit && b.lit) return litInt(r);
  if (!inRange(k, r)) stop(`${k} overflow: ${x} ${op} ${y} = ${r}`, M_INT_RANGE);
  return { t: ET[k], v: r, lit: false };
}

const bitLike = (a: TV) => isElem(a.t) && (BIT_RANK[a.t.k] !== undefined || (a.lit && a.t.k !== "REAL" && num(a) >= 0));

function compare(op: string, a: TV, b: TV): TV {
  const ka = elemKind(a);
  const kb = elemKind(b);
  let x = num(a);
  let y = num(b);
  if (NUM_RANK[ka] !== undefined && NUM_RANK[kb] !== undefined) {
    // Mixed operands compare in the more powerful type (§11 Comparison Expressions).
    if (ka === "REAL" || kb === "REAL") {
      x = realOperand(x, "comparison");
      y = realOperand(y, "comparison");
    }
  } else if (bitLike(a) && bitLike(b)) {
    if (op !== "=" && op !== "<>")
      typeErr(`only = and <> compare bit-string values (§11 Comparison Expressions), not '${op}'`);
  } else typeErr(`${ka} cannot be compared with ${kb} (§11 Comparison Expressions)`);
  const r =
    op === "="
      ? x === y
      : op === "<>"
        ? x !== y
        : op === "<"
          ? x < y
          : op === ">"
            ? x > y
            : op === "<="
              ? x <= y
              : x >= y;
  return { t: ET.BOOL, v: r ? 1 : 0, lit: false };
}

function logic(op: string, a: TV, b: TV): TV {
  if (!bitLike(a) || !bitLike(b))
    typeErr(`${op} needs BOOL, BYTE, WORD or DWORD operands (§11 Logical Expressions), got ${a.t.k} and ${b.t.k}`);
  // The result has the more powerful of the typed operands' types; constants adapt to it.
  const typed = [a, b].filter((x) => !x.lit).map((x) => elemKind(x));
  typed.sort((p, q) => (BIT_RANK[q] ?? 0) - (BIT_RANK[p] ?? 0));
  const k = typed[0] ?? "DWORD";
  const x = num(a);
  const y = num(b);
  if (k === "BOOL") {
    for (const c of [a, b]) if (c.lit && num(c) !== 0 && num(c) !== 1) typeErr(`constant ${num(c)} is not a BOOL`);
    const r = op === "AND" ? x & y : op === "OR" ? x | y : x ^ y;
    return { t: ET.BOOL, v: r, lit: false };
  }
  for (const c of [a, b]) if (c.lit && num(c) > maskOf(k)) typeErr(`constant ${num(c)} does not fit ${k}`);
  const r = op === "AND" ? x & y : op === "OR" ? x | y : x ^ y;
  return { t: ET[k], v: (r & maskOf(k)) >>> 0, lit: a.lit && b.lit };
}

function unary(op: string, a: TV): TV {
  const k = elemKind(a);
  const v = num(a);
  if (op === "NOT") {
    if (a.lit) return typeErr("NOT of an untyped constant has no defined width; use a typed constant (W#16#...)");
    if (k === "BOOL") return { t: ET.BOOL, v: 1 - v, lit: false };
    if (WIDTH[k] !== undefined) return { t: ET[k], v: (~v & maskOf(k)) >>> 0, lit: false };
    return typeErr(`NOT needs BOOL, BYTE, WORD or DWORD (§11 Logical Expressions), got ${k}`);
  }
  if (NUM_RANK[k] === undefined)
    return typeErr(`unary ${op} needs INT, DINT or REAL (§11 Arithmetic Expressions), got ${k}`);
  if (op === "+") return a;
  if (k === "REAL")
    return { t: ET.REAL, v: v === 0 ? -v : realResult(-realOperand(v, "unary -"), "unary -"), lit: a.lit };
  if (a.lit) return litInt(-v);
  if (!inRange(k, -v)) stop(`${k} overflow: -(${v})`, M_INT_RANGE);
  return { t: ET[k], v: -v + 0, lit: false };
}

const ARITH = new Set(["+", "-", "*", "/", "**", "MOD", "DIV"]);
const CMP = new Set(["<", ">", "<=", ">=", "=", "<>"]);
function binary(op: string, a: TV, b: TV): TV {
  if (ARITH.has(op)) return arith(op, a, b);
  if (CMP.has(op)) return compare(op, a, b);
  return logic(op, a, b);
}

/** A condition is a BOOL, or an arithmetic expression that is TRUE when not 0 (§12 Conditions). */
function cond(x: TV): boolean {
  const k = elemKind(x);
  if (k === "BOOL") return num(x) !== 0;
  if (k === "REAL") return realOperand(num(x), "condition") !== 0;
  if (NUM_RANK[k] !== undefined) return num(x) !== 0;
  return typeErr(`a condition must be BOOL or arithmetic (§12 Conditions), got ${k}`);
}

/** Assignment conversion: equal types, the class A implicit widenings, or a constant that fits (§12 Value Assignments, §14). */
function conv(x: TV, t: SclType): Data {
  if (!isElem(t)) {
    if (!sameType(x.t, t))
      typeErr(`a ${x.t.k} cannot be assigned to a ${t.k}: complex assignments need identical types`);
    if (hasUnwritten(x.v)) stop("a structure or array with never-written VAR_TEMP elements is copied", M_TEMP);
    return clone(x.v);
  }
  const s = elemKind(x);
  const k = t.k;
  const v = num(x);
  if (s === k) return v;
  if (x.lit && s !== "REAL") {
    if (k === "REAL") return Math.fround(v);
    if (inRange(k, v)) return v;
    return typeErr(`constant ${v} does not fit ${k}`);
  }
  const ns = NUM_RANK[s];
  const nk = NUM_RANK[k];
  if (ns !== undefined && nk !== undefined && ns < nk) return k === "REAL" ? Math.fround(v) : v;
  const bs = BIT_RANK[s];
  const bk = BIT_RANK[k];
  if (bs !== undefined && bk !== undefined && bs < bk) return v;
  return typeErr(`no implicit conversion from ${s} to ${k} (§14 class A conversions); use a conversion function`);
}

// ---------------------------------------------------------------- standard functions (§14)

const f32 = new DataView(new ArrayBuffer(4));
function realBits(x: number): number {
  f32.setFloat32(0, x);
  return f32.getUint32(0);
}
function bitsReal(w: number): number {
  f32.setUint32(0, w);
  return f32.getFloat32(0);
}

// ROUND rounds to the nearest integer; V5.3 doesn't settle a tie, Siemens' S7-300/400 SCL help does: "the
// even number is selected" (TIA S7-300/400 help, ROUND). REAL_TO_INT/REAL_TO_DINT "round" the same way (§14 class B).
function roundHalfEven(x: number): number {
  const f = Math.floor(x);
  const d = x - f;
  return (d > 0.5 ? f + 1 : d < 0.5 ? f : f % 2 === 0 ? f : f + 1) + 0;
}
const toRange = (what: string, k: BlindType) => (v: number) => {
  if (!Number.isFinite(v) || !inRange(k, v))
    stop(
      `${what}: ${String(v)} is outside the ${k} range`,
      "§14 Data Type Conversion Functions (class B): out of range only sets the OK flag to FALSE; the manual gives no result value",
    );
  return v + 0;
};
function realIn(what: string) {
  return (v: number) => {
    if (Number.isNaN(v) || !Number.isFinite(v)) stop(`${what} of a REAL that is not a number`, M_REAL_RANGE);
    return v;
  };
}

type Conversion = [string, BlindType, BlindType, (v: number) => number];
const CONVERSIONS: Conversion[] = [
  // Class A (implicit) conversions may also be called explicitly (§14).
  ["BOOL_TO_BYTE", "BOOL", "BYTE", (v) => v],
  ["BOOL_TO_WORD", "BOOL", "WORD", (v) => v],
  ["BOOL_TO_DWORD", "BOOL", "DWORD", (v) => v],
  ["BYTE_TO_WORD", "BYTE", "WORD", (v) => v],
  ["BYTE_TO_DWORD", "BYTE", "DWORD", (v) => v],
  ["WORD_TO_DWORD", "WORD", "DWORD", (v) => v],
  ["INT_TO_DINT", "INT", "DINT", (v) => v],
  ["INT_TO_REAL", "INT", "REAL", Math.fround],
  ["DINT_TO_REAL", "DINT", "REAL", Math.fround],
  // Class B (explicit only), with the manual's conversion rules (§14 Data Type Conversion Functions).
  ["BYTE_TO_BOOL", "BYTE", "BOOL", (v) => v & 1], // "copies the least significant bit"
  ["WORD_TO_BOOL", "WORD", "BOOL", (v) => v & 1],
  ["DWORD_TO_BOOL", "DWORD", "BOOL", (v) => v & 1],
  ["WORD_TO_BYTE", "WORD", "BYTE", (v) => v & 0xff], // "copies the 8 least significant bits"
  ["DWORD_TO_BYTE", "DWORD", "BYTE", (v) => v & 0xff],
  ["DWORD_TO_WORD", "DWORD", "WORD", (v) => v & 0xffff], // "copies the 16 least significant bits"
  ["WORD_TO_INT", "WORD", "INT", (v) => (v << 16) >> 16], // "takes over the bit string"
  ["INT_TO_WORD", "INT", "WORD", (v) => v & 0xffff], // "takes over the bit string"
  ["DINT_TO_DWORD", "DINT", "DWORD", (v) => v >>> 0],
  ["DWORD_TO_DINT", "DWORD", "DINT", (v) => v | 0],
  ["DINT_TO_INT", "DINT", "INT", toRange("DINT_TO_INT", "INT")],
  ["REAL_TO_INT", "REAL", "INT", (v) => toRange("REAL_TO_INT", "INT")(roundHalfEven(realIn("REAL_TO_INT")(v)))],
  ["REAL_TO_DINT", "REAL", "DINT", (v) => toRange("REAL_TO_DINT", "DINT")(roundHalfEven(realIn("REAL_TO_DINT")(v)))],
  ["REAL_TO_DWORD", "REAL", "DWORD", realBits], // "takes over the bit string"
  ["DWORD_TO_REAL", "DWORD", "REAL", bitsReal],
  // Rounding and truncation form a DINT (§14 Data Type Conversion Functions, rounding and truncating).
  ["ROUND", "REAL", "DINT", (v) => toRange("ROUND", "DINT")(roundHalfEven(realIn("ROUND")(v)))],
  // TRUNC keeps only the integer part: -1.5 gives -1 (TIA S7-300/400 help, TRUNC; V5.3 just says "truncating").
  ["TRUNC", "REAL", "DINT", (v) => toRange("TRUNC", "DINT")(Math.trunc(realIn("TRUNC")(v)))],
];

/** Numeric standard functions take ANY_NUM and give a REAL (§14 Numeric Standard Functions). */
function realFn(name: string, f: (x: number) => number) {
  return (a: TV): TV => {
    if (NUM_RANK[elemKind(a)] === undefined) typeErr(`${name} needs a numeric argument (§14), got ${a.t.k}`);
    return { t: ET.REAL, v: realResult(f(realOperand(num(a), name)), name), lit: false };
  };
}
const STD1 = new Map<string, (a: TV) => TV>([
  ["SQR", realFn("SQR", (x) => x * x)],
  ["SQRT", realFn("SQRT", Math.sqrt)],
  ["EXP", realFn("EXP", Math.exp)],
  ["EXPD", realFn("EXPD", (x) => 10 ** x)],
  ["LN", realFn("LN", Math.log)],
  ["LOG", realFn("LOG", Math.log10)],
  ["SIN", realFn("SIN", Math.sin)],
  ["COS", realFn("COS", Math.cos)],
  ["TAN", realFn("TAN", Math.tan)],
  ["ASIN", realFn("ASIN", Math.asin)],
  ["ACOS", realFn("ACOS", Math.acos)],
  ["ATAN", realFn("ATAN", Math.atan)],
  [
    "ABS",
    (a) => {
      // ABS keeps its argument's type (§14 Numeric Standard Functions).
      const k = elemKind(a);
      const v = num(a);
      if (NUM_RANK[k] === undefined) return typeErr(`ABS needs a numeric argument (§14), got ${k}`);
      if (k === "REAL") return { t: ET.REAL, v: Math.abs(realOperand(v, "ABS")), lit: a.lit };
      if (a.lit) return litInt(Math.abs(v));
      if (!inRange(k, Math.abs(v))) stop(`${k} overflow: ABS(${v})`, M_INT_RANGE);
      return { t: ET[k], v: Math.abs(v), lit: false };
    },
  ],
  ...CONVERSIONS.map(([name, from, to, f]): [string, (a: TV) => TV] => [
    name,
    (a) => {
      const v = conv(a, ET[from]);
      if (typeof v !== "number") return fail("internal: conversion of a complex value");
      return { t: ET[to], v: f(v), lit: false };
    },
  ]),
]);
const SHIFTS = new Set(["SHL", "SHR", "ROL", "ROR"]);
const isStd = (name: string) => STD1.has(name.toUpperCase()) || SHIFTS.has(name.toUpperCase());

/** Bit-string functions: IN is BYTE, WORD or DWORD and gives the result's type; N is an INT (§14 Bit String Standard Functions). */
function shift(name: string, a: TV, n: TV): TV {
  const k = elemKind(a);
  const w = WIDTH[k];
  if (a.lit || w === undefined)
    return typeErr(`${name}: IN must be a typed BYTE, WORD or DWORD, got ${a.lit ? "a constant" : k}`);
  if (elemKind(n) !== "INT") typeErr(`${name}: N must be an INT, got ${n.t.k}`);
  const v = num(a);
  const s = num(n);
  if (s < 0)
    stop(
      `${name} by a negative N (${s})`,
      "§14 Bit String Standard Functions: N is a bit count; a negative N is not covered",
    );
  const mask = maskOf(k);
  let r: number;
  // The vacated bits fill with zeros, so shifting by the width or more leaves 0; a rotation is periodic in the width.
  if (name === "SHL") r = s >= w ? 0 : ((v << s) & mask) >>> 0;
  else if (name === "SHR") r = s >= w ? 0 : v >>> s;
  else {
    const q = s % w;
    r = q === 0 ? v : name === "ROL" ? ((v << q) | (v >>> (w - q))) & mask : ((v >>> q) | (v << (w - q))) & mask;
  }
  return { t: ET[k], v: r >>> 0, lit: false };
}

// ---------------------------------------------------------------- lexer

interface Tok {
  t: "id" | "num" | "str" | "sym" | "eof";
  v: string;
  up: string;
  /** "quoted" symbol name, or #local. */
  q: boolean;
  h: boolean;
  tv: TV | null;
  line: number;
}
const PREFIX: Record<string, BlindType> = {
  B: "BYTE",
  BYTE: "BYTE",
  W: "WORD",
  WORD: "WORD",
  DW: "DWORD",
  DWORD: "DWORD",
  INT: "INT",
  DINT: "DINT",
  L: "DINT",
  REAL: "REAL",
  BOOL: "BOOL",
};
const isIdStart = (c: string | undefined) => c !== undefined && /[A-Za-z_]/.test(c);
const isDig = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9";

function lex(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  let line = 1;
  const push = (t: Tok["t"], v: string, extra: Partial<Tok> = {}) =>
    toks.push({ t, v, up: v.toUpperCase(), q: false, h: false, tv: null, line, ...extra });
  const readWhile = (re: RegExp) => {
    const s = i;
    while (i < src.length && re.test(src[i] ?? "")) i++;
    return src.slice(s, i);
  };
  function readNumber(): { v: number; real: boolean } {
    let s = readWhile(/[0-9_]/);
    if (src[i] === "#") {
      // Based integers 2#, 8#, 16# (§9 Integer literals).
      i++;
      const base = Number(s.replace(/_/g, ""));
      const digits = readWhile(/[0-9A-Fa-f_]/).replace(/_/g, "");
      const ok =
        (base === 2 && /^[01]+$/.test(digits)) ||
        (base === 8 && /^[0-7]+$/.test(digits)) ||
        (base === 16 && /^[0-9A-Fa-f]+$/.test(digits));
      if (!ok) fail(`bad based number ${s}#${digits}`, line);
      return { v: parseInt(digits, base), real: false };
    }
    let real = false;
    if (src[i] === "." && isDig(src[i + 1])) {
      i++;
      s += "." + readWhile(/[0-9_]/);
      real = true;
    }
    if (/[eE]/.test(src[i] ?? "") && (isDig(src[i + 1]) || (/[+-]/.test(src[i + 1] ?? "") && isDig(src[i + 2])))) {
      s += src[i++] ?? "";
      if (/[+-]/.test(src[i] ?? "")) s += src[i++] ?? "";
      s += readWhile(/[0-9]/);
      real = true;
    }
    return { v: Number(s.replace(/_/g, "")), real };
  }
  // Typed constants: B#16#.., W#16#.., DW#16#.., L#.., INT#.., REAL#.., BOOL#.. (§9 Literals).
  function typedLit(prefix: string, k: BlindType): TV {
    let sign = 1;
    if (src[i] === "-" || src[i] === "+") {
      if (src[i] === "-") sign = -1;
      i++;
    }
    if (k === "BOOL" && isIdStart(src[i])) {
      const w = readWhile(/[A-Za-z]/).toUpperCase();
      if (w !== "TRUE" && w !== "FALSE") fail(`bad BOOL# constant`, line);
      return { t: ET.BOOL, v: w === "TRUE" ? 1 : 0, lit: false };
    }
    if (!isDig(src[i])) fail(`bad ${prefix}# constant`, line);
    const n = readNumber();
    const v = sign * n.v + 0;
    if (k === "REAL") return { t: ET.REAL, v: Math.fround(v), lit: false };
    if (n.real) fail(`${prefix}# needs an integer`, line);
    if (!inRange(k, v)) fail(`${prefix}#${v} is out of range for ${k}`, line);
    return { t: ET[k], v, lit: false };
  }
  while (i < src.length) {
    const c = src[i] ?? "";
    if (c === "\n") {
      line++;
      i++;
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    // (* *) comments do not nest unless the "Permit nested comments" compiler option is set (§4 Customizing the Compiler).
    if (c === "(" && src[i + 1] === "*") {
      const start = line;
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === ")")) {
        if (src[i] === "\n") line++;
        i++;
      }
      if (i >= src.length) fail("unterminated (* comment", start);
      i += 2;
      continue;
    }
    // { ... } attribute blocks and pragmas are ignored here.
    if (c === "{") {
      while (i < src.length && src[i] !== "}") {
        if (src[i] === "\n") line++;
        i++;
      }
      i++;
      continue;
    }
    if (c === "'") {
      let s = "";
      i++;
      while (i < src.length && src[i] !== "'" && src[i] !== "\n") {
        if (src[i] === "$") {
          s += src[i + 1] ?? "";
          i += 2;
        } else s += src[i++] ?? "";
      }
      if (src[i] !== "'") fail("unterminated string", line);
      i++;
      push("str", s);
      continue;
    }
    if (c === '"') {
      const e = src.indexOf('"', i + 1);
      if (e < 0 || src.slice(i, e).includes("\n")) fail("unterminated symbol name", line);
      push("id", src.slice(i + 1, e), { q: true });
      i = e + 1;
      continue;
    }
    if (c === "#" && isIdStart(src[i + 1])) {
      i++;
      push("id", readWhile(/[A-Za-z0-9_]/), { h: true });
      continue;
    }
    if (isDig(c)) {
      const n = readNumber();
      push("num", "", { tv: n.real ? { t: ET.REAL, v: Math.fround(n.v), lit: true } : litInt(n.v) });
      continue;
    }
    if (isIdStart(c)) {
      const word = readWhile(/[A-Za-z0-9_]/);
      const up = word.toUpperCase();
      if (src[i] === "#") {
        i++;
        const k = PREFIX[up];
        if (!k) fail(`constant prefix ${word}# is outside the supported subset`, line);
        push("num", "", { tv: typedLit(up, k) });
        continue;
      }
      // TITLE = runs to the end of the line (§6 Block Attributes).
      if (up === "TITLE" && /^\s*=/.test(src.slice(i, i + 40))) {
        while (i < src.length && src[i] !== "\n") i++;
        continue;
      }
      push("id", word);
      continue;
    }
    const two = src.slice(i, i + 2);
    if ([":=", "=>", "<=", ">=", "<>", "**", ".."].includes(two)) {
      push("sym", two);
      i += 2;
      continue;
    }
    if ("+-*/=<>()[],;:.&".includes(c)) {
      push("sym", c);
      i++;
      continue;
    }
    fail(`unexpected character '${c}'`, line);
  }
  push("eof", "");
  return toks;
}

// ---------------------------------------------------------------- syntax tree

type Expr =
  | { k: "lit"; tv: TV; fx: boolean; line: number }
  | { k: "var"; path: VarPath; fx: boolean; line: number }
  | { k: "un"; op: string; e: Expr; fx: boolean; line: number }
  | { k: "bin"; op: string; a: Expr; b: Expr; fx: boolean; line: number }
  | CallExpr;
/** fx: the expression calls a user FUNCTION, so evaluating it may write variables. */
interface CallExpr {
  k: "call";
  name: string;
  args: Arg[];
  fx: boolean;
  line: number;
}
interface Arg {
  name: string | null;
  op: string;
  expr: Expr;
}
interface VarPath {
  name: string;
  hash: boolean;
  quoted: boolean;
  steps: Step[];
  fx: boolean;
  line: number;
}
type Step = { k: "m"; m: string } | { k: "ix"; ix: Expr[] };
type Stmt =
  | { k: "assign"; lhs: VarPath; rhs: Expr; line: number }
  | { k: "call"; call: CallExpr; line: number }
  | { k: "if"; arms: { c: Expr; body: Stmt[] }[]; els: Stmt[] | null; line: number }
  | {
      k: "case";
      sel: Expr;
      arms: { labels: [Expr, Expr][]; body: Stmt[] }[];
      els: Stmt[] | null;
      table: [number, number][][] | null;
      line: number;
    }
  | { k: "for"; v: VarPath; from: Expr; to: Expr; by: Expr | null; body: Stmt[]; line: number }
  | { k: "while"; c: Expr; body: Stmt[]; line: number }
  | { k: "repeat"; c: Expr; body: Stmt[]; line: number }
  | { k: "exit" | "continue" | "return"; line: number };

type TypeAst =
  | { k: "ELEM"; e: BlindType }
  | { k: "ARRAY"; dims: [Expr, Expr][]; of: TypeAst }
  | { k: "STRUCT"; fields: Decl[] }
  | { k: "REF"; name: string; line: number };
type InitItem = { rep: number; items: InitItem[] } | { expr: Expr };
type Sec = "input" | "output" | "inout" | "temp" | "stat" | "field";
interface Decl {
  name: string;
  key: string;
  sec: Sec;
  typeAst: TypeAst;
  init: InitItem[] | null;
  line: number;
}
interface UdtUnit {
  kind: "UDT";
  name: string;
  typeAst: TypeAst;
  line: number;
  type: StructT | null;
  busy: boolean;
}
interface DbUnit {
  kind: "DB";
  name: string;
  typeAst: TypeAst;
  body: Stmt[];
  line: number;
  type: StructT | null;
  holder: Box;
}
interface VarInfo {
  name: string;
  key: string;
  sec: Sec;
  type: SclType;
  init: InitItem[] | null;
  env: ConstEnv;
  line: number;
}
interface Prepared {
  consts: ConstEnv;
  input: VarInfo[];
  output: VarInfo[];
  inout: VarInfo[];
  temp: VarInfo[];
  stat: VarInfo[];
  params: Map<string, VarInfo>;
  ret: ElemT | null;
}
interface LogicUnit {
  kind: "FB" | "FC";
  name: string;
  key: string;
  retAst: TypeAst | null;
  decls: Decl[];
  constAsts: [string, Expr, number][];
  body: Stmt[];
  line: number;
  prep: Prepared | null;
  busy: boolean;
}
type Unit = UdtUnit | DbUnit | LogicUnit;

// ---------------------------------------------------------------- parser

const KW = new Set(
  (
    "AND OR XOR NOT MOD DIV IF THEN ELSIF ELSE END_IF CASE OF END_CASE FOR TO BY DO END_FOR WHILE END_WHILE " +
    "REPEAT UNTIL END_REPEAT EXIT CONTINUE RETURN GOTO BEGIN VAR VAR_INPUT VAR_OUTPUT VAR_IN_OUT VAR_TEMP END_VAR " +
    "CONST END_CONST LABEL END_LABEL TYPE END_TYPE STRUCT END_STRUCT ARRAY DATA_BLOCK END_DATA_BLOCK FUNCTION " +
    "END_FUNCTION FUNCTION_BLOCK END_FUNCTION_BLOCK ORGANIZATION_BLOCK END_ORGANIZATION_BLOCK TRUE FALSE VOID AT"
  ).split(" "),
);
const BLOCK_END = new Set(["END_IF", "ELSIF", "ELSE", "END_CASE", "END_FOR", "END_WHILE", "UNTIL", "END_REPEAT"]);
const UNIT_END = new Set(["END_FUNCTION", "END_FUNCTION_BLOCK", "END_DATA_BLOCK"]);
// Operator priority, loosest first (§11 Operations, priority table): OR 10, XOR 9, AND/& 8, = <> 7,
// < > <= >= 6, + - 5, * / MOD DIV 4; then unary + - and NOT 3, ** 2, parentheses 1.
const LEVELS = [
  ["OR"],
  ["XOR"],
  ["AND", "&"],
  ["=", "<>"],
  ["<", ">", "<=", ">="],
  ["+", "-"],
  ["*", "/", "MOD", "DIV"],
];
const SECTIONS: Record<string, Sec> = {
  VAR_INPUT: "input",
  VAR_OUTPUT: "output",
  VAR_IN_OUT: "inout",
  VAR_TEMP: "temp",
  VAR: "stat",
};
const EOF: Tok = { t: "eof", v: "", up: "", q: false, h: false, tv: null, line: 0 };

class Parser {
  toks: Tok[];
  p = 0;
  loops = 0;
  constructor(toks: Tok[]) {
    this.toks = toks;
  }
  peek(o = 0): Tok {
    return this.toks[Math.min(this.p + o, this.toks.length - 1)] ?? EOF;
  }
  next(): Tok {
    const t = this.peek();
    this.p++;
    return t;
  }
  err(m: string): never {
    return fail(m, this.peek().line);
  }
  isKwTok(t: Tok) {
    return t.t === "id" && !t.q && !t.h;
  }
  isKw(w: string, o = 0) {
    const t = this.peek(o);
    return this.isKwTok(t) && t.up === w;
  }
  acceptKw(w: string) {
    if (!this.isKw(w)) return false;
    this.p++;
    return true;
  }
  expectKw(w: string) {
    if (!this.acceptKw(w)) this.err(`${w} expected, found '${this.peek().v || this.peek().t}'`);
  }
  isSym(s: string, o = 0) {
    const t = this.peek(o);
    return t.t === "sym" && t.v === s;
  }
  acceptSym(s: string) {
    if (!this.isSym(s)) return false;
    this.p++;
    return true;
  }
  expectSym(s: string) {
    if (!this.acceptSym(s)) this.err(`'${s}' expected, found '${this.peek().v || this.peek().t}'`);
  }
  ident(): Tok {
    const t = this.peek();
    if (t.t !== "id" || (this.isKwTok(t) && KW.has(t.up))) this.err(`identifier expected, found '${t.v || t.t}'`);
    return this.next();
  }

  program(): Unit[] {
    const units: Unit[] = [];
    while (this.peek().t !== "eof") {
      const line = this.peek().line;
      if (this.acceptKw("TYPE")) units.push(this.udt(line));
      else if (this.acceptKw("DATA_BLOCK")) units.push(this.db(line));
      else if (this.acceptKw("FUNCTION_BLOCK")) units.push(this.logic("FB", line));
      else if (this.acceptKw("FUNCTION")) units.push(this.logic("FC", line));
      else if (this.isKw("ORGANIZATION_BLOCK")) this.err("ORGANIZATION_BLOCK is outside the supported subset");
      else this.err("TYPE, DATA_BLOCK, FUNCTION or FUNCTION_BLOCK expected");
    }
    return units;
  }
  /** VERSION/AUTHOR/NAME/FAMILY : value and KNOW_HOW_PROTECT carry no semantics (§6 Block Attributes). */
  attrs() {
    for (;;) {
      if (["VERSION", "AUTHOR", "NAME", "FAMILY"].includes(this.peek().up) && this.isSym(":", 1)) {
        this.p += 3;
      } else if (this.isKw("KNOW_HOW_PROTECT")) this.p++;
      else return;
    }
  }
  udt(line: number): UdtUnit {
    const name = this.ident().v;
    this.attrs();
    if (!this.isKw("STRUCT")) this.err("a UDT is a STRUCT (§7 User-Defined Data Types)");
    const typeAst = this.type();
    this.acceptSym(";");
    this.expectKw("END_TYPE");
    return { kind: "UDT", name, typeAst, line, type: null, busy: false };
  }
  db(line: number): DbUnit {
    const name = this.ident().v;
    this.attrs();
    let typeAst: TypeAst;
    if (this.isKw("STRUCT")) typeAst = this.type();
    else if (this.acceptKw("VAR")) typeAst = { k: "STRUCT", fields: this.varList("END_VAR", "field") };
    else {
      const t = this.ident();
      typeAst = { k: "REF", name: t.v, line: t.line };
    }
    this.acceptSym(";");
    this.expectKw("BEGIN");
    const body = this.stmts();
    this.expectKw("END_DATA_BLOCK");
    return { kind: "DB", name, typeAst, body, line, type: null, holder: {} };
  }
  logic(kind: "FB" | "FC", line: number): LogicUnit {
    const name = this.ident().v;
    let retAst: TypeAst | null = null;
    if (kind === "FC") {
      this.expectSym(":");
      if (!this.acceptKw("VOID")) retAst = this.type();
    }
    this.attrs();
    const def: LogicUnit = {
      kind,
      name,
      key: name.toLowerCase(),
      retAst,
      decls: [],
      constAsts: [],
      body: [],
      line,
      prep: null,
      busy: false,
    };
    for (;;) {
      const t = this.peek();
      const sec = this.isKwTok(t) ? SECTIONS[t.up] : undefined;
      if (sec) {
        this.p++;
        def.decls.push(...this.varList("END_VAR", sec));
      } else if (this.acceptKw("CONST")) {
        while (!this.acceptKw("END_CONST")) {
          const n = this.ident();
          this.expectSym(":=");
          def.constAsts.push([n.v, this.expr(), n.line]);
          this.expectSym(";");
        }
      } else if (this.isKw("LABEL")) this.err("LABEL/GOTO is outside the supported subset");
      else break;
    }
    this.acceptKw("BEGIN");
    def.body = this.stmts();
    const end = kind === "FB" ? "END_FUNCTION_BLOCK" : "END_FUNCTION";
    this.expectKw(end);
    return def;
  }
  varList(endKw: string, sec: Sec): Decl[] {
    const out: Decl[] = [];
    while (!this.acceptKw(endKw)) {
      const names = [this.ident()];
      while (this.acceptSym(",")) names.push(this.ident());
      if (this.isKw("AT")) this.err("AT views are outside the supported subset");
      this.expectSym(":");
      const typeAst = this.type();
      let init: InitItem[] | null = null;
      if (this.acceptSym(":=")) {
        if (names.length > 1) this.err("a list of variables cannot be initialised together (§8 Initialization)");
        init = this.initItems();
      }
      this.expectSym(";");
      for (const n of names) out.push({ name: n.v, key: n.v.toLowerCase(), sec, typeAst, init, line: n.line });
    }
    return out;
  }
  type(): TypeAst {
    const t = this.peek();
    if (t.t !== "id") this.err("data type expected");
    this.p++;
    if (!t.q && isBlindType(t.up)) return { k: "ELEM", e: t.up };
    if (!t.q && t.up === "ARRAY") {
      this.expectSym("[");
      const dims: [Expr, Expr][] = [];
      do {
        const lo = this.expr();
        this.expectSym("..");
        dims.push([lo, this.expr()]);
      } while (this.acceptSym(","));
      this.expectSym("]");
      this.expectKw("OF");
      return { k: "ARRAY", dims, of: this.type() };
    }
    if (!t.q && t.up === "STRUCT") return { k: "STRUCT", fields: this.varList("END_STRUCT", "field") };
    if (!t.q && KW.has(t.up)) return fail(`data type expected, found ${t.v}`, t.line);
    return { k: "REF", name: t.v, line: t.line };
  }
  /** Initial values, with repetition factors n(list) and optional brackets (§8 Initialization of arrays). */
  initItems(): InitItem[] {
    const items: InitItem[] = [];
    do {
      if (this.acceptSym("[")) {
        items.push(...this.initItems());
        this.expectSym("]");
        continue;
      }
      const t = this.peek();
      if (t.t === "num" && t.tv && t.tv.lit && t.tv.t.k !== "REAL" && this.isSym("(", 1)) {
        this.p += 2;
        const sub = this.initItems();
        this.expectSym(")");
        items.push({ rep: num(t.tv), items: sub });
      } else items.push({ expr: this.expr() });
    } while (this.acceptSym(","));
    return items;
  }

  stmts(inCase = false): Stmt[] {
    const out: Stmt[] = [];
    for (;;) {
      const t = this.peek();
      if (t.t === "eof") this.err("unexpected end of the source");
      if (this.isKwTok(t) && (BLOCK_END.has(t.up) || UNIT_END.has(t.up))) return out;
      if (inCase && this.caseLabelAhead()) return out;
      if (this.acceptSym(";")) continue;
      out.push(this.stmt());
    }
  }
  caseLabelAhead(): boolean {
    const t = this.peek();
    if (t.t === "num") return true;
    if ((this.isSym("-") || this.isSym("+")) && this.peek(1).t === "num") return true;
    return (
      t.t === "id" &&
      !(this.isKwTok(t) && KW.has(t.up)) &&
      (this.isSym(":", 1) || this.isSym(",", 1) || this.isSym("..", 1))
    );
  }
  loopBody(): Stmt[] {
    this.loops++;
    const b = this.stmts();
    this.loops--;
    return b;
  }
  stmt(): Stmt {
    const t = this.peek();
    const line = t.line;
    if (this.acceptKw("IF")) {
      const arms: { c: Expr; body: Stmt[] }[] = [];
      do {
        const c = this.expr();
        this.expectKw("THEN");
        arms.push({ c, body: this.stmts() });
      } while (this.acceptKw("ELSIF"));
      const els = this.acceptKw("ELSE") ? this.stmts() : null;
      this.expectKw("END_IF");
      this.acceptSym(";");
      return { k: "if", arms, els, line };
    }
    if (this.acceptKw("CASE")) {
      const sel = this.expr();
      this.expectKw("OF");
      const arms: { labels: [Expr, Expr][]; body: Stmt[] }[] = [];
      while (!this.isKw("ELSE") && !this.isKw("END_CASE")) {
        const labels: [Expr, Expr][] = [];
        do {
          const lo = this.expr();
          labels.push(this.acceptSym("..") ? [lo, this.expr()] : [lo, lo]);
        } while (this.acceptSym(","));
        this.expectSym(":");
        arms.push({ labels, body: this.stmts(true) });
      }
      let els: Stmt[] | null = null;
      if (this.acceptKw("ELSE")) {
        this.acceptSym(":");
        els = this.stmts();
      }
      this.expectKw("END_CASE");
      this.acceptSym(";");
      return { k: "case", sel, arms, els, table: null, line };
    }
    if (this.acceptKw("FOR")) {
      const v = this.varPath();
      this.expectSym(":=");
      const from = this.expr();
      this.expectKw("TO");
      const to = this.expr();
      const by = this.acceptKw("BY") ? this.expr() : null;
      this.expectKw("DO");
      const body = this.loopBody();
      this.expectKw("END_FOR");
      this.acceptSym(";");
      return { k: "for", v, from, to, by, body, line };
    }
    if (this.acceptKw("WHILE")) {
      const c = this.expr();
      this.expectKw("DO");
      const body = this.loopBody();
      this.expectKw("END_WHILE");
      this.acceptSym(";");
      return { k: "while", c, body, line };
    }
    if (this.acceptKw("REPEAT")) {
      const body = this.loopBody();
      this.expectKw("UNTIL");
      const c = this.expr();
      this.expectKw("END_REPEAT");
      this.acceptSym(";");
      return { k: "repeat", c, body, line };
    }
    for (const w of ["EXIT", "CONTINUE", "RETURN"] as const) {
      if (this.acceptKw(w)) {
        // EXIT and CONTINUE belong to a loop (§12 EXIT Statement, CONTINUE Statement).
        if (w !== "RETURN" && this.loops === 0) fail(`${w} outside a loop`, line);
        this.expectSym(";");
        return { k: w === "EXIT" ? "exit" : w === "CONTINUE" ? "continue" : "return", line };
      }
    }
    if (this.isKw("GOTO")) this.err("GOTO is outside the supported subset");
    if (t.t === "id" && this.isSym("(", 1)) {
      const call = this.call();
      this.expectSym(";");
      return { k: "call", call, line };
    }
    const lhs = this.varPath();
    if (this.isSym("(")) this.err("calls of a global FB instance (FB.DB(...)) are outside the supported subset");
    this.expectSym(":=");
    const rhs = this.expr();
    this.expectSym(";");
    return { k: "assign", lhs, rhs, line };
  }
  varPath(): VarPath {
    const t = this.ident();
    const steps: Step[] = [];
    for (;;) {
      if (this.isSym(".") && this.peek(1).t === "id") {
        this.p++;
        steps.push({ k: "m", m: this.next().v });
      } else if (this.acceptSym("[")) {
        const ix = [this.expr()];
        while (this.acceptSym(",")) ix.push(this.expr());
        this.expectSym("]");
        steps.push({ k: "ix", ix });
      } else break;
    }
    const fx = steps.some((s) => s.k === "ix" && s.ix.some((e) => e.fx));
    return { name: t.v, hash: t.h, quoted: t.q, steps, fx, line: t.line };
  }
  call(): CallExpr {
    const t = this.next();
    const args: Arg[] = [];
    this.expectSym("(");
    if (!this.acceptSym(")")) {
      do {
        if (this.peek().t === "id" && (this.isSym(":=", 1) || this.isSym("=>", 1))) {
          const n = this.next().v;
          const op = this.next().v;
          args.push({ name: n, op, expr: this.expr() });
        } else args.push({ name: null, op: ":=", expr: this.expr() });
      } while (this.acceptSym(","));
      this.expectSym(")");
    }
    const fx = !isStd(t.v) || t.q || args.some((a) => a.expr.fx);
    return { k: "call", name: t.v, args, fx, line: t.line };
  }
  expr(): Expr {
    return this.bin(0, false);
  }
  matchOp(ops: string[]): string | null {
    const t = this.peek();
    if (t.t === "sym" && ops.includes(t.v)) {
      this.p++;
      return t.v === "&" ? "AND" : t.v;
    }
    if (this.isKwTok(t) && ops.includes(t.up)) {
      this.p++;
      return t.up;
    }
    return null;
  }
  // strict: the operand directly follows an arithmetic operator, where "a * -b" is invalid and a*(-b) is
  // fine (§11 Arithmetic Expressions); a signed constant is still allowed there, the sign being part of it.
  bin(lv: number, strict: boolean): Expr {
    if (lv === LEVELS.length) return this.unary(strict);
    let a = this.bin(lv + 1, strict);
    for (;;) {
      const line = this.peek().line;
      const op = this.matchOp(at(LEVELS, lv));
      if (!op) return a;
      const b = this.bin(lv + 1, lv >= 5);
      a = { k: "bin", op, a, b, fx: a.fx || b.fx, line };
    }
  }
  unary(strict: boolean): Expr {
    const line = this.peek().line;
    if (this.isSym("-") || this.isSym("+")) {
      if (strict && this.peek(1).t !== "num")
        this.err("arithmetic operators must not follow each other directly (§11 Arithmetic Expressions); write a*(-b)");
      const op = this.next().v;
      const e = this.unary(true);
      return { k: "un", op, e, fx: e.fx, line };
    }
    if (this.acceptKw("NOT")) {
      const e = this.unary(false);
      return { k: "un", op: "NOT", e, fx: e.fx, line };
    }
    return this.pow();
  }
  // '**' (priority 2) binds tighter than unary minus (3), so -2**2 = -(2**2); operators of equal priority
  // associate left to right (§11 Operations).
  pow(): Expr {
    let a = this.primary();
    for (;;) {
      const line = this.peek().line;
      if (!this.acceptSym("**")) return a;
      let b: Expr;
      if (this.isSym("-") || this.isSym("+")) {
        if (this.peek(1).t !== "num")
          this.err("arithmetic operators must not follow each other directly (§11 Arithmetic Expressions)");
        const op = this.next().v;
        const e = this.primary();
        b = { k: "un", op, e, fx: false, line };
      } else b = this.primary();
      a = { k: "bin", op: "**", a, b, fx: a.fx || b.fx, line };
    }
  }
  primary(): Expr {
    const t = this.peek();
    const line = t.line;
    if (t.t === "num" && t.tv) {
      this.p++;
      return { k: "lit", tv: t.tv, fx: false, line };
    }
    if (this.acceptKw("TRUE")) return { k: "lit", tv: { t: ET.BOOL, v: 1, lit: false }, fx: false, line };
    if (this.acceptKw("FALSE")) return { k: "lit", tv: { t: ET.BOOL, v: 0, lit: false }, fx: false, line };
    if (this.acceptSym("(")) {
      const e = this.expr();
      this.expectSym(")");
      return e;
    }
    if (t.t === "str") this.err("STRING and CHAR values are outside the supported subset");
    if (t.t === "id" && this.isSym("(", 1)) return this.call();
    const path = this.varPath();
    return { k: "var", path, fx: path.fx, line };
  }
}

// ---------------------------------------------------------------- linking: types, constants, initial values

interface Frame {
  vars: Map<string, Ref>;
  consts: ConstEnv;
}
interface Ctx {
  udts: Map<string, UdtUnit>;
  fcs: Map<string, LogicUnit>;
  fbs: Map<string, LogicUnit>;
  dbs: Map<string, DbUnit>;
  steps: number;
  depth: number;
  /** Every live variable store: the DBs, the instance, and each running block's temporaries. */
  stores: Box[];
  /** FOR control variables of the loops now running. */
  guards: Ref[];
}
let ctx: Ctx | null = null;
function cx(): Ctx {
  if (!ctx) return fail("internal: no program loaded");
  return ctx;
}

function evalConst(e: Expr, consts: ConstEnv): TV {
  if (e.fx) fail("a constant expression cannot call a FUNCTION", e.line);
  return evalExpr(e, { vars: new Map(), consts });
}
function constInt(e: Expr, consts: ConstEnv): number {
  const x = evalConst(e, consts);
  if (x.t.k !== "INT" && x.t.k !== "DINT") fail("an integer constant is expected here", e.line);
  return num(x);
}

function resolveType(t: TypeAst, env: ConstEnv): SclType {
  switch (t.k) {
    case "ELEM":
      return ET[t.e];
    case "ARRAY": {
      // At most 6 dimensions, bounds INT constants with low <= high (§7 ARRAY Data Type).
      if (t.dims.length > 6) fail("an ARRAY has at most 6 dimensions (§7 ARRAY Data Type)", at(t.dims, 0)[0].line);
      const dims = t.dims.map(([lo, hi]): [number, number] => {
        const a = constInt(lo, env);
        const b = constInt(hi, env);
        if (a > b || !inRange("INT", a) || !inRange("INT", b))
          fail(`bad array bounds [${a}..${b}] (§7 ARRAY Data Type)`, lo.line);
        return [a, b];
      });
      return { k: "ARRAY", dims, of: resolveType(t.of, env) };
    }
    case "STRUCT":
      return mkStruct(
        t.fields.map((f) => ({ name: f.name, key: f.key, type: resolveType(f.typeAst, env), init: f.init, env })),
      );
    case "REF": {
      const key = t.name.toLowerCase();
      const u = cx().udts.get(key);
      if (u) {
        if (u.busy) fail(`UDT ${u.name} contains itself`, u.line);
        if (!u.type) {
          u.busy = true;
          const r = resolveType(u.typeAst, new Map());
          u.busy = false;
          if (r.k !== "STRUCT") fail(`UDT ${u.name} must be a STRUCT`, u.line);
          u.type = r;
        }
        return u.type;
      }
      if (cx().fbs.has(key)) return fail(`FB instances (${t.name}) are outside the supported subset`, t.line);
      return fail(`unknown data type ${t.name}`, t.line);
    }
  }
}
function mkStruct(fields: Field[]): StructT {
  return { k: "STRUCT", fields, map: new Map(fields.map((f) => [f.key, f])) };
}

function prepare(def: LogicUnit): Prepared {
  if (def.prep) return def.prep;
  const consts: ConstEnv = new Map();
  for (const [n, e] of def.constAsts) consts.set(n.toLowerCase(), evalConst(e, consts));
  const p: Prepared = { consts, input: [], output: [], inout: [], temp: [], stat: [], params: new Map(), ret: null };
  for (const d of def.decls) {
    // An FC has no instance: its VAR section is temporary (§6 Structure of a Function).
    const sec: Sec = def.kind === "FC" && d.sec === "stat" ? "temp" : d.sec;
    const x: VarInfo = {
      name: d.name,
      key: d.key,
      sec,
      type: resolveType(d.typeAst, consts),
      init: d.init,
      env: consts,
      line: d.line,
    };
    if (x.init) {
      if (sec === "temp") fail(`${d.name}: temporary variables cannot be initialised (§8 Initialization)`, d.line);
      if (def.kind === "FC") fail(`${d.name}: an FC's parameters cannot be initialised (§8 Initialization)`, d.line);
    }
    if (sec === "input" || sec === "output" || sec === "inout" || sec === "temp" || sec === "stat") p[sec].push(x);
  }
  for (const d of [...p.input, ...p.output, ...p.inout]) p.params.set(d.key, d);
  if (def.retAst) {
    const r = resolveType(def.retAst, consts);
    if (!isElem(r)) fail(`${def.name}: only an elementary function value is supported`, def.line);
    p.ret = r;
  }
  def.prep = p;
  return p;
}

function makeValue(t: SclType, temp: boolean): Data {
  if (isElem(t)) return temp ? undefined : 0;
  const o: Box = {};
  if (t.k === "ARRAY") {
    const mk = (d: number): Box => {
      const [lo, hi] = at(t.dims, d);
      const b: Box = {};
      for (let i = lo; i <= hi; i++) b[String(i)] = d + 1 < t.dims.length ? mk(d + 1) : makeValue(t.of, temp);
      return b;
    };
    return mk(0);
  }
  for (const f of t.fields) {
    o[f.key] = makeValue(f.type, temp);
    if (f.init && !temp) applyInit(o, f.key, f.name, f.type, f.init, f.env);
  }
  return o;
}
function expandInit(items: InitItem[], env: ConstEnv): TV[] {
  const out: TV[] = [];
  for (const it of items) {
    if ("expr" in it) out.push(evalConst(it.expr, env));
    else {
      const sub = expandInit(it.items, env);
      for (let i = 0; i < it.rep; i++) out.push(...sub);
    }
  }
  return out;
}
/** Array elements in initialisation order: row by row, the last index running fastest (§7 ARRAY Data Type). */
function arraySlots(t: ArrayT, box: Box): [Box, string][] {
  const out: [Box, string][] = [];
  const rec = (d: number, b: Box) => {
    const [lo, hi] = at(t.dims, d);
    for (let i = lo; i <= hi; i++) {
      if (d + 1 < t.dims.length) rec(d + 1, child(b[String(i)]));
      else out.push([b, String(i)]);
    }
  };
  rec(0, box);
  return out;
}
function applyInit(obj: Box, key: string, name: string, t: SclType, init: InitItem[], env: ConstEnv): void {
  const vals = expandInit(init, env);
  if (isElem(t)) {
    const v = vals[0];
    if (vals.length !== 1 || !v || !("expr" in at(init, 0))) fail(`${name}: exactly one initial value expected`);
    obj[key] = conv(v, t);
    return;
  }
  if (t.k === "ARRAY" && isElem(t.of)) {
    const slots = arraySlots(t, child(obj[key]));
    if (vals.length > slots.length) fail(`${name}: ${vals.length} initial values for ${slots.length} elements`);
    vals.forEach((x, i) => {
      const [b, k] = at(slots, i);
      b[k] = conv(x, t.of);
    });
    return;
  }
  fail(`${name}: a ${t.k} of this kind cannot be initialised with a value list`);
}

// ---------------------------------------------------------------- evaluation order
//
// The manual never says in which order the operands of an operation, the parameters of a call or the two
// sides of an assignment are evaluated, nor whether AND/OR stop once the left operand decides. These only
// show when a FUNCTION writes variables, so wherever one is called, both orders are run and must agree.

function snapshot(): Box[] {
  return cx().stores.map((b) => child(clone(b)));
}
function restore(s: Box[]): void {
  cx().stores.forEach((b, i) => copyInto(b, at(s, i)));
}
const sameState = (a: Box[], b: Box[]) => a.length === b.length && a.every((x, i) => sameData(x, at(b, i)));

interface Job<T> {
  fx: boolean;
  run: () => T;
}
function evalInOrder<T>(jobs: Job<T>[], same: (a: T, b: T) => boolean, what: string): T[] {
  if (jobs.length < 2 || !jobs.some((j) => j.fx)) return jobs.map((j) => j.run());
  const s0 = snapshot();
  const fwd = jobs.map((j) => j.run());
  const sF = snapshot();
  restore(s0);
  const rev: (T | undefined)[] = jobs.map(() => undefined);
  const orderStop = () =>
    stop(
      `the result depends on the evaluation order of ${what}`,
      "§11 Expressions / §12 Calling Functions: the manual gives no evaluation order for operands or parameters",
    );
  try {
    for (let i = jobs.length - 1; i >= 0; i--) rev[i] = at(jobs, i).run();
  } catch (e) {
    if (e instanceof Stop) orderStop();
    throw e;
  }
  const agree =
    sameState(sF, snapshot()) &&
    fwd.every((x, i) => {
      const r = rev[i];
      return r !== undefined && same(x, r);
    });
  if (!agree) orderStop();
  restore(sF);
  return fwd;
}

// ---------------------------------------------------------------- execution

function unwritten(r: Ref, name: string): never {
  if (r.area === "ret")
    return stop(
      `the value of FUNCTION ${name} is read before it is assigned`,
      "§12 Function value: the manual gives no value before the assignment",
    );
  return stop(`VAR_TEMP ${name} is read before it is written`, M_TEMP);
}

type Resolved = { kind: "ref"; ref: Ref } | { kind: "const"; tv: TV };
function resolve(path: VarPath, fr: Frame): Resolved {
  const key = path.name.toLowerCase();
  // A "quoted" name is a global symbol, except the function's own name, which is its value (§12 Function value).
  let ref = fr.vars.get(key);
  if (path.quoted && ref?.area !== "ret") ref = undefined;
  if (!ref) {
    const c = path.quoted || path.hash ? undefined : fr.consts.get(key);
    if (c) {
      if (path.steps.length) fail(`constant ${path.name} has no components`);
      return { kind: "const", tv: c };
    }
    const db = path.hash ? undefined : cx().dbs.get(key);
    if (!db || !db.type) return fail(`unknown identifier ${path.name}`);
    ref = { type: db.type, obj: db.holder, key: "v", area: "data" };
  }
  for (const st of path.steps) {
    const cur: Data = ref.obj[ref.key];
    const t: SclType = ref.type;
    if (st.k === "m") {
      if (t.k !== "STRUCT") return fail(`${path.name}: '.${st.m}' applied to a ${t.k}`);
      const f = t.map.get(st.m.toLowerCase());
      if (!f) return fail(`${path.name} has no component ${st.m}`);
      ref = { type: f.type, obj: child(cur), key: f.key, area: ref.area };
      continue;
    }
    if (t.k !== "ARRAY") return fail(`${path.name}: an index applied to a ${t.k}`);
    if (st.ix.length > t.dims.length) fail(`${path.name}: too many indices`);
    const idx = evalInOrder(
      st.ix.map((e) => ({ fx: e.fx, run: () => evalExpr(e, fr) })),
      sameTV,
      "array indices",
    );
    let box = child(cur);
    let last = "";
    idx.forEach((iv, i) => {
      // An index is an INT expression (§12 Value Assignments, array components).
      if (iv.t.k !== "INT") typeErr(`an array index must be an INT, got ${iv.t.k}`);
      const [lo, hi] = at(t.dims, i);
      const v = num(iv);
      if (v < lo || v > hi)
        stop(
          `index ${v} is outside ${path.name}[${lo}..${hi}]`,
          "§4 Customizing the Compiler, 'Monitor array limits': without it an out-of-range index is not caught; the manual gives no value",
        );
      if (i < idx.length - 1) box = child(box[String(v)]);
      else last = String(v);
    });
    // Leaving out the right-hand indices addresses a sub-array (§12 Value Assignments, arrays).
    const rest = t.dims.slice(idx.length);
    ref = { type: rest.length ? { k: "ARRAY", dims: rest, of: t.of } : t.of, obj: box, key: last, area: ref.area };
  }
  return { kind: "ref", ref };
}
function resolveRef(path: VarPath, fr: Frame): Ref {
  const r = resolve(path, fr);
  if (r.kind === "const") return fail(`constant ${path.name} cannot be written`);
  return r.ref;
}

function readVar(path: VarPath, fr: Frame): TV {
  const r = resolve(path, fr);
  if (r.kind === "const") return r.tv;
  const v = r.ref.obj[r.ref.key];
  if (isElem(r.ref.type) && v === undefined) unwritten(r.ref, path.name);
  return { t: r.ref.type, v, lit: false };
}

function evalExpr(e: Expr, fr: Frame): TV {
  switch (e.k) {
    case "lit":
      return e.tv;
    case "var":
      return readVar(e.path, fr);
    case "un":
      return unary(e.op, evalExpr(e.e, fr));
    case "bin":
      return evalBin(e.op, e.a, e.b, fr);
    case "call": {
      const fc = cx().fcs.get(e.name.toLowerCase());
      if (fc) {
        const r = callFC(fc, e, fr, false);
        if (!r) return fail(`VOID FUNCTION ${e.name} is used in an expression`);
        return r;
      }
      return callStd(e, fr);
    }
  }
}

function evalBin(op: string, a: Expr, b: Expr, fr: Frame): TV {
  // Whether AND/OR evaluate the right operand once the left decides is not in the manual
  // (§11 Logical Expressions); it only shows when the right operand calls a FUNCTION that writes.
  if ((op === "AND" || op === "OR") && b.fx) {
    const s0 = snapshot();
    const va = evalExpr(a, fr);
    if (va.t.k === "BOOL" && num(va) === (op === "AND" ? 0 : 1)) {
      const sA = snapshot();
      const vb = evalExpr(b, fr);
      if (!sameState(sA, snapshot()))
        stop(
          `${op}: the left operand decides, and evaluating the right operand writes variables (short-circuit)`,
          "§11 Logical Expressions: the manual does not say whether the right operand is evaluated",
        );
      return logic(op, va, vb);
    }
    restore(s0);
  }
  const [x, y] = evalInOrder(
    [
      { fx: a.fx, run: () => evalExpr(a, fr) },
      { fx: b.fx, run: () => evalExpr(b, fr) },
    ],
    sameTV,
    `the operands of ${op}`,
  );
  if (!x || !y) return fail("internal: operands");
  return binary(op, x, y);
}

function callStd(e: CallExpr, fr: Frame): TV {
  const name = e.name.toUpperCase();
  if (SHIFTS.has(name)) {
    // SHL/SHR/ROL/ROR(IN := ..., N := ...) (§14 Bit String Standard Functions).
    const named = e.args.every((x) => x.name !== null);
    const find = (p: string, i: number) =>
      named ? e.args.find((x) => x.name?.toUpperCase() === p) : e.args.length === 2 ? e.args[i] : undefined;
    const inArg = find("IN", 0);
    const nArg = find("N", 1);
    if (!inArg || !nArg || e.args.length !== 2) return fail(`${name} takes the parameters IN and N`);
    const [v, n] = evalInOrder(
      [inArg, nArg].map((x) => ({ fx: x.expr.fx, run: () => evalExpr(x.expr, fr) })),
      sameTV,
      `the parameters of ${name}`,
    );
    if (!v || !n) return fail("internal: shift parameters");
    return shift(name, v, n);
  }
  const f = STD1.get(name);
  if (!f) return fail(`unknown function ${e.name}`);
  const arg = e.args[0];
  if (e.args.length !== 1 || !arg || (arg.name !== null && arg.name.toUpperCase() !== "IN"))
    return fail(`${e.name} takes one parameter IN (§14)`);
  return f(evalExpr(arg.expr, fr));
}

type ArgVal = { tv: TV } | { ref: Ref };
const sameArg = (a: ArgVal, b: ArgVal) =>
  "tv" in a ? "tv" in b && sameTV(a.tv, b.tv) : "ref" in b && a.ref.obj === b.ref.obj && a.ref.key === b.ref.key;

function callFC(def: LogicUnit, e: CallExpr, fr: Frame, asStatement: boolean): TV | null {
  const p = prepare(def);
  const given = new Map<string, Arg>();
  // Parameters are assigned by name; only an FC with a single input may take it unnamed (§12 Calling Functions).
  if (e.args.length && e.args.every((a) => a.name === null)) {
    const only = p.input[0];
    if (e.args.length !== 1 || !only || p.input.length !== 1 || p.output.length || p.inout.length)
      fail(`${def.name}: parameters must be assigned by name (§12 Calling Functions)`);
    given.set(only.key, at(e.args, 0));
  } else
    for (const a of e.args) {
      if (a.name === null) fail(`${def.name}: positional and named parameters are mixed`);
      const k = a.name.toLowerCase();
      if (given.has(k)) fail(`${def.name}: parameter ${a.name} is assigned twice`);
      if (!p.params.has(k)) fail(`${def.name} has no parameter ${a.name}`);
      given.set(k, a);
    }
  // Every FC parameter must be supplied (§12 Calling Functions, "all parameters must be assigned").
  for (const d of p.params.values())
    if (!given.has(d.key)) fail(`${def.name}: parameter ${d.name} is missing (§12 Calling Functions)`);
  const order = [...given.entries()];
  const vals = evalInOrder(
    order.map(([k, a]): Job<ArgVal> => {
      const d = p.params.get(k);
      if (!d) return fail("internal: parameter");
      if (d.sec === "input") return { fx: a.expr.fx, run: () => ({ tv: evalExpr(a.expr, fr) }) };
      // Outputs and in/outs refer to the actual variable itself (§12 Calling Functions, output/in-out assignment).
      const ex = a.expr;
      if (ex.k !== "var") return fail(`${def.name}.${d.name}: the actual parameter must be a variable`);
      return { fx: ex.fx, run: () => ({ ref: resolveRef(ex.path, fr) }) };
    }),
    sameArg,
    `the parameters of ${def.name}`,
  );
  const tmp: Box = {};
  const vars = new Map<string, Ref>();
  order.forEach(([k], i) => {
    const d = p.params.get(k);
    const v = at(vals, i);
    if (!d) return;
    if ("tv" in v) {
      tmp[d.key] = conv(v.tv, d.type);
      vars.set(d.key, { type: d.type, obj: tmp, key: d.key, area: "data" });
    } else {
      if (!sameType(v.ref.type, d.type))
        typeErr(`${def.name}.${d.name}: the actual ${v.ref.type.k} doesn't match the formal ${d.type.k}`);
      vars.set(d.key, { ...v.ref, type: d.type });
    }
  });
  for (const d of p.temp) {
    tmp[d.key] = makeValue(d.type, true);
    vars.set(d.key, { type: d.type, obj: tmp, key: d.key, area: "temp" });
  }
  if (p.ret) {
    tmp["$ret"] = undefined;
    vars.set(def.key, { type: p.ret, obj: tmp, key: "$ret", area: "ret" });
  }
  const c = cx();
  if (c.depth > 32) fail(`${def.name}: FUNCTION calls nest too deep (recursion?)`);
  c.depth++;
  c.stores.push(tmp);
  try {
    execBlock(def.body, { vars, consts: p.consts });
  } finally {
    c.stores.pop();
    c.depth--;
  }
  if (!p.ret) return null;
  const v = tmp["$ret"];
  if (v === undefined) {
    if (asStatement) return null;
    return stop(
      `FUNCTION ${def.name} returns without assigning its value`,
      "§12 Function value: the function value must be assigned in the function; the manual gives no value otherwise",
    );
  }
  return { t: p.ret, v, lit: false };
}

const STEP_LIMIT = 1_000_000;
function tick(line: number) {
  if (++cx().steps > STEP_LIMIT) fail(`endless loop: more than ${STEP_LIMIT} statements in one scan`, line);
}

function write(ref: Ref, v: Data): void {
  if (cx().guards.some((g) => g.obj === ref.obj && g.key === ref.key))
    stop(
      "the FOR control variable is written inside its loop",
      "§12 FOR Statement; TIA S7-300/400 help, FOR: the control variable must not be changed in the loop, the result is undefined",
    );
  if (typeof v === "object") copyInto(child(ref.obj[ref.key]), v);
  else ref.obj[ref.key] = v;
}

type Flow = "EXIT" | "CONTINUE" | "RETURN" | null;
function execBlock(stmts: Stmt[], fr: Frame): Flow {
  for (const s of stmts) {
    const r = exec(s, fr);
    if (r) return r;
  }
  return null;
}
function exec(s: Stmt, fr: Frame): Flow {
  tick(s.line);
  try {
    return execInner(s, fr);
  } catch (e) {
    if ((e instanceof SclError || e instanceof Stop) && e.line === 0) e.line = s.line;
    throw e;
  }
}
function execInner(s: Stmt, fr: Frame): Flow {
  switch (s.k) {
    case "assign": {
      const rhs = s.rhs;
      const [r, x] = evalInOrder<{ ref?: Ref; tv?: TV }>(
        [
          { fx: s.lhs.fx, run: () => ({ ref: resolveRef(s.lhs, fr) }) },
          { fx: rhs.fx, run: () => ({ tv: evalExpr(rhs, fr) }) },
        ],
        (a, b) =>
          a.ref && b.ref ? a.ref.obj === b.ref.obj && a.ref.key === b.ref.key : !!a.tv && !!b.tv && sameTV(a.tv, b.tv),
        "the two sides of an assignment",
      );
      if (!r?.ref || !x?.tv) return fail("internal: assignment");
      write(r.ref, conv(x.tv, r.ref.type));
      return null;
    }
    case "call": {
      const e = s.call;
      const fc = cx().fcs.get(e.name.toLowerCase());
      if (fc) callFC(fc, e, fr, true);
      else if (fr.vars.has(e.name.toLowerCase()))
        fail(`calling the instance ${e.name} is outside the supported subset`);
      else evalExpr(e, fr);
      return null;
    }
    case "if":
      for (const arm of s.arms) if (cond(evalExpr(arm.c, fr))) return execBlock(arm.body, fr);
      return s.els ? execBlock(s.els, fr) : null;
    case "case": {
      // The selector is an INT; labels are constants, each value used once (§12 CASE Statement).
      const sel = evalExpr(s.sel, fr);
      if (sel.t.k !== "INT" && sel.t.k !== "DINT") typeErr(`the CASE selector must be an INT, got ${sel.t.k}`);
      if (!s.table) {
        const table = s.arms.map((a) =>
          a.labels.map(([lo, hi]): [number, number] => [constInt(lo, fr.consts), constInt(hi, fr.consts)]),
        );
        const seen: [number, number][] = [];
        for (const [lo, hi] of table.flat()) {
          if (lo > hi) fail(`CASE range ${lo}..${hi} is empty`);
          if (seen.some(([a, b]) => lo <= b && a <= hi))
            fail("a CASE value occurs more than once (§12 CASE Statement)");
          seen.push([lo, hi]);
        }
        s.table = table;
      }
      const v = num(sel);
      const i = s.table.findIndex((labels) => labels.some(([lo, hi]) => v >= lo && v <= hi));
      // No label matches and there is no ELSE: no statement runs (§12 CASE Statement).
      if (i >= 0) return execBlock(at(s.arms, i).body, fr);
      return s.els ? execBlock(s.els, fr) : null;
    }
    case "for":
      return execFor(s, fr);
    case "while":
      for (;;) {
        if (!cond(evalExpr(s.c, fr))) return null;
        tick(s.line);
        const r = execBlock(s.body, fr);
        if (r === "EXIT") return null;
        if (r === "RETURN") return r;
      }
    case "repeat":
      // The body runs at least once; CONTINUE goes on to the UNTIL test (§12 REPEAT, CONTINUE Statement).
      for (;;) {
        tick(s.line);
        const r = execBlock(s.body, fr);
        if (r === "EXIT") return null;
        if (r === "RETURN") return r;
        if (cond(evalExpr(s.c, fr))) return null;
      }
    case "exit":
      return "EXIT";
    case "continue":
      return "CONTINUE";
    case "return":
      return "RETURN";
  }
}

function execFor(s: Extract<Stmt, { k: "for" }>, fr: Frame): Flow {
  // The control variable is a simple INT or DINT variable (§12 FOR Statement).
  const ref = resolveRef(s.v, fr);
  if (s.v.steps.length || (ref.type.k !== "INT" && ref.type.k !== "DINT"))
    typeErr("the FOR control variable must be a simple INT or DINT variable (§12 FOR Statement)");
  const k = ref.type.k;
  const exprs = [s.from, s.to, ...(s.by ? [s.by] : [])];
  // Start, end and increment are evaluated once, before the first run (§12 FOR Statement).
  const vals = evalInOrder(
    exprs.map((e) => ({ fx: e.fx, run: () => evalExpr(e, fr) })),
    sameTV,
    "the FOR start, end and increment",
  ).map((x) => {
    const v = conv(x, ref.type);
    return typeof v === "number" ? v : fail("internal: FOR value");
  });
  const end = at(vals, 1);
  const step = vals[2] ?? 1;
  write(ref, at(vals, 0));
  const c = cx();
  c.guards.push(ref);
  try {
    for (;;) {
      const i = ref.obj[ref.key];
      if (typeof i !== "number") return fail("internal: FOR control variable");
      // Compared with the end value before each run, the loop ends once the variable has passed it
      // (§12 FOR Statement). BY 0 never passes, so it runs until the statement limit.
      if (step >= 0 ? i > end : i < end) return null;
      tick(s.line);
      const r = execBlock(s.body, fr);
      if (r === "EXIT") return null;
      if (r === "RETURN") return r;
      const next = i + step;
      // A loop whose end is within one increment of the type's limit can't pass it (TIA S7-300/400 help, FOR:
      // "safe" loops keep the end below PMAX - increment); the increment overflows instead.
      if (!inRange(k, next))
        stop(`the FOR control variable overflows ${k} at the increment (${i} + ${step})`, M_INT_RANGE);
      ref.obj[ref.key] = next;
    }
  } finally {
    c.guards.pop();
  }
}

// ---------------------------------------------------------------- results

function flatten(p: string, t: SclType, v: Data, out: Record<string, BlindValue>): void {
  if (isElem(t)) {
    if (typeof v !== "number") return fail(`internal: ${p} has no value`);
    out[p] = { type: t.k, value: v };
    return;
  }
  if (t.k === "ARRAY") {
    const rec = (d: number, b: Box, idx: number[]) => {
      const [lo, hi] = at(t.dims, d);
      for (let i = lo; i <= hi; i++) {
        const ix = [...idx, i];
        if (d + 1 < t.dims.length) rec(d + 1, child(b[String(i)]), ix);
        else flatten(`${p}[${ix.join(",")}]`, t.of, b[String(i)], out);
      }
    };
    rec(0, child(v), []);
    return;
  }
  for (const f of t.fields) flatten(`${p}.${f.name}`, f.type, child(v)[f.key], out);
}

function fromScan(v: number, t: ElemT, name: string): number {
  if (typeof v === "number") {
    if (t.k === "REAL") return Math.fround(v);
    if (Number.isInteger(v) && inRange(t.k, v)) return v + 0;
  }
  return fail(`scan value ${String(v)} is not a valid ${t.k} for ${name}`, 1);
}

function link(units: Unit[]): Ctx {
  const c: Ctx = {
    udts: new Map(),
    fcs: new Map(),
    fbs: new Map(),
    dbs: new Map(),
    steps: 0,
    depth: 0,
    stores: [],
    guards: [],
  };
  const seen = new Set<string>();
  for (const u of units) {
    const key = u.name.toLowerCase();
    if (seen.has(key)) fail(`block name ${u.name} is used twice`, u.line);
    seen.add(key);
    if (u.kind === "UDT") c.udts.set(key, u);
    else if (u.kind === "DB") c.dbs.set(key, u);
    else (u.kind === "FB" ? c.fbs : c.fcs).set(key, u);
  }
  return c;
}

function initDb(db: DbUnit): void {
  const t = resolveType(db.typeAst, new Map());
  if (t.k !== "STRUCT") return fail(`DATA_BLOCK ${db.name} must be a STRUCT or a UDT`, db.line);
  db.type = t;
  db.holder["v"] = makeValue(t, false);
}

/** Runs the listing's FUNCTION_BLOCK once per scan (one instance), as the manual defines it. */
export function runBlind(request: BlindRequest): BlindScan[] {
  try {
    return run(request);
  } catch (e) {
    if (e instanceof SclError) throw new Error(`line ${Math.max(e.line, 1)}: ${e.message}`, { cause: e });
    throw e;
  } finally {
    ctx = null;
  }
}

function run({ source, block, scans }: BlindRequest): BlindScan[] {
  const units = new Parser(lex(source)).program();
  ctx = link(units);
  const c = ctx;
  for (const d of [...c.fbs.values(), ...c.fcs.values()]) prepare(d);
  for (const db of c.dbs.values()) initDb(db);
  const def = c.fbs.get(block.toLowerCase());
  if (!def) return fail(`FUNCTION_BLOCK ${block} is not in the listing`, 1);
  const p = prepare(def);
  const inst: Box = {};
  const instVars = [...p.input, ...p.output, ...p.inout, ...p.stat];
  for (const d of instVars) {
    inst[d.key] = makeValue(d.type, false);
    if (d.init) applyInit(inst, d.key, d.name, d.type, d.init, d.env);
  }
  const dbBoxes = [...c.dbs.values()].map((db) => db.holder);
  const results: BlindScan[] = [];
  const stopped = (e: Stop): BlindScan => ({
    stopped: { line: Math.max(e.line, 1), point: e.point, manual: e.manual },
  });
  // A DATA_BLOCK's BEGIN section sets its actual values once, before the first scan (§6 Structure of a Data Block).
  try {
    for (const db of c.dbs.values()) {
      if (!db.type) continue;
      const t = db.type;
      const fr: Frame = {
        vars: new Map(
          t.fields.map((f) => [f.key, { type: f.type, obj: child(db.holder["v"]), key: f.key, area: "data" }]),
        ),
        consts: new Map(),
      };
      c.stores = dbBoxes;
      execBlock(db.body, fr);
    }
  } catch (e) {
    if (e instanceof Stop) return [stopped(e)];
    throw e;
  }
  for (const scan of scans) {
    for (const [name, val] of Object.entries(scan)) {
      const path = new Parser(lex(name)).varPath();
      const d = p.params.get(path.name.toLowerCase());
      if (!d || d.sec === "output") fail(`${name} is not a VAR_INPUT of ${def.name}`, d?.line ?? def.line);
      const frame: Frame = {
        vars: new Map([[d.key, { type: d.type, obj: inst, key: d.key, area: "data" }]]),
        consts: new Map(),
      };
      const r = resolveRef(path, frame);
      if (!isElem(r.type)) fail(`${name}: give a structured input element by element, e.g. "${d.name}[1]"`, d.line);
      r.obj[r.key] = fromScan(val, r.type, name);
    }
    const tmp: Box = {};
    const vars = new Map<string, Ref>();
    for (const d of instVars) vars.set(d.key, { type: d.type, obj: inst, key: d.key, area: "data" });
    // VAR_TEMP is fresh in every call, with no defined value (§8 Declaring Temporary Variables).
    for (const d of p.temp) {
      tmp[d.key] = makeValue(d.type, true);
      vars.set(d.key, { type: d.type, obj: tmp, key: d.key, area: "temp" });
    }
    c.steps = 0;
    c.depth = 0;
    c.guards = [];
    c.stores = [...dbBoxes, inst, tmp];
    try {
      execBlock(def.body, { vars, consts: p.consts });
    } catch (e) {
      if (e instanceof Stop) {
        results.push(stopped(e));
        return results;
      }
      throw e;
    }
    const values: Record<string, BlindValue> = {};
    for (const d of [...p.output, ...p.stat]) flatten(d.name, d.type, inst[d.key], values);
    for (const db of c.dbs.values()) if (db.type) flatten(db.name, db.type, db.holder["v"], values);
    results.push({ values });
  }
  return results;
}
