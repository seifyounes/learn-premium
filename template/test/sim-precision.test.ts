import { describe, expect, it } from "vitest";
import { agreesAtPrint, printAt, printedDecimals, readPrinted, rulingValues } from "../src/sims/precision.ts";

describe("a value as the sheet prints it", () => {
  it("reads the one number in a cell with its sign and how many decimals it shows", () => {
    expect(readPrinted("0.2667")).toEqual({ value: 0.2667, decimals: 4, written: "0.2667" });
    expect(readPrinted("$0.47$")).toEqual({ value: 0.47, decimals: 2, written: "0.47" });
    expect(readPrinted("−1.5")).toEqual({ value: -1.5, decimals: 1, written: "−1.5" });
    expect(readPrinted("$-12$")).toEqual({ value: -12, decimals: 0, written: "-12" });
    expect(readPrinted("1,250.5")).toEqual({ value: 1250.5, decimals: 1, written: "1,250.5" });
  });

  it("keeps the sign that belongs to the number in a labelled cell", () => {
    expect(readPrinted("$R = -0.04$")).toEqual({ value: -0.04, decimals: 2, written: "-0.04" });
    expect(readPrinted("$\\Delta T = −3.5$")).toEqual({ value: -3.5, decimals: 1, written: "−3.5" });
    expect(readPrinted("$R = 0.04$")).toEqual({ value: 0.04, decimals: 2, written: "0.04" });
    // A minus inside a subscript belongs to the label, not the value.
    expect(readPrinted("$x_{-1} = 1$")).toEqual({ value: 1, decimals: 0, written: "1" });
    // TeX spacing between the sign and the digits keeps the sign.
    expect(readPrinted("$-\\,0.04$")).toEqual({ value: -0.04, decimals: 2, written: "-0.04" });
    expect(readPrinted("$R = -\\;3$")).toEqual({ value: -3, decimals: 0, written: "-3" });
    // A minus before a grouped value applies to it.
    expect(readPrinted("$-(0.04)$")).toMatchObject({ value: -0.04 });
    expect(readPrinted("$-\\left(0.04\\right)$")).toMatchObject({ value: -0.04 });
    expect(readPrinted("$-{0.04}$")).toMatchObject({ value: -0.04 });
  });

  it("reads the values a ruling names, scientific notation as one value", () => {
    expect(rulingValues("$5.0 \\times 10^{-2}$")).toEqual([0.05]);
    expect(rulingValues("$R_\\text{total} = 1.54\\ \\text{K/W}$")).toEqual([1.54]);
    expect(rulingValues("plaster: $0.02$, $0.5$")).toEqual([0.02, 0.5]);
  });

  it("reads scientific notation as one value, its precision from the mantissa and the power", () => {
    expect(readPrinted("$4.0 \\times 10^{-2}$")).toEqual({ value: 0.04, decimals: 3, written: "4.0 \\times 10^{-2}" });
    expect(readPrinted("$-1.25 \\times 10^{3}$")).toEqual({
      value: -1250,
      decimals: -1,
      written: "-1.25 \\times 10^{3}",
    });
    expect(readPrinted("$k = 2 \\cdot 10^5$")).toEqual({ value: 200000, decimals: -5, written: "2 \\cdot 10^5" });
  });

  it("refuses a cell that holds no number, or more than one", () => {
    expect(readPrinted("")).toBe("the cell is blank");
    expect(readPrinted("$\\theta_0$")).toBe("the cell holds no number");
    expect(readPrinted("0.2 to 0.3")).toBe("the cell holds 2 numbers (0.2, 0.3), not one");
  });
});

describe("agreement at the sheet's printed precision", () => {
  const sheet = (cell: string) => {
    const printed = readPrinted(cell);
    if (typeof printed === "string") throw new Error(printed);
    return printed;
  };

  it("allows ±1 in the last printed digit of the correctly rounded value", () => {
    expect(agreesAtPrint(0.26666666, sheet("0.2667"))).toBe(true);
    expect(agreesAtPrint(0.26666666, sheet("0.2666"))).toBe(true);
    expect(agreesAtPrint(0.26666666, sheet("0.2668"))).toBe(true);
    expect(agreesAtPrint(0.26666666, sheet("0.27"))).toBe(true);
    expect(agreesAtPrint(0.26666666, sheet("0.3"))).toBe(true);
    expect(agreesAtPrint(4.3333, sheet("4"))).toBe(true);
  });

  it("compares scientific notation at the power its mantissa prints", () => {
    expect(agreesAtPrint(0.0401, sheet("$4.0 \\times 10^{-2}$"))).toBe(true);
    expect(agreesAtPrint(0.043, sheet("$4.0 \\times 10^{-2}$"))).toBe(false);
    expect(agreesAtPrint(1262, sheet("$1.25 \\times 10^{3}$"))).toBe(true);
    expect(agreesAtPrint(1290, sheet("$1.25 \\times 10^{3}$"))).toBe(false);
    expect(agreesAtPrint(0.04, sheet("$R = -0.04$"))).toBe(false);
  });

  it("disagrees past it", () => {
    expect(agreesAtPrint(0.26666666, sheet("0.2669"))).toBe(false);
    expect(agreesAtPrint(0.26666666, sheet("0.2656"))).toBe(false);
    expect(agreesAtPrint(0.26666666, sheet("0.25"))).toBe(false);
    expect(agreesAtPrint(-0.47, sheet("0.47"))).toBe(false);
  });

  it("holds exactly at one digit off, float rounding aside", () => {
    expect(agreesAtPrint(0.47, sheet("0.48"))).toBe(true);
    expect(agreesAtPrint(0.47, sheet("0.46"))).toBe(true);
    expect(agreesAtPrint(0.1 + 0.2, sheet("0.31"))).toBe(true);
    expect(agreesAtPrint(0.469, sheet("0.45"))).toBe(false);
  });
});

describe("printing a value the way the sheet does", () => {
  it("rounds to the sheet's decimals and writes a true minus sign", () => {
    expect(printAt(0.26666666, 4)).toBe("0.2667");
    expect(printAt(0.47, 4)).toBe("0.4700");
    expect(printAt(-1.25, 1)).toBe("−1.3");
    expect(printAt(-0.00001, 2)).toBe("0.00");
  });

  it("writes a number too large for its column in powers of ten", () => {
    expect(printAt(123456789.5, 4)).toBe("1.235e8");
    expect(printAt(-2.5e12, 2)).toBe("−2.5e12");
  });

  it("keeps the significant digits a sheet in powers of ten prints (negative decimals)", () => {
    expect(printAt(1250000, -4)).toBe("1.25e6");
    expect(printAt(-1249999, -4)).toBe("−1.25e6");
    expect(printAt(1262, -1)).toBe("1260");
  });
});

describe("the decimals a sheet prints with", () => {
  it("is the most any of its cells shows, so a sim's table matches the sheet", () => {
    expect(printedDecimals(["0", "4.3333", "0.47", "$0.4700$"])).toBe(4);
    expect(printedDecimals(["", "$\theta_0$"])).toBeUndefined();
  });
});
