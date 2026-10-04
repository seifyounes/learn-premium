import { describe, expect, it } from "vitest";
import { drawingGate } from "../gates/drawing.ts";
import { runControls } from "../gates/runner.ts";
import { truthTableGate } from "../gates/sims.ts";
import { FIXTURE_COURSE, fixtureWith } from "./build-course";

const MODULE = "04-full-adder";
const SIM = `modules/${MODULE}/sims/adder.json`;
const READING = `build-records/figure/${MODULE}/adder.json`;
const LOG = `build-records/recompute/${MODULE}/adder.json`;
const WORKED = `modules/${MODULE}/worked/1.json`;

const drawing = (contentDir: string) => drawingGate.run({ contentDir, module: MODULE });
const truth = (contentDir: string) => truthTableGate.run({ contentDir, module: MODULE });

describe("the Drawing gate", () => {
  it("passes the full adder, every check run and every mutant of the negative control caught", async () => {
    const result = await drawing(FIXTURE_COURSE);
    expect(result.findings).toEqual([]);
    expect(result.coverage).toEqual({ modules: 1, drawings: 1, checks: 12, mutantsCaught: 8, mutantsSkipped: 0 });
  });

  it("covers a Module with no schematic sim without checking anything in it", async () => {
    const result = await drawingGate.run({ contentDir: FIXTURE_COURSE, module: "03-gradient-descent" });
    expect(result).toEqual({
      coverage: { modules: 1, drawings: 0, checks: 0, mutantsCaught: 0, mutantsSkipped: 0 },
      findings: [],
    });
  });

  it("blocks a figure the Blind reader read differently from the model", async () => {
    const course = fixtureWith(READING, (s) =>
      s.replace('"label": "below"\n    },\n    "G5"', '"label": "above"\n    },\n    "G5"'),
    );
    const result = await drawing(course);
    expect(result.findings).toEqual([
      {
        outcome: "block",
        at: SIM,
        message: "drawing ↔ figure, label side: G4's label is drawn below it, the figure prints it above",
      },
    ]);
  });

  it("blocks a schematic sim whose figure no Blind reader read", async () => {
    const course = fixtureWith(READING, () => "{}");
    const result = await drawing(course);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.message).toMatch(
      /^the figure reading build-records\/figure\/04-full-adder\/adder\.json isn't one/,
    );
  });

  it("blocks a hand-placed coordinate: the Layout hints have no field for one", async () => {
    const course = fixtureWith(SIM, (s) =>
      s.replace('"Cin": {\n        "at": [', '"Cin": {\n        "x": 240,\n        "at": ['),
    );
    const result = await drawing(course);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.message).toMatch(/content contract reports layout\.parts\.Cin: Unrecognized key: "x"/);
  });

  it("catches every negative control it plants", async () => {
    const result = await runControls({ input: { contentDir: FIXTURE_COURSE, module: MODULE }, gates: [drawingGate] });
    expect(result.gates[0]?.controls.filter((c) => !c.caught)).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe("the truth-table gate", () => {
  it("passes the full adder: every sheet bit and every recomputed row agree with the engine", async () => {
    const result = await truth(FIXTURE_COURSE);
    expect(result.findings).toEqual([]);
    expect(result.coverage).toEqual({ modules: 1, sims: 1, sheetValues: 40, recomputedValues: 64, stepThroughs: 0 });
  });

  it("blocks a recompute that disagrees with the engine on a bit, compared exactly", async () => {
    const course = fixtureWith(LOG, (s) => s.replace('"Cout[101]": 1', '"Cout[101]": 0'));
    const result = await truth(course);
    expect(result.findings).toEqual([
      {
        outcome: "block",
        at: SIM,
        message:
          "Cout[101] (sheet cell H6): the engine gives 1 but the independent recompute gives 0; fix whichever is wrong",
      },
    ]);
  });

  it("raises a sheet bit the engine and the recompute agree against as a Checkpoint item", async () => {
    // Row 101 of the sheet, its S cell printed 1 instead of 0.
    const row = (s: string) =>
      `[\n        ${s
        .split("")
        .map((b) => `"${b}"`)
        .join(",\n        ")}`;
    const course = fixtureWith(WORKED, (s) => s.replace(row("10110"), row("10111")));
    const result = await truth(course);
    expect(result.findings).toEqual([
      {
        outcome: "checkpoint",
        at: WORKED,
        message:
          "sheet cell E6 prints 1, but the engine and the independent recompute both give 0 (S[101]): rule it a Slip or a Divergence",
      },
    ]);
  });

  it("blocks a recompute that leaves out a row", async () => {
    const course = fixtureWith(LOG, (s) => s.replace('    "Cout[000]": 0,\n', ""));
    const result = await truth(course);
    expect(result.findings.map((f) => f.message)).toEqual([
      "sheet cell H1 maps Cout[000], which the recompute log doesn't give",
      "the recompute log doesn't give Cout[000]: a truth table's recompute works out every row",
    ]);
  });

  it("catches every negative control it plants", async () => {
    const result = await runControls({
      input: { contentDir: FIXTURE_COURSE, module: MODULE },
      gates: [truthTableGate],
    });
    expect(result.gates[0]?.controls.filter((c) => !c.caught)).toEqual([]);
    expect(result.ok).toBe(true);
  });
});
