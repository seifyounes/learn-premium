import { describe, expect, it } from "vitest";
import { agreesAtPrint, printAt, printedDecimals, readPrinted } from "../src/sims/precision.ts";

describe("a value as the sheet prints it", () => {
  it("reads the one number in a cell with its sign and how many decimals it shows", () => {
    expect(readPrinted("0.2667")).toEqual({ value: 0.2667, decimals: 4, written: "0.2667" });
    expect(readPrinted("$0.47$")).toEqual({ value: 0.47, decimals: 2, written: "0.47" });
    expect(readPrinted("−1.5")).toEqual({ value: -1.5, decimals: 1, written: "−1.5" });
    expect(readPrinted("$-12$")).toEqual({ value: -12, decimals: 0, written: "-12" });
    expect(readPrinted("1,250.5")).toEqual({ value: 1250.5, decimals: 1, written: "1,250.5" });
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
});

describe("the decimals a sheet prints with", () => {
  it("is the most any of its cells shows, so a sim's table matches the sheet", () => {
    expect(printedDecimals(["0", "4.3333", "0.47", "$0.4700$"])).toBe(4);
    expect(printedDecimals(["", "$\theta_0$"])).toBeUndefined();
  });
});
