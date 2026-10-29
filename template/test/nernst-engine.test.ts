// The Nernst engine, the apparatus state the 3D cell and the gate share, and the sweep grid. The
// check values come from the engine's own constants (CODATA 2018 R and F), worked here by hand from
// E = E° − (RT/nF)·ln Q so a slip in the engine's lcm or exponents shows.
import { describe, expect, it } from "vitest";
import {
  F,
  R,
  cellPotential,
  electrons,
  ionCharge,
  ionText,
  nernstProblems,
  quantities,
  type HalfCell,
  type Model,
} from "../src/sims/nernst/engine.ts";
import { cellLabels, cellState, NO_CURRENT_V, solutionOpacity } from "../src/sims/nernst/apparatus.ts";
import { SWEEP_POINTS, sweepGrid } from "../src/sims/nernst/log.ts";

const cu: HalfCell = { metal: "Cu", ion: "Cu^2+", charge: 2, e0: 0.34 };
const zn: HalfCell = { metal: "Zn", ion: "Zn^2+", charge: 2, e0: -0.76 };
const ag: HalfCell = { metal: "Ag", ion: "Ag^+", charge: 1, e0: 0.8 };
/** The Fixture's copper concentration cell: both half-cells copper. */
const concentration: Model = { first: cu, second: cu };

describe("the Nernst engine", () => {
  it("the copper concentration cell at c1 0.01, c2 1, 298.15 K", () => {
    const cell = cellPotential(concentration, { c1: 0.01, c2: 1, T: 298.15 });
    expect(cell.n).toBe(2);
    expect(cell.Q).toBeCloseTo(0.01, 15);
    expect(cell.E0cell).toBe(0);
    expect(cell.E).toBeCloseTo(0.0591593496857215, 12);
    expect(cell.deltaG).toBeCloseTo(-11.416019004860114, 10);
    expect(cell.K).toBe(1);
    // Worked here from the constants, not from the engine's lines.
    expect(cell.E).toBeCloseTo(-((R * 298.15) / (2 * F)) * Math.log(0.01), 14);
  });

  it("reverses when c1 passes c2, and runs warmer in proportion to T", () => {
    const past = cellPotential(concentration, { c1: 1.5, c2: 1, T: 298.15 });
    expect(past.Q).toBeCloseTo(1.5, 15);
    expect(past.E).toBeCloseTo(-0.00520872218553701, 12);
    expect(past.deltaG).toBeCloseTo(1.0051305799847015, 10);
    const hot = cellPotential(concentration, { c1: 0.01, c2: 1, T: 373.15 });
    expect(hot.E).toBeCloseTo(0.07404095701904068, 12);
    expect(hot.deltaG).toBeCloseTo(-14.28773265692957, 10);
  });

  it("the Daniell cell: E° is the second couple's less the first's, and K is huge", () => {
    const cell = cellPotential({ first: zn, second: cu }, { c1: 1, c2: 1, T: 298.15 });
    expect(cell.E0cell).toBeCloseTo(1.1, 14);
    expect(cell.E).toBeCloseTo(1.1, 12);
    expect(cell.deltaG).toBeCloseTo(-212.26773066400003, 8);
    expect(Math.abs(cell.K / 1.5406269586154516e37 - 1)).toBeLessThan(1e-9);
  });

  it("n is the lcm and Q takes each ion's power (copper against silver)", () => {
    const model: Model = { first: cu, second: ag };
    expect(electrons(model)).toBe(2);
    const cell = cellPotential(model, { c1: 0.1, c2: 0.01, T: 298.15 });
    // Cu → Cu²⁺ + 2e⁻ and 2Ag⁺ + 2e⁻ → 2Ag: Q = [Cu²⁺] / [Ag⁺]².
    expect(cell.Q).toBeCloseTo(1000, 9);
    expect(cell.E).toBeCloseTo(0.3712609754714178, 12);
    expect(cell.deltaG).toBeCloseTo(-71.64247704310985, 9);
    expect(Math.abs(cell.K / 3558106570121918.5 - 1)).toBeLessThan(1e-9);
    expect(electrons({ first: cu, second: { metal: "Al", ion: "Al^3+", charge: 3, e0: -1.66 } })).toBe(6);
  });

  it("names every quantity the way sheets and recompute logs do", () => {
    const named = quantities(concentration, { c1: 0.01, c2: 1, T: 298.15 });
    expect(Object.keys(named)).toEqual(["E0cell", "n", "Q", "E", "deltaG", "K"]);
    expect(named.n).toBe(2);
  });

  it("ionCharge and ionText read mhchem's ion", () => {
    expect(ionCharge("Cu^2+")).toBe(2);
    expect(ionCharge("Ag^+")).toBe(1);
    expect(ionCharge("Cu")).toBeUndefined();
    expect(ionText("Cu^2+")).toBe("Cu²⁺");
    expect(ionText("Ag^+")).toBe("Ag⁺");
  });

  it("nernstProblems names a charge that disagrees with its ion, and an ion that isn't its metal's", () => {
    expect(nernstProblems(concentration)).toEqual([]);
    expect(nernstProblems({ first: { ...cu, charge: 1 }, second: cu })).toEqual([
      { path: ["model", "first", "charge"], message: "the ion Cu^2+ carries charge 2, but charge says 1" },
    ]);
    expect(nernstProblems({ first: cu, second: { ...cu, ion: "Zn^2+" } })).toEqual([
      {
        path: ["model", "second", "ion"],
        message: "the ion Zn^2+ isn't the metal Cu's: a metal | metal-ion half-cell holds its own metal's ion",
      },
    ]);
  });
});

describe("the apparatus state", () => {
  it("cellState: E > 0 anode first, E < 0 anode second, E = 0 none", () => {
    const positive = cellState(concentration, { c1: 0.01, c2: 1, T: 298.15 });
    expect(positive).toMatchObject({ anode: "first", cathode: "second", flow: "first-to-second" });
    expect(positive.E).toBeGreaterThan(0);
    const negative = cellState(concentration, { c1: 1.5, c2: 1, T: 298.15 });
    expect(negative).toMatchObject({ anode: "second", cathode: "first", flow: "second-to-first" });
    const none = cellState(concentration, { c1: 1, c2: 1, T: 298.15 });
    expect(none).toMatchObject({ anode: null, cathode: null, flow: "none" });
    expect(Math.abs(none.E)).toBeLessThan(NO_CURRENT_V);
    expect(positive.solutions.first).toMatchObject({ ion: "Cu^2+", c: 0.01 });
    expect(positive.solutions.second.c).toBe(1);
  });

  it("cellLabels swap anode and cathode when E < 0", () => {
    const start = { c1: 0.01, c2: 1, T: 298.15 };
    // A label keeps a value with its unit by a no-break space; compared here as the words they read.
    const read = (inputs: typeof start) =>
      Object.fromEntries(
        Object.entries(cellLabels(concentration, cellState(concentration, inputs), { E: 4, c: 3 })).map(([k, v]) => [
          k,
          v.replaceAll(" ", " "),
        ]),
      ) as ReturnType<typeof cellLabels>;
    const before = read(start);
    expect(before["first-electrode"]).toBe("Cu, anode (−)");
    expect(before["second-electrode"]).toBe("Cu, cathode (+)");
    expect(before.voltmeter).toBe("E = 0.0592 V");
    expect(before.wire).toBe("e⁻ →");
    expect(before["first-solution"]).toBe("Cu²⁺ 0.010 M");
    expect(before["second-solution"]).toBe("Cu²⁺ 1.000 M");
    expect(before.bridge).toBe("salt bridge");

    const after = read({ ...start, c1: 1.5 });
    expect(after["first-electrode"]).toBe("Cu, cathode (+)");
    expect(after["second-electrode"]).toBe("Cu, anode (−)");
    expect(after.voltmeter).toBe("E = −0.0052 V");
    expect(after.wire).toBe("← e⁻");

    const none = read({ ...start, c1: 1 });
    expect(none["first-electrode"]).toBe("Cu, no current");
    expect(none["second-electrode"]).toBe("Cu, no current");
    expect(none.wire).toBe("no current");
    expect(none.voltmeter).toBe("E = 0.0000 V");
  });

  it("solutionOpacity grows with c inside [0.1, 0.65]", () => {
    expect(solutionOpacity(0)).toBeCloseTo(0.1, 12);
    expect(solutionOpacity(0.5)).toBeGreaterThan(solutionOpacity(0.1));
    expect(solutionOpacity(2)).toBeGreaterThan(solutionOpacity(1));
    expect(solutionOpacity(2)).toBeLessThanOrEqual(0.65);
    expect(solutionOpacity(1000)).toBeLessThanOrEqual(0.65);
    expect(solutionOpacity(0.001)).toBeGreaterThanOrEqual(0.1);
    expect(solutionOpacity(1)).toBeCloseTo(0.1 + 0.55 * (1 - 0.1), 12);
  });
});

describe("the sweep grid", () => {
  it("sweepGrid gives 729 states, c1 slowest, min and max included", () => {
    const tune = {
      c1: { min: 0.001, max: 2, step: 0.001 },
      c2: { min: 0.001, max: 2, step: 0.001 },
      T: { min: 273.15, max: 373.15, step: 1 },
    };
    const grid = sweepGrid(tune);
    expect(SWEEP_POINTS).toBe(9);
    expect(grid).toHaveLength(729);
    expect(grid[0]).toEqual({ c1: 0.001, c2: 0.001, T: 273.15 });
    expect(grid[1]?.T).toBeCloseTo(273.15 + 12.5, 12);
    expect(grid[9]?.c2).toBeCloseTo(0.001 + (2 - 0.001) / 8, 12);
    expect(grid[81]?.c1).toBeCloseTo(0.001 + (2 - 0.001) / 8, 12);
    expect(grid.at(-1)).toEqual({ c1: 2, c2: 2, T: 373.15 });
  });

  it("sweepGrid is c1, c2, T whatever order tune is written in", () => {
    const range = { min: 1, max: 9, step: 1 };
    const grid = sweepGrid({ T: { ...range, min: 100, max: 108 }, c2: range, c1: range });
    expect(grid[0]).toEqual({ c1: 1, c2: 1, T: 100 });
    expect(grid[1]).toEqual({ c1: 1, c2: 1, T: 101 });
    expect(grid[9]).toEqual({ c1: 1, c2: 2, T: 100 });
    expect(grid[81]).toEqual({ c1: 2, c2: 1, T: 100 });
    expect(Object.keys(grid[0] as object)).toEqual(["c1", "c2", "T"]);
  });
});
