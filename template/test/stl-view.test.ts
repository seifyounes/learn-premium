// What the STL sim's page reads off a trace: each accumulator as the type its last writer gave it,
// AR 1 as a pointer, the status word bit by bit with what FC105 left as "?", and a statement's writes.
import { describe, expect, it } from "vitest";
import { courseListings } from "../oracle/listings.ts";
import { FIXTURE_COURSE } from "./build-course";
import { StlRun, type StlModel } from "../src/sims/stl/engine.ts";
import {
  accumulatorTypes,
  describeWrites,
  pointer,
  readAccumulator,
  statusBits,
  typesAfter,
} from "../src/sims/stl/view.ts";

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
    // A 32-bit shift fills all of ACCU 1: it reads as a DINT (Codex review).
    expect(
      accumulatorTypes(
        [
          { op: "L", text: "L#65536", ar1: 0 },
          { op: "SLD", text: "1", ar1: 0 },
        ],
        model,
      )[1]?.accu1,
    ).toBe("DINT");
  });

  it("reads a load by the type last transferred to its address, an indirect one through AR 1 (Codex review)", () => {
    const [tank] = courseListings(FIXTURE_COURSE, "06-tank-level").listings;
    if (!tank) throw new Error("no tank listing");
    const run = new StlRun(tank.model);
    const trace = run.scan(tank.cases[0]?.scans[0] ?? {});
    const types = accumulatorTypes(trace, tank.model);
    const read = (i: number) => readAccumulator(trace[i]?.accu1 ?? 0, types[i]?.accu1 ?? "INT").value;
    const temporary = trace.findIndex((t) => t.op === "L" && t.text.replace(/\s+/g, " ") === "MD 12");
    expect(read(temporary)).toBe("1.0");
    const setPoints = trace.flatMap((t, i) => (t.op === "L" && t.text.includes("[AR1") ? [read(i)] : []));
    expect(setPoints).toEqual(["1000.0", "3000.0", "10000.0", "12000.0"]);
  });

  it("carries the type transferred to memory into the next scan, whose load reads it (Codex review)", () => {
    const listing: StlModel = {
      source: [
        "ORGANIZATION_BLOCK OB 1",
        "BEGIN",
        "      L     MD   100",
        "      L     1.5",
        "      T     MD   100",
        "END_ORGANIZATION_BLOCK",
      ].join("\n"),
      inputs: {},
      watch: { "MW 0": "INT" },
    };
    const run = new StlRun(listing);
    const first = run.scan({});
    const second = run.scan({});
    const carried = typesAfter(first, listing, new Map());
    const types = accumulatorTypes(second, listing, new Map(carried));
    expect(readAccumulator(second[0]?.accu1 ?? 0, types[0]?.accu1 ?? "INT").value).toBe("1.5");
  });

  it("types what a library block writes: FC105's OUT reads as a REAL when loaded back (Codex review)", () => {
    const listing: StlModel = {
      source: [
        "ORGANIZATION_BLOCK OB 1",
        "BEGIN",
        "      CALL  FC   105",
        "       IN     :=MW0",
        "       HI_LIM :=2.000000e+000",
        "       LO_LIM :=0.000000e+000",
        "       BIPOLAR:=FALSE",
        "       RET_VAL:=MW8",
        "       OUT    :=MD4",
        "      L     MD     4",
        "END_ORGANIZATION_BLOCK",
      ].join("\n"),
      inputs: { "MW 0": "INT" },
      watch: { "MW 8": "WORD" },
    };
    const trace = new StlRun(listing).scan({ "MW 0": 13824 });
    const types = accumulatorTypes(trace, listing);
    expect(readAccumulator(trace[1]?.accu1 ?? 0, types[1]?.accu1 ?? "INT").value).toBe("1.0");
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
