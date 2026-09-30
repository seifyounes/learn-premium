import { describe, expect, it } from "vitest";
import { checkNumeric, readNumber } from "../src/practice/check.ts";

describe("reading a typed answer", () => {
  it("reads the numbers a student types", () => {
    expect(readNumber("9.6")).toBe(9.6);
    expect(readNumber("  9.60 ")).toBe(9.6);
    expect(readNumber(".5")).toBe(0.5);
    expect(readNumber("-5")).toBe(-5);
    expect(readNumber("−5")).toBe(-5);
    expect(readNumber("+16.2")).toBe(16.2);
    expect(readNumber("9600")).toBe(9600);
    expect(readNumber("9 600")).toBe(9600);
    expect(readNumber("9,600")).toBe(9600);
    expect(readNumber("9,6")).toBe(9.6);
    expect(readNumber("9.6e3")).toBe(9600);
    expect(readNumber("1.2E-3")).toBe(0.0012);
    expect(readNumber("1.2 × 10^-3")).toBeCloseTo(0.0012, 12);
    expect(readNumber("1.2x10^3")).toBe(1200);
  });

  it("reads past a unit the student adds", () => {
    expect(readNumber("9.6 kW")).toBe(9.6);
    expect(readNumber("16.2W")).toBe(16.2);
  });

  it("gives up on anything that isn't one number", () => {
    for (const input of ["", "  ", "kW", "about 10", "9.6.1", "1/2", "9,6,0", "12 34"]) {
      expect(readNumber(input), input).toBeUndefined();
    }
  });
});

describe("checking a numeric answer against its tolerance", () => {
  const answer = { value: 9.6, tolerance: 0.05 };

  it("is right inside the tolerance, edges included", () => {
    expect(checkNumeric("9.6", answer)).toBe("right");
    expect(checkNumeric("9.64", answer)).toBe("right");
    expect(checkNumeric("9.55", answer)).toBe("right");
    expect(checkNumeric("9.65", answer)).toBe("right");
  });

  it("is wrong outside it", () => {
    expect(checkNumeric("9.66", answer)).toBe("wrong");
    expect(checkNumeric("9600", answer)).toBe("wrong");
    expect(checkNumeric("-9.6", answer)).toBe("wrong");
  });

  it("asks for a number when it can't read one", () => {
    expect(checkNumeric("nine point six", answer)).toBe("unreadable");
    expect(checkNumeric("", answer)).toBe("unreadable");
  });

  it("holds a zero tolerance to the value, float noise aside", () => {
    expect(checkNumeric("0.3", { value: 0.1 + 0.2, tolerance: 0 })).toBe("right");
    expect(checkNumeric("0.31", { value: 0.3, tolerance: 0 })).toBe("wrong");
  });
});
