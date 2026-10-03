import { rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runControls } from "../gates/runner.ts";
import { simNumbers } from "../gates/sims.ts";
import { FIXTURE_COURSE, fixtureWith } from "./build-course";

const MODULE = "03-gradient-descent";
const SIM = `modules/${MODULE}/sims/descent.json`;
const WORKED = `modules/${MODULE}/worked/1.json`;
const LOG = `build-records/recompute/${MODULE}/descent.json`;

const run = (contentDir: string) => simNumbers.run({ contentDir, module: MODULE });
/** The Fixture Course with one sheet cell of W03.1 printed as `printed`. */
const sheetWith = (cell: string, printed: string, from = FIXTURE_COURSE) =>
  fixtureWith(WORKED, (s) => s.replace(cell, printed), from);

describe("the sim-numbers gate", () => {
  it("passes the Fixture Course, where the engine, the recompute and the sheet agree", async () => {
    const result = await run(FIXTURE_COURSE);
    expect(result.findings).toEqual([]);
    // Nine sheet cells three ways, the minimum and the α limit two ways; one sim falls back.
    expect(result.coverage).toEqual({ modules: 1, sims: 2, sheetValues: 9, recomputedValues: 13, stepThroughs: 1 });
  });

  it("blocks when the engine and the independent recompute disagree", async () => {
    const course = fixtureWith(LOG, (s) => s.replace('"theta1[1]": 0.36666666666666664', '"theta1[1]": 0.37'));
    const result = await run(course);
    expect(result.findings).toEqual([
      {
        outcome: "block",
        at: SIM,
        message:
          "theta1[1] (sheet cell C2): the engine gives 0.3667 but the independent recompute gives 0.3700, at the sheet's 4 decimals; fix whichever is wrong",
      },
    ]);
  });

  it("blocks an engine number off the sheet that the recompute disagrees with, to 1e-9", async () => {
    const course = fixtureWith(LOG, (s) => s.replace('"alpha.limit": 0.8377223398316206', '"alpha.limit": 0.84'));
    const result = await run(course);
    expect(result.findings).toEqual([
      {
        outcome: "block",
        at: SIM,
        message:
          "alpha.limit: the engine gives 0.8377223398316206 but the independent recompute gives 0.84; fix whichever is wrong",
      },
    ]);
  });

  it("raises a Checkpoint item showing both values when they agree with each other but not the sheet", async () => {
    const result = await run(sheetWith('"0.2667", "0.3667"', '"0.2667", "0.3700"'));
    expect(result.findings).toEqual([
      {
        outcome: "checkpoint",
        at: WORKED,
        message:
          "sheet cell C2 prints 0.3700, but the engine and the independent recompute both give 0.3667 (theta1[1]): rule it a Slip or a Divergence",
      },
    ]);
  });

  it("judges agreement at the sheet's printed precision, ±1 in the last printed digit", async () => {
    // 0.3666… prints as 0.3667; a hand rounding it to 0.3668 or 0.37 still agrees.
    expect((await run(sheetWith('"0.2667", "0.3667"', '"0.2667", "0.3668"'))).findings).toEqual([]);
    expect((await run(sheetWith('"0.2667", "0.3667"', '"0.2667", "0.37"'))).findings).toEqual([]);
    expect((await run(sheetWith('"0.2667", "0.3667"', '"0.2667", "0.3669"'))).findings).toHaveLength(1);
  });

  it("settles a sheet value the Owner ruled a Divergence: the exam's truth, shipped as printed", async () => {
    const course = fixtureWith(WORKED, (s) =>
      s
        .replace('"0.2667", "0.3667"', '"0.2667", "0.3700"')
        .replace(
          '"stated": [',
          '"divergences": [{ "value": "$\\\\theta_1^{(1)} = 0.3700$", "note": "The engine and the recompute give $0.3667$." }],\n    "stated": [',
        ),
    );
    expect((await run(course)).findings).toEqual([]);
  });

  it("blocks a sheet still printing a value the Owner ruled a Slip, rather than asking again", async () => {
    const course = fixtureWith(WORKED, (s) =>
      s
        .replace('"0.2667", "0.3667"', '"0.2667", "0.3700"')
        .replace(
          '"stated": [',
          '"slips": [{ "value": "$\\\\theta_1^{(1)} = 0.3667$", "sheet": "$0.3700$" }],\n    "stated": [',
        ),
    );
    expect((await run(course)).findings).toEqual([
      {
        outcome: "block",
        at: WORKED,
        message:
          "sheet cell C2 prints 0.3700, which the Owner ruled a Slip: the site ships the corrected value, 0.3667 (theta1[1])",
      },
    ]);
  });

  it("blocks a sim that doesn't open on the inputs the recompute took from the Materials", async () => {
    const course = fixtureWith(SIM, (s) => s.replace('"alpha": 0.1, "iterations": 2', '"alpha": 0.2, "iterations": 2'));
    const result = await run(course);
    expect(result.findings).toEqual([
      {
        outcome: "block",
        at: SIM,
        message:
          "the recompute log was worked from other inputs (start.alpha: 0.1 in the log, 0.2 in the sim): the sim opens on the example's values, so fix the sim or recompute from the Materials",
      },
    ]);
  });

  it("blocks a live sim with no recompute log", async () => {
    const course = fixtureWith(LOG, (s) => s);
    rmSync(join(course, LOG));
    const result = await run(course);
    expect(result.findings).toEqual([
      {
        outcome: "block",
        at: SIM,
        message: `no recompute log at ${LOG}: a sim ships live only when an independent recompute checks it; if its model can't be recomputed, mark it recompute: none`,
      },
    ]);
  });

  it("blocks a sheet cell the engine can't give, or that holds no single number", async () => {
    let course = fixtureWith(SIM, (s) => s.replace('"D3": "J[2]"', '"D3": "J[5]"'));
    course = sheetWith('"0.4700", "0.6456"', '"0.4700", ""', course);
    const result = await run(course);
    expect(result.findings.map((f) => f.message)).toEqual([
      "sheet cell C3 (theta1[2]) can't be compared: the cell is blank",
      "sheet cell D3 maps J[5], which the engine doesn't give at the example's inputs",
    ]);
  });

  it("checks nothing three ways on a sim marked non-recomputable: it ships as a step-through", async () => {
    const course = fixtureWith(SIM, (s) => s.replace('"recompute": "independent"', '"recompute": "none"'));
    const result = await run(course);
    // descent.json has no step-through to fall back to: the content contract blocks it.
    expect(result.findings).toEqual([
      expect.objectContaining({ outcome: "block", at: SIM, message: expect.stringMatching(/^can't check the sim/) }),
    ]);
    expect(result.coverage.stepThroughs).toBe(1);
  });

  it("catches every negative control: blocks, and the Checkpoint item for a sheet the two agree against", async () => {
    const result = await runControls({ input: { contentDir: FIXTURE_COURSE, module: MODULE }, gates: [simNumbers] });
    expect(result.gates[0]?.positive).toBe("pass");
    expect(result.gates[0]?.controls.map((c) => [c.expected, c.caught])).toEqual([
      ["block", true],
      ["checkpoint", true],
      ["block", true],
      ["block", true],
    ]);
    expect(result.ok).toBe(true);
  });
});
