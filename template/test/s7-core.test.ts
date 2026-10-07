// The S7 core at its interface, on the points the Siemens manuals leave open (#37's ambiguous
// points). Each expected value comes from the manual where it speaks, from awlsim (the STL build
// oracle) where it is silent, or from Siemens' published FC105/FC106 formula; the source is named on
// each case. Points that belong to the SCL language itself (short-circuit AND/OR, `-2**2`) are the
// SCL interpreter's (#55), which builds on these.
import { describe, expect, it } from "vitest";
import {
  add,
  bitsToReal,
  divide,
  formatReal,
  formatValue,
  multiply,
  negate,
  parseAddress,
  realClass,
  realToBits,
  realToDint,
  S7Memory,
  scale,
  subtract,
  toReal,
  unscale,
} from "../src/sims/s7/core.ts";

describe("REAL to DINT", () => {
  it("rounds a tie to the even neighbour (manual: RND; SCL's ROUND and REAL_TO_INT follow it)", () => {
    expect([2.5, 3.5, -2.5, -3.5, 0.5, -0.5, 1.5].map((x) => realToDint(x, "nearest").value)).toEqual([
      2, 4, -2, -4, 0, 0, 2,
    ]);
  });

  it("rounds up, down and toward zero as RND+, RND- and TRUNC do", () => {
    expect([-1.5, -0.25, 0.25, 1.5].map((x) => realToDint(x, "up").value)).toEqual([-1, 0, 1, 2]);
    expect([-1.5, -0.25, 0.25, 1.5].map((x) => realToDint(x, "down").value)).toEqual([-2, -1, 0, 1]);
    expect([-1.5, -0.25, 0.25, 1.5].map((x) => realToDint(x, "toward-zero").value)).toEqual([-1, 0, 0, 1]);
  });

  it("gives no result and sets OV for a REAL outside DINT, or NaN (manual: the accumulator keeps its value)", () => {
    expect(realToDint(2147483648, "nearest")).toEqual({ ov: 1 });
    expect(realToDint(-2147483904, "toward-zero")).toEqual({ ov: 1 });
    expect(realToDint(Number.NaN, "nearest")).toEqual({ ov: 1 });
    expect(realToDint(-2147483648, "nearest")).toEqual({ value: -2147483648, ov: 0 });
  });
});

describe("INT and DINT", () => {
  it("wrap two's complement and set OV when the exact result leaves the type (manual 7.3)", () => {
    expect(add(32767, 1, 16)).toMatchObject({ value: -32768, ov: 1 });
    expect(subtract(-32768, 1, 16)).toMatchObject({ value: 32767, ov: 1 });
    expect(multiply(200, 200, 16)).toMatchObject({ value: -25536, ov: 1, exact: 40000n });
    expect(add(2147483647, 1, 32)).toMatchObject({ value: -2147483648, ov: 1 });
    expect(multiply(65536, 65536, 32)).toMatchObject({ value: 0, ov: 1 });
    expect(add(100, -7, 16)).toMatchObject({ value: 93, ov: 0 });
  });

  it("negating the one value with no negative overflows (manual: NEGI, NEGD)", () => {
    expect(negate(-32768, 16)).toMatchObject({ value: -32768, ov: 1 });
    expect(negate(-2147483648, 32)).toMatchObject({ value: -2147483648, ov: 1 });
  });

  it("divides toward zero, the remainder taking the dividend's sign; by 0 it is undefined with OV (manual 7.6)", () => {
    expect(divide(-17, 5, 16)).toMatchObject({ quotient: -3, remainder: -2, ov: 0 });
    expect(divide(17, -5, 16)).toMatchObject({ quotient: -3, remainder: 2, ov: 0 });
    expect(divide(-32768, -1, 16)).toMatchObject({ quotient: -32768, ov: 1 });
    expect(divide(9, 0, 32)).toMatchObject({ byZero: true, ov: 1 });
  });
});

describe("REAL", () => {
  it("is float32: every result is rounded to the nearest float32", () => {
    expect(toReal(0.1)).toBe(Math.fround(0.1));
    expect(toReal(toReal(1) / toReal(3))).toBe(0.3333333432674408);
    expect(realToBits(57.3)).toBe(0x42653333);
  });

  it("stores a finite result too large for a REAL as the largest REAL, as awlsim does (the manual gives ±∞ with OV: for the Owner)", () => {
    expect(realToBits(1e39)).toBe(0x7f7fffff);
    expect(realToBits(-1e39)).toBe(0xff7fffff);
    expect(realToBits(Infinity)).toBe(0x7f800000);
    expect(realClass(1e39)).toEqual({ cc1: 1, cc0: 0, ov: 0 });
  });

  it("classes a denormal result as an underflow (OV), and stores one below the smallest REAL as +0 (awlsim)", () => {
    expect(realClass(1e-40)).toEqual({ cc1: 0, cc0: 0, ov: 1 });
    expect(realToBits(1e-40)).toBe(Math.round(1e-40 / 1.401298464324817e-45));
    expect(realToBits(-1e-46)).toBe(0);
    expect(realClass(-1e-46)).toEqual({ cc1: 0, cc0: 0, ov: 1 });
  });

  it("stores a NaN from arithmetic as all ones, and classes it unordered with OV (awlsim; the manual: CC 11)", () => {
    expect(realToBits(Number.NaN)).toBe(0xffffffff);
    expect(realClass(Number.NaN)).toEqual({ cc1: 1, cc0: 1, ov: 1 });
  });

  it("shows the shortest decimal that reads back as the same float32, like a watch table (#37: 57.3, not 57.29999924)", () => {
    expect(formatReal(toReal(57.3))).toBe("57.3");
    expect(formatReal(toReal(toReal(toReal(1) / toReal(6)) * 100))).toBe("16.666668");
    expect(formatReal(toReal(100))).toBe("100.0");
    expect(formatReal(-0)).toBe("-0.0");
    expect(formatReal(toReal(1e10))).toBe("1.0e+10");
    expect(formatReal(toReal(2.5e-6))).toBe("2.5e-6");
    expect(formatReal(bitsToReal(0x7f800000))).toBe("+Inf");
    expect(formatValue("REAL", 0xffffffff)).toBe("NaN");
  });

  it("shows integers in their type's notation", () => {
    expect(formatValue("INT", 0xfffb)).toBe("-5");
    expect(formatValue("DINT", 70000)).toBe("L#70000");
    expect(formatValue("WORD", 8)).toBe("W#16#0008");
    expect(formatValue("BOOL", 1)).toBe("1");
  });
});

describe("memory", () => {
  it("is byte-addressed and big-endian: a word's high byte sits at the lower address", () => {
    const m = new S7Memory();
    const mw = parseAddress("MW 20");
    if (!mw) throw new Error("MW 20");
    m.write(mw, 0x1234);
    expect(m.read(parseAddress("MB 20") ?? mw)).toBe(0x12);
    expect(m.read(parseAddress("MB 21") ?? mw)).toBe(0x34);
    expect(m.read(parseAddress("M 21.2") ?? mw)).toBe(1);
  });

  it("reads a peripheral input at its input bytes", () => {
    expect(parseAddress("PIW 256")).toEqual({ area: "I", width: "word", byte: 256, bit: 0, peripheral: true });
    expect(parseAddress("Q 4.8")).toBeUndefined();
    expect(parseAddress("PI 0.1")).toBeUndefined();
  });
});

describe("FC105 SCALE and FC106 UNSCALE (Siemens' formula, application example 23330722)", () => {
  it("scales an analog value between the limits, unipolar 0 to 27648 and bipolar ±27648", () => {
    expect(scale(13824, 100, 0, 0)).toEqual({ OUT: 50, RET_VAL: 0 });
    expect(scale(27648, 100, 0, 0)).toEqual({ OUT: 100, RET_VAL: 0 });
    expect(scale(0, 100, -100, 1)).toEqual({ OUT: 0, RET_VAL: 0 });
    expect(scale(-27648, 100, -100, 1)).toEqual({ OUT: -100, RET_VAL: 0 });
  });

  it("clamps an input past the range to the limit it passed, with RET_VAL W#16#0008", () => {
    expect(scale(27649, 100, 0, 0)).toEqual({ OUT: 100, RET_VAL: 8 });
    expect(scale(-1, 100, 0, 0)).toEqual({ OUT: 0, RET_VAL: 8 });
    expect(scale(-27649, 2, -2, 1)).toEqual({ OUT: -2, RET_VAL: 8 });
  });

  it("unscales back to the nearest INT, clamping past the limits, with reversed limits too", () => {
    expect(unscale(50, 100, 0, 0)).toEqual({ OUT: 13824, RET_VAL: 0 });
    expect(unscale(150, 100, 0, 0)).toEqual({ OUT: 27648, RET_VAL: 8 });
    expect(unscale(-1, 100, 0, 1)).toEqual({ OUT: -27648, RET_VAL: 8 });
    expect(unscale(25, 0, 100, 0)).toEqual({ OUT: 20736, RET_VAL: 0 });
    expect(unscale(150, 0, 100, 0)).toEqual({ OUT: 0, RET_VAL: 8 });
    // Coinciding limits divide by zero: the oracle's STL, as awlsim runs it, gives K2 (Codex review).
    expect(unscale(100, 100, 100, 0)).toEqual({ OUT: 27648, RET_VAL: 0 });
    expect(unscale(100, 100, 100, 1)).toEqual({ OUT: 27648, RET_VAL: 0 });
  });
});
