// The ladder gate on the Fixture Course's two conveyors (Module 10): bit for bit with awlsim after
// every scan of every case, every rung segment powered and unpowered, the TON run out, the broken
// engines its cases reach each caught, the sheet (the Worked example's key) three ways; and each of
// the gate's own negative controls is caught. The Drawing gate takes the Blind reader's reading of
// the module's STEP 7 editor screenshot.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { drawingGate } from "../gates/drawing.ts";
import { ladderGate } from "../gates/ladder.ts";
import { runControls } from "../gates/runner.ts";
import { sim } from "../src/content/contract.ts";
import { schematicModelOf } from "../src/sims/kinds.ts";
import { checkDrawing, figureReading } from "../src/sims/layout/check.ts";
import { layOut } from "../src/sims/layout/layout.ts";
import { FIXTURE_COURSE } from "./build-course";

const MODULE = "10-two-conveyors";
const SIM = `modules/${MODULE}/sims/conveyors.yaml`;
const input = { contentDir: FIXTURE_COURSE, module: MODULE };

describe("the ladder gate", () => {
  it("passes the two conveyors against awlsim and against the key", async () => {
    const result = await ladderGate.run(input);
    expect(result.findings).toEqual([]);
    expect(result.coverage).toMatchObject({ modules: 1, sims: 1, cases: 5, sheetValues: 15 });
    // The example, each input held at its other value, and the two written timelines: 91 + 91 + 91 + 91 + 21 scans.
    expect(result.coverage.scans).toBe(385);
    // A TON and NO contacts: the TON and parallel-branch engines are reached; the NC, S5 and counter ones aren't.
    expect(result.coverage).toMatchObject({ controlsCaught: 2, controlsNotReached: 4 });
  });

  it("blocks a rung no case powers, and only that", async () => {
    const control = ladderGate.controls.find((c) => /no case ever powers/.test(c.defect));
    if (!control) throw new Error("no such control");
    const planted = control.plant(input, mkdtempSync(join(tmpdir(), "lp-ladder-")));
    const result = await ladderGate.run(planted);
    expect(result.findings).toEqual([
      {
        outcome: "block",
        at: SIM,
        message:
          "net plantRung never carries power in any case, so nothing checks that part of the engine against awlsim; add a case (a timeline) that reaches it",
      },
    ]);
  });

  it("catches each of its negative controls", async () => {
    const result = await runControls({ input, gates: [ladderGate] });
    expect(result.gates[0]?.controls.map((c) => [c.defect, c.caught])).toEqual(
      ladderGate.controls.map((c) => [c.defect, true]),
    );
  });
});

describe("the Drawing gate on an editor screenshot", () => {
  it("accepts the Blind reader's reading of the STEP 7 screenshot, keyed by network, kind and operand", async () => {
    const result = await drawingGate.run(input);
    expect(result.findings).toEqual([]);
    expect(result.coverage).toMatchObject({ modules: 1, drawings: 1, checks: 12 });
    expect(result.coverage.mutantsCaught).toBeGreaterThan(0);
  });

  it("blocks a model whose seal-in branch the screenshot doesn't show", () => {
    const raw = parse(readFileSync(join(FIXTURE_COURSE, SIM), "utf8"));
    const s = sim.parse(raw);
    if (s.kind !== "ladder") throw new Error("not a ladder sim");
    const reading = figureReading.parse(
      JSON.parse(readFileSync(join(FIXTURE_COURSE, "build-records/figure", MODULE, "conveyors.json"), "utf8")),
    );
    const model = schematicModelOf(s);
    const unsealed = {
      ...reading,
      nets: reading.nets.map((n) => ({ ...n, pins: n.pins.filter((p) => p !== "N1 no Q4.0.out") })),
    };
    const verdict = checkDrawing(layOut(model, s.layout), model, unsealed);
    expect(verdict.checks.find((c) => c.id === "netlist")?.problems).toEqual([
      "N1 no Q4.0.out is wired in the model, but the figure leaves it unconnected",
    ]);
  });
});
