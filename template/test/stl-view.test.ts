// What the STL sim's page reads off a trace: each accumulator as the type its last writer gave it,
// AR 1 as a pointer, the status word bit by bit with what FC105 left as "?", and a statement's writes.
import { describe, expect, it } from "vitest";
import { StlRun, type StlModel } from "../src/sims/stl/engine.ts";
import { accumulatorTypes, describeWrites, pointer, readAccumulator, statusBits } from "../src/sims/stl/view.ts";

const model: StlModel = {
  source: [
    "ORGANIZATION_BLOCK OB 1",
    "BEGIN",
    "      L     MD     0",
    "      L     2.5",
    "      *R",
    "      A     I      0.0",
    "      =     Q      0.0",
    "      L     MW     4",
    "      ITD",
    "      TAK",
    "      T     MD     8",
    "END_ORGANIZATION_BLOCK",
  ].join("\n"),
  inputs: { "MD 0": "REAL", "MW 4": "INT", "I 0.0": "BOOL" },
  watch: { "MD 8": "REAL" },
};

describe("the STL sim's readings", () => {
  it("reads an accumulator as the type its last writer gave it, through logic, loads and TAK", () => {
    const trace = new StlRun(model).scan({ "MD 0": 4, "MW 4": -3, "I 0.0": 1 });
    expect(accumulatorTypes(trace, model).map((t) => `${t.accu1}/${t.accu2}`)).toEqual([
      "REAL/INT",
      "REAL/REAL",
      "REAL/REAL",
      "REAL/REAL",
      "REAL/REAL",
      "INT/REAL",
      "DINT/REAL",
      "REAL/DINT",
      "REAL/DINT",
      "REAL/DINT",
    ]);
    expect(readAccumulator(trace[2]?.accu1 ?? 0, "REAL")).toEqual({ hex: "16#4120_0000", value: "10.0", type: "REAL" });
    expect(readAccumulator(trace[6]?.accu1 ?? 0, "DINT").value).toBe("L#-3");
    expect(readAccumulator(0xfffd, "INT").value).toBe("-3");
  });

  it("shows AR 1 as a pointer, a bit FC105 left as ?, and a statement's writes byte by byte", () => {
    expect(pointer((60 << 3) | 2)).toBe("P#60.2");
    expect(statusBits({ status: 0b10, leftBy: { OV: "FC105" } }).slice(0, 6)).toEqual([
      { bit: "/FC", value: 0 },
      { bit: "RLO", value: 1 },
      { bit: "STA", value: 0 },
      { bit: "OR", value: 0 },
      { bit: "OS", value: 0 },
      { bit: "OV", value: "?", leftBy: "FC105" },
    ]);
    expect(
      describeWrites([
        { area: "M", offset: 9, value: 0x80 },
        { area: "M", offset: 8, value: 0x3f },
        { area: "Q", offset: 0, value: 1 },
      ]),
    ).toEqual(["MB 8..9 = 3F 80", "QB 0 = 01"]);
  });
});
