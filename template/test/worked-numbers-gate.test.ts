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
