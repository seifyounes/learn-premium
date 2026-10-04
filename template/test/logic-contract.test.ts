// The logic sim's side of the content contract: a netlist, Layout hints (never a coordinate) and
// the input bits it opens on.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sim } from "../src/content/contract.ts";
import { FIXTURE_COURSE } from "./build-course";

interface Raw {
  model: { nets: { id?: string; pins: string[] }[] };
  layout: { parts: Record<string, Record<string, unknown>>; dots: string[]; [key: string]: unknown };
  start: Record<string, number>;
}
const adder = (): Raw =>
  JSON.parse(readFileSync(join(FIXTURE_COURSE, "modules/04-full-adder/sims/adder.json"), "utf8")) as Raw;
/** A part's hint or the first net, which every edit below expects to be there. */
const hint = (raw: Raw, id: string) => raw.layout.parts[id] ?? {};
const firstNet = (raw: Raw) => raw.model.nets[0] ?? { pins: [] };
const issues = (raw: unknown) => sim.safeParse(raw).error?.issues.map((i) => `${i.path.join(".")}: ${i.message}`);

describe("the logic sim contract", () => {
  it("takes the full adder: a netlist, its Layout hints and the row it opens on", () => {
    expect(issues(adder())).toBeUndefined();
  });

  it("has no field for a drawing coordinate: no hand-placed override", () => {
    const placed = adder();
    hint(placed, "G1").x = 240;
    expect(issues(placed)).toEqual(['layout.parts.G1: Unrecognized key: "x"']);
    const drawn = adder();
    drawn.layout.wires = [
      {
        points: [
          [0, 0],
          [40, 0],
        ],
      },
    ];
    expect(issues(drawn)).toEqual(['layout: Unrecognized key: "wires"']);
  });

  it("reads a part's cell to a tenth of a step at most", () => {
    const fine = adder();
    hint(fine, "G1").at = [2.25, 1.8];
    expect(issues(fine)).toEqual(["layout.parts.G1.at.0: a cell on the figure's coarse grid, to a tenth of a step"]);
  });

  it("puts every pin in exactly one net, and gives every part one hint", () => {
    const loose = adder();
    firstNet(loose).pins = ["A.t", "G1.in1"];
    loose.layout.parts = Object.fromEntries(Object.entries(loose.layout.parts).filter(([id]) => id !== "Cout"));
    expect(issues(loose)).toEqual(["model: G2.in1 is in no net", "model: part Cout has no layout hint"]);
  });

  it("names pins the symbol kit has", () => {
    const wrong = adder();
    firstNet(wrong).pins = ["A.t", "G1.in3", "G2.in1"];
    expect(issues(wrong)).toEqual([
      "model: net A names G1.in3, but a xor has pins in1, in2, out",
      "model: G1.in1 is in no net",
    ]);
  });

  it("drives each net once, from an input or a gate output", () => {
    const shorted = adder();
    const [a, b, ...rest] = shorted.model.nets;
    shorted.model.nets = [{ id: "A", pins: [...(a?.pins ?? []), ...(b?.pins ?? [])] }, ...rest];
    shorted.layout.dots = ["A", "Cin", "AxB"];
    expect(issues(shorted)).toEqual([
      "model: net A has 2 drivers (A.t, B.t): a gate output or an input drives each net, once",
    ]);
  });

  it("opens on a bit for each input, in the inputs' order", () => {
    const off = adder();
    off.start = { A: 1, Cin: 1, B: 0 };
    expect(issues(off)).toEqual(["start: start gives A, Cin, B, but the inputs are A, B, Cin, in that order"]);
    const notBit = adder();
    notBit.start.A = 2;
    expect(issues(notBit)?.[0]).toMatch(/^start\.A: /);
  });

  it("dots only nets the model has", () => {
    const stray = adder();
    stray.layout.dots = [...stray.layout.dots, "Q"];
    expect(issues(stray)).toEqual(["model: the layout hints dot net Q, which the model doesn't have"]);
  });
});
