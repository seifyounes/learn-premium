// The scl gate on the Fixture Course's SCL listing (Module 09): it agrees with the blind interpreter
// on every variable after every scan of every case, runs every construct it uses, catches the
// engine's negative controls its cases reach, and checks the Worked example's sheet three ways.
// Where the SCL manual is silent, the disagreement goes to the Owner as a Checkpoint item until a
// ruling is recorded; anything else that parts the interpreters blocks.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { runControls } from "../gates/runner.ts";
import { sclGate } from "../gates/scl.ts";
import { runBlind } from "../oracle/scl-blind.ts";
import { runControls as runMutants } from "../src/sims/scl/mutants.ts";
import { gateCases, type BlindScan } from "../src/sims/scl/oracle.ts";
import { FIXTURE_COURSE } from "./build-course";

const MODULE = "09-silo-blender";
const SIM = `modules/${MODULE}/sims/blender.yaml`;
const input = { contentDir: FIXTURE_COURSE, module: MODULE };

/** One of the gate's own controls planted in a scratch copy, then the sim edited further by `edit`. */
function planted(defect: RegExp, edit: (sim: Record<string, unknown>) => Record<string, unknown> = (s) => s) {
  const control = sclGate.controls.find((c) => defect.test(c.defect));
  if (!control) throw new Error(`no control matching ${defect}`);
  const copy = control.plant(input, mkdtempSync(join(tmpdir(), "lp-scl-")));
  const path = join(copy.contentDir, SIM);
  writeFileSync(path, stringify(edit(parse(readFileSync(path, "utf8")) as Record<string, unknown>)));
  return copy;
}

describe("the scl gate", () => {
  it("passes the Fixture Course's listing: the engine and the blind interpreter agree on every scan", async () => {
    const result = await sclGate.run(input);
    expect(result.findings).toEqual([]);
    expect(result.coverage).toMatchObject({
      modules: 1,
      listings: 1,
      cases: 19,
      silentPoints: 0,
      ruled: 0,
      sheetValues: 3,
    });
    expect(result.coverage.scans).toBeGreaterThan(25);
    expect(result.coverage.values).toBeGreaterThan(500);
  });

  it("runs every negative control on the listing, and each one its cases reach is caught (the float64 lesson)", () => {
    const sim = parse(readFileSync(join(FIXTURE_COURSE, SIM), "utf8")) as {
      model: { source: string; block: string; watch: string[] };
      start: Record<string, number>;
      tune: Record<string, { min: number; max: number; step: number }>;
      cases: { name: string; scans: Record<string, number>[] }[];
    };
    const cases = gateCases(sim.start, sim.tune, sim.cases);
    const blind = cases.map(
      (c) =>
        runBlind({
          source: sim.model.source,
          block: sim.model.block,
          scans: c.scans.map((s) => ({ ...s })),
        }) as BlindScan[],
    );
    // No case overflows an INT or compares two equal numbers; every other defect shows and is caught.
    expect(runMutants(sim.model, cases, blind).map((r) => [r.id, r.outcome])).toEqual([
      ["real-float64", "caught"],
      ["int-unwrapped", "not-reached"],
      ["ties-up", "caught"],
      ["exit-ignored", "caught"],
      ["for-short", "caught"],
      ["statics-forgotten", "caught"],
      ["compare-loose", "not-reached"],
    ]);
  });

  describe("a result the SCL manual leaves undefined", () => {
    it("raises a Checkpoint item naming the line, what the blind interpreter found and where to record the ruling", async () => {
      const result = await sclGate.run(planted(/VAR_TEMP read before/));
      expect(result.findings).toEqual([
        {
          outcome: "checkpoint",
          at: SIM,
          message: expect.stringMatching(
            /^the example's values, scan 1: the blind interpreter stops on line 53 \(VAR_TEMP i is read before it is written; .*\), where the engine goes on\. The SCL manual leaves this result undefined: the Owner rules it at the Checkpoint, and the ruling is recorded under silent \(at: "line 53"\)$/,
          ),
        },
      ]);
    });

    it("still waits for the Owner while the point is listed without a ruling", async () => {
      const result = await sclGate.run(
        planted(/VAR_TEMP read before/, (s) => ({ ...s, silent: [{ at: "line 53", point: "VAR_TEMP read first" }] })),
      );
      expect(result.findings.map((f) => f.outcome)).toEqual(["checkpoint"]);
    });

    it("passes once the Owner's ruling is recorded, and then checks the sheet against the engine", async () => {
      const result = await sclGate.run(
        planted(/VAR_TEMP read before/, (s) => ({
          ...s,
          silent: [{ at: "line 53", point: "VAR_TEMP read first", ruling: "a real S7's temp holds 0 here" }],
        })),
      );
      expect(result.findings).toEqual([]);
      expect(result.coverage).toMatchObject({ silentPoints: 0, ruled: 1, sheetValues: 3 });
    });
  });

  describe("a value the interpreters give differently", () => {
    it("blocks: the manual decides, and the side it contradicts is a template defect", async () => {
      const result = await sclGate.run(planted(/not referred to the Owner/));
      expect(result.findings).toEqual([
        {
          outcome: "block",
          at: SIM,
          message: expect.stringMatching(
            /^the interpreters disagree: the example's values, scan 1: planted_sum is -5536 \(DINT\) in the engine, 60000 \(DINT\) in the blind interpreter; .*The S7-SCL manual decides/,
          ),
        },
      ]);
    });

    it("goes to the Owner once the builder lists it as one the manual is silent on", async () => {
      const silent = { at: "planted_sum", point: "The manual says nothing on adding two constants" };
      const waiting = await sclGate.run(planted(/not referred to the Owner/, (s) => ({ ...s, silent: [silent] })));
      expect(waiting.findings).toEqual([
        {
          outcome: "checkpoint",
          at: SIM,
          message: expect.stringMatching(
            /^the example's values, scan 1: planted_sum is -5536 .*The manual says nothing on adding two constants: the Owner rules it/,
          ),
        },
      ]);
      const ruled = await sclGate.run(
        planted(/not referred to the Owner/, (s) => ({ ...s, silent: [{ ...silent, ruling: "the CPU adds INTs" }] })),
      );
      expect(ruled.findings).toEqual([]);
    });
  });

  it("blocks a construct the listing uses that no case runs (the *I lesson), and only that", async () => {
    const result = await sclGate.run(planted(/no gate case runs/));
    expect(result.findings.map((f) => f.message)).toEqual([
      expect.stringMatching(/^line \d+ \(MOD\): no gate case runs it/),
    ]);
  });

  it("blocks a Divergence on a line no case reaches", async () => {
    const result = await sclGate.run(planted(/Divergence on a line/));
    expect(result.findings.map((f) => f.message)).toEqual([
      expect.stringMatching(/^the Divergence on line \d+ sits on a line no gate case runs/),
    ]);
  });

  it("raises a Checkpoint item for a sheet value both interpreters agree against", async () => {
    const result = await sclGate.run(planted(/sheet value/));
    expect(result.findings).toEqual([
      {
        outcome: "checkpoint",
        at: `modules/${MODULE}/worked/1.json`,
        message: expect.stringMatching(
          /^sheet cell D2 prints 313\.2, but the engine and the independent recompute both give 312\.5 \(total_kg\)/,
        ),
      },
    ]);
  });

  it("catches each of its own negative controls", async () => {
    const result = await runControls({ input, gates: [sclGate] });
    expect(result.gates[0]?.controls.map((c) => [c.defect, c.caught])).toEqual(
      sclGate.controls.map((c) => [c.defect, true]),
    );
    expect(result.ok).toBe(true);
  });
});
