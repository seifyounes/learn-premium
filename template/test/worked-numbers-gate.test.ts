import { rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runControls } from "../gates/runner.ts";
import { workedNumbers } from "../gates/worked-numbers.ts";
import { FIXTURE_COURSE, fixtureWith } from "./build-course";

const MODULE = "01-thermal-resistance";
const WORKED = `modules/${MODULE}/worked/1.json`;
const LOG = `build-records/recompute/${MODULE}/worked-1.json`;
const run = (contentDir: string) => workedNumbers.run({ contentDir, module: MODULE });

describe("the worked-numbers gate", () => {
  it("passes the Fixture Course, where the recompute agrees with every worked-out number", async () => {
    const result = await run(FIXTURE_COURSE);
    expect(result.findings).toEqual([]);
    // W01.1's eight worked-out cells against its log; W01.2's five are the plate sim's.
    expect(result.coverage).toEqual({ modules: 1, workedExamples: 2, cells: 8, simCells: 5 });
  });

  it("passes a Module with no Worked example, having looked in it, and covers nothing for a Module that doesn't exist", async () => {
    const none = await workedNumbers.run({ contentDir: FIXTURE_COURSE, module: "02-convection" });
    expect(none).toEqual({ coverage: { modules: 1, workedExamples: 0, cells: 0, simCells: 0 }, findings: [] });
    const missing = await workedNumbers.run({ contentDir: FIXTURE_COURSE, module: "09-missing" });
    expect(Object.values(missing.coverage).every((n) => n === 0)).toBe(true);
  });

  it("checks the whole Course: only cells no live sim maps need a Worked example's log", async () => {
    const result = await workedNumbers.run({ contentDir: FIXTURE_COURSE });
    expect(result.findings).toEqual([]);
    expect(result.coverage.workedExamples).toBeGreaterThanOrEqual(5);
  });

  it("blocks a Worked example no recompute checked, naming the cells", async () => {
    const course = fixtureWith(LOG, (s) => s);
    rmSync(join(course, LOG));
    const result = await run(course);
    expect(result.findings).toEqual([
      {
        outcome: "block",
        at: WORKED,
        message: `no recompute log at ${LOG}: every number a Worked example works out is checked against an independent recompute (D1, E1, D2, E2, D3, E3, D4, E4)`,
      },
    ]);
  });

  it("raises a Checkpoint item when the sheet and the recompute disagree, showing both values", async () => {
    const course = fixtureWith(WORKED, (s) => s.replace('"0.25", "4.06"', '"0.25", "4.60"'));
    const result = await run(course);
    expect(result.findings).toEqual([
      {
        outcome: "checkpoint",
        at: WORKED,
        message: "sheet cell E2 prints 4.60, but the independent recompute gives 4.06: rule it a Slip or a Divergence",
      },
    ]);
  });

  it("sees a sign error in a labelled cell, and reads scientific notation as one value", async () => {
    const signed = fixtureWith(WORKED, (s) =>
      s.replace('["Plaster", "0.02", "0.5", "0.04"', '["Plaster", "0.02", "0.5", "$R = -0.04$"'),
    );
    expect((await run(signed)).findings.map((f) => [f.outcome, f.message])).toEqual([
      [
        "checkpoint",
        "sheet cell D1 prints -0.04, but the independent recompute gives 0.04: rule it a Slip or a Divergence",
      ],
    ]);
    const scientific = fixtureWith(WORKED, (s) =>
      s.replace('["Plaster", "0.02", "0.5", "0.04"', '["Plaster", "0.02", "0.5", "$4.0 \\\\times 10^{-2}$"'),
    );
    expect((await run(scientific)).findings).toEqual([]);
  });

  it("agrees within one in the sheet's last printed digit, as a hand rounds", async () => {
    const course = fixtureWith(WORKED, (s) => s.replace('"0.25", "4.06"', '"0.25", "4.07"'));
    expect((await run(course)).findings).toEqual([]);
  });

  it("ships a value the Owner ruled a Divergence as printed", async () => {
    const course = fixtureWith(WORKED, (s) =>
      s
        .replace('"0.25", "4.06"', '"0.25", "4.60"')
        .replace(
          '"slips": [',
          '"divergences": [{ "value": "$4.60$", "note": "The recompute gives 4.06." }], "slips": [',
        ),
    );
    expect((await run(course)).findings).toEqual([]);
  });

  it("lets one Divergence on a value cover one cell: a second cell printing the same wrong value is asked again", async () => {
    const course = fixtureWith(WORKED, (s) =>
      s
        .replace('"0.25", "4.06"', '"0.25", "4.60"')
        .replace('"0.04", "0.65"', '"0.04", "4.60"')
        .replace(
          '"slips": [',
          '"divergences": [{ "value": "$4.60$", "note": "The recompute gives 4.06." }], "slips": [',
        ),
    );
    expect((await run(course)).findings).toEqual([
      expect.objectContaining({ outcome: "checkpoint", message: expect.stringMatching(/^sheet cell E2 prints 4\.60/) }),
    ]);
  });

  it("blocks a Slip whose corrected value isn't its own cell's recomputed value, or that names no cell", async () => {
    const slip = (value: string, cell: string) =>
      fixtureWith(WORKED, (s) =>
        s
          .replace('"value": "$R_\\\\text{total} = 1.54\\\\ \\\\text{K/W}$"', `"value": "${value}"`)
          .replace('"cell": "D4",', cell),
      );
    // 25.00 is a number the recompute gives (E4), but not D4's, the cell the Slip corrects.
    expect((await run(slip("$25.00$", '"cell": "D4",'))).findings).toEqual([
      {
        outcome: "block",
        at: WORKED,
        message:
          "the Slip on 1.45 (cell D4) ships 25.00 as the corrected value, but the independent recompute gives 1.54 for D4",
      },
    ]);
    expect((await run(slip("$1.54$", ""))).findings.map((f) => f.message)).toEqual([
      "the Slip on 1.45 names no cell: give the sheet cell it corrects (cell), so its corrected value can be checked",
    ]);
  });

  it("holds a Slip's corrected value to its sign, and to a live sim's recompute on the cells the sim maps", async () => {
    const signed = fixtureWith(WORKED, (s) =>
      s.replace('"value": "$R_\\\\text{total} = 1.54\\\\ \\\\text{K/W}$"', '"value": "$R_\\\\text{total} = -1.54$"'),
    );
    expect((await run(signed)).findings.map((f) => f.message)).toEqual([
      "the Slip on 1.45 (cell D4) ships -1.54 as the corrected value, but the independent recompute gives 1.54 for D4",
    ]);
    // W01.2's B3 is the plate sim's: its recompute log gives 44.87.
    const onSim = fixtureWith(`modules/${MODULE}/worked/2.json`, (s) =>
      s.replace(
        '"provenance": {',
        '"provenance": {\n    "slips": [{ "cell": "B3", "value": "$48.9$", "sheet": "$49.4$" }],',
      ),
    );
    expect((await run(onSim)).findings.map((f) => f.message)).toEqual([
      "the Slip on 49.4 (cell B3) ships 48.9 as the corrected value, but the independent recompute gives 44.9 for B3",
    ]);
  });

  it("blocks a value the Owner ruled a Slip that the sheet still prints", async () => {
    // The Fixture's own Slip: the sheet printed 1.45 for the total, the site ships 1.54.
    const course = fixtureWith(WORKED, (s) =>
      s.replace('["Total", "", "", "1.54", "25.00"]', '["Total", "", "", "1.45", "25.00"]'),
    );
    const result = await run(course);
    expect(result.findings).toEqual([
      {
        outcome: "block",
        at: WORKED,
        message: "sheet cell D4 prints 1.45, which the Owner ruled a Slip: the site ships the corrected value, 1.54",
      },
    ]);
  });

  it("blocks a recompute log that leaves a cell out or gives one the sheet doesn't work out", async () => {
    const course = fixtureWith(LOG, (s) => s.replace('"D1": 0.04,', '"B1": 0.02,'));
    const result = await run(course);
    expect(result.findings.map((f) => f.message)).toEqual([
      `the recompute log ${LOG} gives B1, which isn't a number the sheet works out`,
      `the recompute log ${LOG} doesn't give sheet cell D1: the recompute works out every number`,
    ]);
  });

  it("catches every one of its negative controls", async () => {
    const result = await runControls({ input: { contentDir: FIXTURE_COURSE, module: MODULE }, gates: [workedNumbers] });
    expect(result.ok, JSON.stringify(result, null, 2)).toBe(true);
  });
});
