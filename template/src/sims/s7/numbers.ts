// The S7 core's numbers: INT (16-bit) and DINT (32-bit) two's complement that wrap and report
// overflow, and REAL as IEEE float32. Every interpreter on the core (STL, SCL, ladder/FBD) computes
// through these, so a REAL is rounded the same way and an overflow is caught the same way
// everywhere. Where the Siemens manual leaves a case open, awlsim (the STL build oracle) decides,
// and the choice is named where it is made.

/** The largest finite REAL, 16#7F7FFFFF. */
export const MAX_REAL = 3.4028234663852886e38;
/** The smallest positive REAL, a denormal: 16#00000001. */
const MIN_DENORMAL = 1.401298464324817e-45;
/**
 * The NaN a REAL operation leaves when it has no number to give (√-1, ACOS 2), as awlsim and the
 * S7 write it: 16#7FFFFFFF.
 */
export const NAN_BITS = 0x7fffffff;
/** Any other NaN a REAL operation stores (∞ − ∞, a NaN operand): all ones, 16#FFFFFFFF, as awlsim stores it. */
const ARITHMETIC_NAN_BITS = 0xffffffff;

const scratch = new DataView(new ArrayBuffer(4));

/** A 32-bit pattern read as a REAL. */
export function bitsToReal(bits: number): number {
  scratch.setUint32(0, bits >>> 0);
  return scratch.getFloat32(0);
}

/**
 * A number stored as a REAL: rounded to the nearest float32. A finite result too large for a REAL
 * is stored as the largest REAL, not ∞ (awlsim's choice; the manual gives ±∞ with OV: see
 * `test/s7-core.test.ts`, "REAL overflow").
 */
export function realToBits(x: number): number {
  if (Number.isNaN(x)) return ARITHMETIC_NAN_BITS;
  // Below the smallest REAL, awlsim stores +0 (the S7 flushes it: OV says so).
  if (x !== 0 && Math.abs(x) < MIN_DENORMAL) return 0;
  let y = Math.fround(x);
  if (Number.isFinite(x) && !Number.isFinite(y)) y = x < 0 ? -MAX_REAL : MAX_REAL;
  scratch.setFloat32(0, y);
  return scratch.getUint32(0);
}

/** The value a number has once stored as a REAL. */
export const toReal = (x: number): number => bitsToReal(realToBits(x));

export const isNaNBits = (bits: number) => (bits & 0x7fffffff) >>> 0 > 0x7f800000;
export const isInfBits = (bits: number) => (bits & 0x7fffffff) >>> 0 === 0x7f800000;

/** The low 16 bits as an INT. */
export const int16 = (u: number) => (u << 16) >> 16;
/** The 32 bits as a DINT. */
export const int32 = (u: number) => u | 0;
export const uint32 = (u: number) => u >>> 0;

export interface Overflow {
  /** The exact result left INT's (or DINT's) range: OV is set (OK cleared, ENO 0). */
  ov: 0 | 1;
}

/**
 * The class of a REAL result, which sets CC 1, CC 0 and OV: computed from the exact result, before
 * it is rounded to a REAL (as awlsim does), so a result below the smallest REAL is an underflow
 * even where it rounds to 0.
 */
export interface RealClass extends Overflow {
  cc1: 0 | 1;
  cc0: 0 | 1;
}

export function realClass(exact: number): RealClass {
  const magnitude = Math.abs(exact);
  if (magnitude > 0 && magnitude < MIN_DENORMAL) return { cc1: 0, cc0: 0, ov: 1 };
  const bits = Number.isNaN(exact) ? ARITHMETIC_NAN_BITS : realToBits(exact);
  return realClassOfBits(bits);
}

/** The class of a stored REAL, by its bits: zero, denormal, ∞, NaN, or a normal number's sign. */
export function realClassOfBits(bits: number): RealClass {
  const unsigned = (bits & 0x7fffffff) >>> 0;
  const negative = (bits & 0x80000000) !== 0;
  if (unsigned === 0) return { cc1: 0, cc0: 0, ov: 0 };
  if (unsigned < 0x00800000) return { cc1: 0, cc0: 0, ov: 1 };
  if (unsigned === 0x7f800000) return negative ? { cc1: 0, cc0: 1, ov: 1 } : { cc1: 1, cc0: 0, ov: 1 };
  if (unsigned > 0x7f800000) return { cc1: 1, cc0: 1, ov: 1 };
  return negative ? { cc1: 0, cc0: 1, ov: 0 } : { cc1: 1, cc0: 0, ov: 0 };
}

const INT_MIN = -32768;
const INT_MAX = 32767;
const DINT_MIN = -2147483648;
const DINT_MAX = 2147483647;

export interface IntResult extends Overflow {
  /** The exact result, before it wraps. */
  exact: bigint;
  /** The result wrapped to the width (16 or 32 bits), signed. */
  value: number;
}

/** An exact integer result wrapped to INT (16) or DINT (32) bits, with OV if it didn't fit. */
export function wrap(exact: bigint, bits: 16 | 32): IntResult {
  const [lo, hi] = bits === 16 ? [INT_MIN, INT_MAX] : [DINT_MIN, DINT_MAX];
  const value = Number(BigInt.asIntN(bits, exact));
  return { exact, value, ov: exact < BigInt(lo) || exact > BigInt(hi) ? 1 : 0 };
}

export const add = (a: number, b: number, bits: 16 | 32) => wrap(BigInt(a) + BigInt(b), bits);
export const subtract = (a: number, b: number, bits: 16 | 32) => wrap(BigInt(a) - BigInt(b), bits);
export const multiply = (a: number, b: number, bits: 16 | 32) => wrap(BigInt(a) * BigInt(b), bits);
export const negate = (a: number, bits: 16 | 32) => wrap(-BigInt(a), bits);

export interface Division extends Overflow {
  /** The divisor was 0: the result is undefined, and OV (and OS) are set. */
  byZero: boolean;
  /** Truncated toward zero, wrapped to the width. */
  quotient: number;
  /** Takes the dividend's sign. */
  remainder: number;
}

/** Integer division truncated toward zero; the remainder takes the dividend's sign. */
export function divide(a: number, b: number, bits: 16 | 32): Division {
  if (b === 0) return { byZero: true, quotient: 0, remainder: 0, ov: 1 };
  const q = BigInt(a) / BigInt(b);
  const r = BigInt(a) % BigInt(b);
  const wrapped = wrap(q, bits);
  return { byZero: false, quotient: wrapped.value, remainder: Number(BigInt.asIntN(bits, r)), ov: wrapped.ov };
}

/**
 * REAL to DINT. `nearest` rounds a tie to the even neighbour (2.5 → 2, 3.5 → 4: the manual's RND,
 * and SCL's REAL_TO_INT/ROUND); `up` and `down` round toward +∞ and −∞; `toward-zero` truncates. A
 * value outside DINT gives no result and sets OV.
 */
export type Rounding = "nearest" | "up" | "down" | "toward-zero";

export function realToDint(x: number, rounding: Rounding): { value: number; ov: 0 } | { value?: never; ov: 1 } {
  if (!(x >= DINT_MIN && x <= DINT_MAX)) return { ov: 1 };
  const value =
    rounding === "nearest"
      ? roundHalfEven(x)
      : rounding === "up"
        ? Math.ceil(x)
        : rounding === "down"
          ? Math.floor(x)
          : Math.trunc(x);
  return value >= DINT_MIN && value <= DINT_MAX ? { value: value + 0, ov: 0 } : { ov: 1 };
}

/** Rounds to the nearest whole number, a tie to the even one. */
export function roundHalfEven(x: number): number {
  const floor = Math.floor(x);
  const fraction = x - floor;
  if (fraction > 0.5) return floor + 1;
  if (fraction < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}
