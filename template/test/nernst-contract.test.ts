// The Nernst sim in the content contract: a galvanic cell of two metal | metal-ion half-cells, written
// first | second, that students tune over the two concentrations and the temperature. The cell is
// the Professor's: it can't be rewired, and its ions are the metals' own.
import { describe, expect, it } from "vitest";
import { SIM_KINDS, sim } from "../src/content/contract.ts";
import { engineQuantities, isLive, KINDS } from "../src/sims/kinds.ts";

const issues = (raw: unknown) => sim.safeParse(raw).error?.issues.map((i) => `${i.path.join(".")}: ${i.message}`);

const range = { min: 0.001, max: 2, step: 0.001 };
/** The Fixture Course's copper concentration cell, as `modules/13-cell-potential/sims/cell.json` writes it. */
const cell = () => ({
  kind: "nernst",
  title: "A copper concentration cell",
  caption: "Slide c1 past c2 and the electrons turn round.",
  recompute: "independent",
  worked: "1",
  sheet: { B1: "Q", B2: "E", B3: "deltaG" },
  model: {
    first: { metal: "Cu", ion: "Cu^2+", charge: 2, e0: 0.34 },
    second: { metal: "Cu", ion: "Cu^2+", charge: 2, e0: 0.34 },
  },
  start: { c1: 0.01, c2: 1, T: 298.15 },
  tune: { c1: range, c2: range, T: { min: 273.15, max: 373.15, step: 1 } },
  plot: {
    isotherms: [273.15, 298.15, 323.15, 348.15, 373.15],
    many: "toggle",
    shown: [273.15, 298.15, 323.15, 373.15],
  },
  provenance: {},
});

describe("the Nernst sim contract", () => {
  it("the Fixture cell keeps the contract", () => {
    expect(issues(cell())).toBeUndefined();
    expect(SIM_KINDS.at(-1)).toBe("nernst");
  });

  it("holds an ion to its charge and its metal", () => {
    const wrongCharge = cell();
    wrongCharge.model.first.charge = 1;
    expect(issues(wrongCharge)).toEqual(["model.first.charge: the ion Cu^2+ carries charge 2, but charge says 1"]);
    const wrongIon = cell();
    wrongIon.model.second.ion = "Zn^2+";
    expect(issues(wrongIon)).toEqual([
      "model.second.ion: the ion Zn^2+ isn't the metal Cu's: a metal | metal-ion half-cell holds its own metal's ion",
    ]);
  });

  it("writes a metal by its symbol and its ion as mhchem writes it", () => {
    const bad = cell();
    bad.model.first.metal = "copper";
    bad.model.first.ion = "Cu2+";
    expect(issues(bad)).toEqual([
      "model.first.metal: a metal's symbol, e.g. Cu",
      "model.first.ion: the metal's ion as mhchem writes it, e.g. Cu^2+ or Ag^+",
    ]);
  });

  it("asks for concentrations and a temperature above 0", () => {
    const zero = cell();
    zero.tune.c1 = { min: 0, max: 2, step: 0.001 };
    expect(issues(zero)).toEqual(["tune.c1: a concentration is above 0: start its range above 0"]);
    const kelvin = cell();
    kelvin.tune.T = { min: -10, max: 400, step: 1 };
    expect(issues(kelvin)).toEqual(["tune.T: a temperature in K is above 0: start its range above 0"]);
  });

  it("ships live only with the example's values to open on", () => {
    const bare = { ...cell(), start: undefined };
    expect(issues(bare)).toEqual([
      "start: a live sim opens on the example's values (start) and says what students tune over (tune)",
    ]);
  });

  it("lets students tune the three inputs, never rewire the cell", () => {
    const rewired = cell();
    (rewired.model as Record<string, unknown>).left = rewired.model.first;
    expect(issues(rewired)).toEqual(['model: Unrecognized key: "left"']);
    const extra = cell();
    (extra.tune as Record<string, unknown>).pressure = range;
    expect(issues(extra)).toEqual(['tune: Unrecognized key: "pressure"']);
  });

  it("takes its isotherms as positive temperatures, with the toggle spelled out", () => {
    const cold = cell();
    cold.plot.isotherms = [0, 298.15];
    expect(issues(cold)).toBeDefined();
    const mistyped = cell();
    (mistyped.plot as Record<string, unknown>).many = "split";
    expect(issues(mistyped)).toBeDefined();
    const bare = cell() as Record<string, unknown>;
    delete bare.plot;
    expect(issues(bare)).toBeDefined();
  });

  it("opens on values inside the ranges students tune over", () => {
    const outside = cell();
    outside.start.c1 = 5;
    expect(issues(outside)).toEqual(["start.c1: 5 is outside the range students tune it over (0.001 to 2)"]);
  });

  it("engineQuantities on the Fixture cell gives E 0.0591593…", () => {
    const live = sim.parse(cell());
    expect(isLive(live)).toBe(true);
    if (!isLive(live)) return;
    expect(KINDS.nernst.checkedBy).toBe("nernst");
    const named = engineQuantities(live);
    expect(Object.keys(named)).toEqual(["E0cell", "n", "Q", "E", "deltaG", "K"]);
    expect(named.E).toBeCloseTo(0.0591593496857215, 12);
    expect(named.deltaG).toBeCloseTo(-11.416019004860114, 10);
    // The same engine at another point: slide c1 past c2.
    expect(engineQuantities(live, { c1: 1.5, c2: 1, T: 298.15 }).E).toBeCloseTo(-0.00520872218553701, 12);
  });
});
