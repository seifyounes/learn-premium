// The timing diagram's geometry and its key: pure, generic, no browser. A row's path is a function
// of its levels, so the live diagram and the key agree exactly when a run reproduces the key.
import { describe, expect, it } from "vitest";
import {
  DIAGRAM,
  diagramSize,
  keyRows,
  lineX,
  quantityOf,
  rowOf,
  rowPath,
  type TimingRow,
} from "../src/sims/timing/diagram.ts";

const travel: TimingRow = { id: "A", label: "A", kind: "travel", at: "lines" };
const signal: TimingRow = { id: "I", label: "line I", kind: "signal", at: "intervals" };
const levels = (row: string, values: (number | undefined)[]) =>
  Object.fromEntries(values.flatMap((v, i) => (v === undefined ? [] : [[quantityOf(row, i + 1), v]])));

describe("a travel row", () => {
  it("goes through each step line at its level", () => {
    // y(1) = 34 + 8 = 42 and y(0) = 34 + 40 - 8 = 66 in the first band.
    expect(rowPath(travel, 0, 5, levels("A", [0, 1, 1, 1, 0]))).toBe("M80 66L152 42L224 42L296 42L368 66");
    expect(lineX(1)).toBe(DIAGRAM.labelW);
    expect(lineX(3)).toBe(DIAGRAM.labelW + 2 * DIAGRAM.stepW);
  });

  it("sits in the band its index gives", () => {
    expect(rowPath({ ...travel, id: "B" }, 1, 3, levels("B", [0, 0, 1]))).toBe("M80 106L152 106L224 82");
  });

  it("breaks the path where a level is missing", () => {
    expect(rowPath(travel, 0, 5, levels("A", [0, 1, undefined, 1, 0]))).toBe("M80 66L152 42M296 42L368 66");
    expect(rowPath(travel, 0, 5, levels("A", []))).toBe("");
  });

  it("stops the live path at the fraction of the current movement", () => {
    const now = { line: 2, fraction: 0.5, travel: { A: 0.25 } };
    // From (152, 42) halfway along the 72px step, to the piston's level now: y(0.25) = 34 + 32 - 6 = 60.
    expect(rowPath(travel, 0, 5, levels("A", [0, 1]), now)).toBe("M80 66L152 42L188 60");
  });
});

describe("a signal row", () => {
  it("is a square wave over its intervals, with a riser where it changes", () => {
    // Band 2: y(1) = 34 + 80 + 8 = 122, y(0) = 146.
    expect(rowPath(signal, 2, 5, levels("I", [1, 1, 0, 0]))).toBe("M80 122H152H224V146H296H368");
    expect(rowPath(signal, 2, 5, levels("I", [0, 1]))).toBe("M80 146H152V122H224");
  });

  it("breaks the wave where an interval has no level", () => {
    expect(rowPath(signal, 2, 5, levels("I", [1, undefined, 0, 0]))).toBe("M80 122H152M224 146H296H368");
  });

  it("is drawn only to the fraction of the interval under way", () => {
    const now = { line: 2, fraction: 0.5, travel: {} };
    expect(rowPath(signal, 2, 5, levels("I", [1, 0]), now)).toBe("M80 122H152V146H188");
  });
});

describe("the diagram's size", () => {
  it("is as wide as its step lines and as tall as its rows, drawn at its own size", () => {
    expect(diagramSize(4, 5)).toEqual({ width: 80 + 4 * 72 + 24, height: 34 + 4 * 40 + 12 });
  });
});

describe("the key", () => {
  it("reads a row's step from a quantity's name", () => {
    expect(rowOf("II[4]")).toEqual({ row: "II", k: 4 });
    expect(rowOf("A[12]")).toEqual({ row: "A", k: 12 });
    expect(rowOf("AxB")).toBeUndefined();
    expect(rowOf("A[x]")).toBeUndefined();
    expect(quantityOf("II", 4)).toBe("II[4]");
  });

  const engine = { ...levels("A", [0, 1, 1, 1, 0]), ...levels("I", [1, 1, 0, 0]) };
  const whole = {
    B1: "A[1]",
    C1: "A[2]",
    D1: "A[3]",
    E1: "A[4]",
    F1: "A[5]",
    B2: "I[1]",
    C2: "I[2]",
    D2: "I[3]",
    E2: "I[4]",
  };

  const without = (sheet: Record<string, string>, ...cells: string[]) =>
    Object.fromEntries(Object.entries(sheet).filter(([cell]) => !cells.includes(cell)));

  it("checks each row the sheet maps, whole", () => {
    expect(keyRows(whole, engine)).toEqual({ rows: 2, problems: [] });
  });

  it("blocks a row mapped at only some of its steps", () => {
    const partial = without(whole, "F1");
    expect(keyRows(partial, engine)).toEqual({
      rows: 1,
      problems: [
        "the key maps A at steps 1, 2, 3, 4 only, but the timing diagram draws it at steps 1–5: a key row is checked whole",
      ],
    });
    const gaps = without(whole, "C1", "D1");
    expect(keyRows(gaps, engine).problems).toEqual([
      "the key maps A at steps 1, 4, 5 only, but the timing diagram draws it at steps 1–5: a key row is checked whole",
    ]);
  });

  it("blocks a key that maps no row of the diagram", () => {
    expect(keyRows({ B1: "total" }, engine)).toEqual({
      rows: 0,
      problems: ["the key maps no row of the timing diagram"],
    });
    expect(keyRows({}, engine)).toEqual({ rows: 0, problems: ["the key maps no row of the timing diagram"] });
  });

  it("leaves a row the sheet doesn't map to the sim: the key need not cover every row", () => {
    const onlyA = Object.fromEntries(Object.entries(whole).filter(([, q]) => q.startsWith("A")));
    expect(keyRows(onlyA, engine)).toEqual({ rows: 1, problems: [] });
  });
});
