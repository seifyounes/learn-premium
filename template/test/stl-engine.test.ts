// The STL interpreter at its interface: a listing run a statement or a scan at a time with a trace,
// on the points where the manual leaves the CPU's behaviour open and awlsim decides (#37).
import { describe, expect, it } from "vitest";
import { STATUS_BITS } from "../src/sims/s7/core.ts";
import { quantities, StlRun, unsupportedStatements, type StlModel } from "../src/sims/stl/engine.ts";
import { ListingError, parseStl } from "../src/sims/stl/parse.ts";
import { stlProblems } from "../src/sims/stl/validate.ts";

const ob1 = (...lines: string[]) => ["ORGANIZATION_BLOCK OB 1", "BEGIN", ...lines, "END_ORGANIZATION_BLOCK"].join("\n");
const model = (source: string, inputs: StlModel["inputs"] = {}, watch: StlModel["watch"] = { "MW 0": "INT" }) => ({
  source,
  inputs,
  watch,
});
const bits = (status: number) => Object.fromEntries(STATUS_BITS.map((b, i) => [b, (status >> i) & 1]));

describe("a scan", () => {
  it("starts OB 1 with the accumulators, AR 1 and the status word cleared, whatever the last scan left (awlsim; the manual is silent)", () => {
    const run = new StlRun(model(ob1("      L     MW     0", "      L     1", "      SET", "      LAR1  P#4.0")));
    run.scan({});
    const second = run.scan({});
    expect(second[0]).toMatchObject({ accu1: 0, accu2: 0, ar1: 0, status: 0 });
  });

  it("ends at OB 1's block end, which sets STA and clears OS, OR and /FC (manual 10.2)", () => {
    const run = new StlRun(model(ob1("      L     32767", "      L     1", "      +I", "      A     I      0.0")));
    const trace = run.scan({});
    const end = trace.at(-1);
    expect(end).toMatchObject({ op: "BE", line: 6 });
    expect(bits(end?.status ?? 0)).toMatchObject({ STA: 1, OS: 0, OR: 0, "/FC": 0, OV: 1 });
  });

  it("can be stepped a statement at a time, each step the same entry a whole scan gives", () => {
    const m = model(ob1("      L     MW     2", "      L     3", "      *I", "      T     MW     0"), {
      "MW 2": "INT",
    });
    const whole = new StlRun(m).scan({ "MW 2": 7 });
    const run = new StlRun(m);
    run.begin({ "MW 2": 7 });
    const stepped = [];
    while (!run.between) stepped.push(run.step());
    expect(stepped).toEqual(whole);
    expect(run.watch()).toEqual({ "MW 0": 21 });
  });

  it("keeps memory from one scan to the next, and rereads the inputs each scan", () => {
    const m = model(ob1("      L     MW     0", "      L     MW     2", "      +I", "      T     MW     0"), {
      "MW 2": "INT",
    });
    const run = new StlRun(m);
    run.scan({ "MW 2": 5 });
    run.scan({ "MW 2": 10 });
    expect(run.watch()).toEqual({ "MW 0": 15 });
  });

  it("stops a scan that never reaches its block end", () => {
    const run = new StlRun(model(ob1("LOOP: JU    LOOP")));
    expect(() => run.scan({})).toThrow(/without ending/);
  });
});

describe("instructions the manual leaves open", () => {
  it("a compare writes the RLO outright: it doesn't AND into the open string (manual 2.2; the prototype's exam trap)", () => {
    const m = model(
      ob1("      A     I      0.0", "      L     5", "      L     3", "      >I", "      =     Q      0.0"),
      {
        "I 0.0": "BOOL",
      },
      { "Q 0.0": "BOOL" },
    );
    expect(quantities(m, { "I 0.0": 0 })).toEqual({ "Q 0.0": 1 });
  });

  it("*I leaves the 32-bit product in ACCU 1 and sets OV past INT (manual 7.5; the spike kept 16 bits)", () => {
    const m = model(
      ob1("      L     200", "      L     200", "      *I", "      T     MD     0"),
      {},
      { "MD 0": "DINT" },
    );
    expect(quantities(m, {})).toEqual({ "MD 0": 40000 });
    const trace = new StlRun(m).scan({});
    expect(bits(trace[2]?.status ?? 0)).toMatchObject({ OV: 1, OS: 1, CC1: 1, CC0: 0 });
  });

  it("+I keeps ACCU 1's high word and wraps the low one", () => {
    const run = new StlRun(model(ob1("      L     1", "      L     L#98303", "      +I")));
    const trace = run.scan({});
    expect(trace[2]?.accu1).toBe(0x00018000);
  });
});

describe("FC105's leftovers", () => {
  const scaled = (...after: string[]) =>
    model(
      ob1(
        "      CALL  FC   105",
        "       IN     :=MW2",
        "       HI_LIM :=1.000000e+002",
        "       LO_LIM :=0.000000e+000",
        "       BIPOLAR:=FALSE",
        "       RET_VAL:=MW4",
        "       OUT    :=MD6",
        ...after,
      ),
      { "MW 2": "INT" },
      { "MD 6": "REAL", "MW 4": "WORD" },
    );

  it("are the accumulators, the RLO, CC, OV and BR, shown as left by FC105 until a statement writes them", () => {
    const trace = new StlRun(scaled("      L     MW     4", "      A     I      0.0")).scan({ "MW 2": 13824 });
    expect(trace[0]?.leftBy).toEqual({
      ACCU1: "FC105",
      ACCU2: "FC105",
      RLO: "FC105",
      CC0: "FC105",
      CC1: "FC105",
      OV: "FC105",
      BR: "FC105",
    });
    expect(trace[1]?.leftBy).toEqual({
      ACCU2: "FC105",
      RLO: "FC105",
      CC0: "FC105",
      CC1: "FC105",
      OV: "FC105",
      BR: "FC105",
    });
    expect(trace[2]?.leftBy).toEqual({ ACCU2: "FC105", CC0: "FC105", CC1: "FC105", OV: "FC105", BR: "FC105" });
    expect(bits(trace[0]?.status ?? 0)).toMatchObject({ STA: 1, OS: 0, OR: 0, "/FC": 0 });
  });

  it("can't be read: a statement that reads one stops the run, naming FC105", () => {
    expect(() => new StlRun(scaled("      T     MW     8")).scan({ "MW 2": 1 })).toThrow(
      /reads ACCU 1, which FC105 left undefined/,
    );
    expect(() => new StlRun(scaled("      A     BR")).scan({ "MW 2": 1 })).toThrow(
      /reads BR, which FC105 left undefined/,
    );
  });

  it("don't stop what FC105 wrote: OUT and RET_VAL", () => {
    expect(quantities(scaled(), { "MW 2": 27649 })).toEqual({ "MD 6": 100, "MW 4": 8 });
  });
});

describe("the inputs a listing takes", () => {
  it("steps an integer input's slider by whole numbers only (Codex review)", () => {
    const m = model(ob1("      L     MW     2"), { "MW 2": "INT" });
    expect(stlProblems(m, { "MW 2": 0 }, { "MW 2": { min: 0, max: 2, step: 0.5 } }, [])).toEqual([
      { path: ["tune", "MW 2"], message: "MW 2 holds a INT: its slider steps by whole numbers, not 0.5" },
    ]);
  });
});

describe("reading a listing", () => {
  it("keeps every statement's line, and a CALL's parameter lines with it", () => {
    const program = parseStl(
      ob1("NETWORK", "TITLE = one", "NEXT: L     MW     0   // comment", "      CALL  FC   105", "       IN :=MW0"),
    );
    expect(program.statements.map((s) => [s.op, s.line, s.lastLine])).toEqual([
      ["L", 4, 4],
      ["CALL", 5, 6],
      ["BE", 7, 7],
    ]);
    expect(program.labels).toEqual({ NEXT: 0 });
  });

  it("names each statement the interpreter can't run, so the listing ships as a step-through", () => {
    const program = parseStl(
      ob1(
        "      A     T      1",
        "      CALL  FB     1",
        "      SPB   NEXT",
        "NEXT: L     DBW    0",
        "      L     MW     0",
      ),
    );
    expect(unsupportedStatements(program).map((u) => u.statement.line)).toEqual([2, 3, 4, 5]);
  });

  it("refuses what isn't one OB 1 in STEP 7 source form", () => {
    expect(() => parseStl("L MW 0")).toThrow(ListingError);
    expect(() => parseStl(ob1("A:    NOP   0", "A:    NOP   0"))).toThrow(/used twice/);
    expect(() => parseStl(ob1("      JU    NOWH"))).toThrow(/no statement is labelled/);
    expect(() => parseStl("ORGANIZATION_BLOCK OB 1\nBEGIN\n      NOP 0")).toThrow(/END_ORGANIZATION_BLOCK/);
  });
});
