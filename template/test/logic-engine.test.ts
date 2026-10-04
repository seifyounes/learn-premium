import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { levels, logicProblems, quantities, truthTable, type LogicModel } from "../src/sims/logic/engine.ts";
import { FIXTURE_COURSE } from "./build-course";

const adder = (
  JSON.parse(readFileSync(join(FIXTURE_COURSE, "modules/04-full-adder/sims/adder.json"), "utf8")) as {
    model: LogicModel;
  }
).model;

/** One gate between two inputs and an output. */
const oneGate = (kind: LogicModel["parts"][number]["kind"]): LogicModel =>
  kind === "not"
    ? {
        parts: [
          { id: "A", kind: "port" },
          { id: "G", kind },
          { id: "Y", kind: "port" },
        ],
        nets: [
          { id: "a", pins: ["A.t", "G.in"] },
          { id: "y", pins: ["G.out", "Y.t"] },
        ],
        inputs: ["A"],
        outputs: ["Y"],
      }
    : {
        parts: [
          { id: "A", kind: "port" },
          { id: "B", kind: "port" },
          { id: "G", kind },
          { id: "Y", kind: "port" },
        ],
        nets: [
          { id: "a", pins: ["A.t", "G.in1"] },
          { id: "b", pins: ["B.t", "G.in2"] },
          { id: "y", pins: ["G.out", "Y.t"] },
        ],
        inputs: ["A", "B"],
        outputs: ["Y"],
      };
const column = (model: LogicModel, net: string) => truthTable(model).map((r) => r.levels[net]);

describe("the logic engine", () => {
  it("adds three bits in the Fixture Course's full adder: S is their parity, Cout their majority", () => {
    const rows = truthTable(adder);
    expect(rows.map((r) => r.name)).toEqual(["000", "001", "010", "011", "100", "101", "110", "111"]);
    expect(rows.map((r) => r.levels.S)).toEqual([0, 1, 1, 0, 1, 0, 0, 1]);
    expect(rows.map((r) => r.levels.Cout)).toEqual([0, 0, 0, 1, 0, 1, 1, 1]);
    expect(levels(adder, { A: 1, B: 0, Cin: 1 })).toEqual({
      A: 1,
      B: 0,
      Cin: 1,
      AxB: 1,
      AB: 0,
      CinAxB: 1,
      S: 0,
      Cout: 1,
    });
  });

  it("names every net's level on every row net[row], the same whatever the inputs", () => {
    const q = quantities(adder);
    expect(Object.keys(q)).toHaveLength(8 * 8);
    expect(q["S[101]"]).toBe(0);
    expect(q["Cout[101]"]).toBe(1);
    expect(q["AxB[110]"]).toBe(0);
  });

  it("evaluates every gate kind", () => {
    expect(column(oneGate("and"), "y")).toEqual([0, 0, 0, 1]);
    expect(column(oneGate("or"), "y")).toEqual([0, 1, 1, 1]);
    expect(column(oneGate("xor"), "y")).toEqual([0, 1, 1, 0]);
    expect(column(oneGate("nand"), "y")).toEqual([1, 1, 1, 0]);
    expect(column(oneGate("nor"), "y")).toEqual([1, 0, 0, 0]);
    expect(column(oneGate("xnor"), "y")).toEqual([1, 0, 0, 1]);
    expect(column(oneGate("not"), "y")).toEqual([1, 0]);
  });

  it("finds nothing wrong with the full adder", () => {
    expect(logicProblems(adder)).toEqual([]);
  });

  it("names a net with two drivers, a terminal with no role and a loop", () => {
    const twoDrivers: LogicModel = {
      ...oneGate("and"),
      nets: [
        { id: "ab", pins: ["A.t", "B.t", "G.in1", "G.in2"] },
        { id: "y", pins: ["G.out", "Y.t"] },
      ],
    };
    expect(logicProblems(twoDrivers)).toEqual([
      "net ab has 2 drivers (A.t, B.t): a gate output or an input drives each net, once",
    ]);
    expect(logicProblems({ ...oneGate("and"), outputs: [] })).toEqual([
      "terminal Y must be listed once, as an input or an output",
    ]);
    const loop: LogicModel = {
      parts: [
        { id: "A", kind: "port" },
        { id: "G1", kind: "nand" },
        { id: "G2", kind: "nand" },
        { id: "Y", kind: "port" },
      ],
      nets: [
        { id: "a", pins: ["A.t", "G1.in1", "G2.in2"] },
        { id: "q", pins: ["G1.out", "G2.in1", "Y.t"] },
        { id: "p", pins: ["G2.out", "G1.in2"] },
      ],
      inputs: ["A"],
      outputs: ["Y"],
    };
    expect(logicProblems(loop)).toEqual([
      "gates G1, G2 feed each other round a loop, or read a net nothing drives: a combinational netlist settles",
    ]);
  });
});
