// The ladder gate on the Fixture Course's Module 10 (the two conveyors, the fan's hard-wired starter
// and the tank's FBD alarm): bit for bit with awlsim after
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
  it("passes the two conveyors, the fan's starter and the tank's alarm against awlsim and against the key", async () => {
    const result = await ladderGate.run(input);
    expect(result.findings).toEqual([]);
    // Conveyors 7 cases; the starter 9 (the example, each input held at 0 and at 1 except E-Stop at 0,
    // which is the example itself, and one written); the alarm 10.
    expect(result.coverage).toMatchObject({ modules: 1, sims: 3, cases: 26, sheetValues: 15 });
    // Conveyors: 5 × 91 + 91 + 21; the starter: 8 × 41 + 21; the alarm: 9 × 16 + 17 scans.
    expect(result.coverage.scans).toBe(567 + 349 + 161);
    // Conveyors reach the TON and parallel-branch engines; the starter the NC, parallel-branch and
    // hard-wired coil ones; the alarm the negated input's. The S5 and counter ones nowhere.
    expect(result.coverage).toMatchObject({ controlsCaught: 6, controlsNotReached: 18 });
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
    // The conveyors, the starter (a right rail, a coil passing current on) and the alarm (negated box inputs).
    expect(result.coverage).toMatchObject({ modules: 1, drawings: 3, checks: 36 });
    expect(result.coverage.mutantsCaught).toBeGreaterThan(0);
  });

  it("blocks a preset the model mistypes against the value the screenshot prints", () => {
    const s = sim.parse(parse(readFileSync(join(FIXTURE_COURSE, SIM), "utf8")));
    if (s.kind !== "ladder") throw new Error("not a ladder sim");
    const reading = figureReading.parse(
      JSON.parse(readFileSync(join(FIXTURE_COURSE, "build-records/figure", MODULE, "conveyors.json"), "utf8")),
    );
    const parts = s.model.parts.map((p) => (p.kind === "ton" ? { ...p, params: { ...p.params, PT: "T#4S" } } : p));
    const model = schematicModelOf({ ...s, model: { ...s.model, parts } });
    const verdict = checkDrawing(layOut(model, s.layout), model, reading);
    expect(verdict.checks.find((c) => c.id === "netlist")?.problems).toEqual([
      'N2 ton DB1\'s PT is "T#4S" in the model, the figure prints "T#5S"',
    ]);
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
