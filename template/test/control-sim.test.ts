// The control sim held to the sim gates on the Fixture Course's K/(s(s + 2)) loop (W08.1): its
// numbers three ways against python-control and the sheet, the settling band and rise limits the
// recompute worked to held to the ones the Course style sheet pins, its block diagram through the
// Drawing gate, and python-control kept out of the page.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pinnedDefinitionsGate } from "../gates/definitions.ts";
import { drawingGate } from "../gates/drawing.ts";
import { runControls } from "../gates/runner.ts";
import { importsOracle, simNumbers, toolsGate } from "../gates/sims.ts";
import { sim } from "../src/content/contract.ts";
import { gainsOf, within } from "../src/islands/sim/control-boards.ts";
import { textBox } from "../src/sims/layout/drawing.ts";
import { layOut } from "../src/sims/layout/layout.ts";
import { boxOf } from "../src/sims/layout/symbols.ts";
import { FIXTURE_COURSE, fixtureWith } from "./build-course";

const MODULE = "08-root-locus";
const SIM = `modules/${MODULE}/sims/loop.json`;
const LOG = `build-records/recompute/${MODULE}/loop.json`;
const STYLE = "style-sheet.yaml";

const run = (gate: typeof simNumbers, contentDir: string) => gate.run({ contentDir, module: MODULE });

describe("the control sim through the number gate", () => {
  it("agrees three ways with python-control and the sheet", async () => {
    const result = await run(simNumbers, FIXTURE_COURSE);
    expect(result.findings).toEqual([]);
    // Ten sheet cells three ways; the second pole, the peak and the final value off the sheet, to 1e-9.
    expect(result.coverage).toEqual({ modules: 1, sims: 1, sheetValues: 10, recomputedValues: 14, stepThroughs: 0 });
  });

  it("blocks an engine python-control disagrees with past the sheet's last digit", async () => {
    const course = fixtureWith(LOG, (s) => s.replace(/"Ts": [\d.]+/, '"Ts": 4.05'));
    expect((await run(simNumbers, course)).findings).toEqual([
      {
        outcome: "block",
        at: SIM,
        message:
          "Ts (sheet cell B8): the engine gives 4.038 but the independent recompute gives 4.050, at the sheet's 3 decimals; fix whichever is wrong",
      },
    ]);
  });

  it("reads the settling time by the band the Course style sheet pins: a 5 % band moves it off the sheet", async () => {
    const course = fixtureWith(STYLE, (s) => s.replace("band: 0.02", "band: 0.05"));
    const messages = (await run(simNumbers, course)).findings.map((f) => f.message);
    expect(messages).toContainEqual(
      expect.stringMatching(
        /^Ts \(sheet cell B8\): the engine gives 2\.645 but the independent recompute gives 4\.038/,
      ),
    );
  });

  it("can't run the engine when the Course style sheet pins no settling band", async () => {
    const course = fixtureWith(STYLE, (s) => s.replace(/ {2}settlingTime:\n {4}band: 0\.02\n/, ""));
    expect((await run(simNumbers, course)).findings).toEqual([
      {
        outcome: "block",
        at: SIM,
        message:
          "can't run the engine: the Course style sheet pins no settling-time definition, which a control sim's engine works to",
      },
    ]);
  });
});

describe("the pinned-definitions gate", () => {
  it("passes the loop: its recompute worked to the pinned settling band and rise limits", async () => {
    const result = await run(pinnedDefinitionsGate, FIXTURE_COURSE);
    expect(result).toEqual({ coverage: { modules: 1, sims: 1, definitions: 2 }, findings: [] });
  });

  it("blocks a recompute worked to another settling band than the pinned one", async () => {
    const course = fixtureWith(LOG, (s) => s.replace('"band": 0.02', '"band": 0.05'));
    expect((await run(pinnedDefinitionsGate, course)).findings).toEqual([
      {
        outcome: "block",
        at: SIM,
        message: `${LOG}: the recompute worked to the settling-time definition {"band":0.05}, but the Course style sheet pins {"band":0.02}`,
      },
    ]);
  });

  it("blocks a style sheet that pins no settling band, and a recompute that names none", async () => {
    const unpinned = fixtureWith(STYLE, (s) => s.replace(/ {2}settlingTime:\n {4}band: 0\.02\n/, ""));
    expect((await run(pinnedDefinitionsGate, unpinned)).findings.map((f) => f.message)).toEqual([
      "the Course style sheet pins no settling-time definition, which a control sim's numbers are read by: pin the Professor's in style-sheet.yaml",
    ]);
    const unnamed = fixtureWith(LOG, (s) => s.replace(/"definitions": \{[\s\S]*?\n {2}\},\n/, ""));
    expect((await run(pinnedDefinitionsGate, unnamed)).findings.map((f) => f.message)).toEqual([
      `${LOG}: the recompute log doesn't say which settling-time definition it worked to`,
      `${LOG}: the recompute log doesn't say which rise-time definition it worked to`,
    ]);
  });

  it("catches every planted defect", async () => {
    const result = await runControls({ input: { contentDir: FIXTURE_COURSE }, gates: [pinnedDefinitionsGate] });
    const [gate] = result.gates;
    expect(gate?.positive).toBe("pass");
    for (const control of gate?.controls ?? [])
      expect(control.caught, `${control.defect}: ${control.error ?? ""}`).toBe(true);
    expect(gate?.controls).toHaveLength(3);
  });
});

describe("the block diagram through the Drawing gate", () => {
  it("draws the loop from its hints, every check passed and every mutant caught", async () => {
    const result = await drawingGate.run({ contentDir: FIXTURE_COURSE, module: MODULE });
    expect(result.findings).toEqual([]);
    expect(result.coverage).toEqual({ modules: 1, drawings: 1, checks: 12, mutantsCaught: 8, mutantsSkipped: 0 });
  });

  it("keeps the forward path on one line, block labels inside their boxes, the take-off dotted", () => {
    const parsed = sim.parse(JSON.parse(readFileSync(join(FIXTURE_COURSE, SIM), "utf8")));
    if (parsed.kind !== "control") throw new Error("the Fixture Course's loop is a control sim");
    const drawing = layOut(parsed.model, parsed.layout);
    const at = (id: string) => drawing.parts.find((p) => p.id === id);
    const forward = ["R", "E", "K", "G", "Y"].map((id) => at(id)?.y);
    expect(new Set(forward).size).toBe(1);
    for (const id of ["K", "G"]) {
      const part = at(id);
      const [x0, y0, x1, y1] = part ? boxOf(part) : [0, 0, 0, 0];
      const [tx0, ty0, tx1, ty1] = part?.label ? textBox(part.label) : [0, 0, 0, 0];
      expect(tx0 >= x0 && tx1 <= x1 && ty0 >= y0 && ty1 <= y1, `${id}'s label inside its box`).toBe(true);
    }
    expect(drawing.dots).toHaveLength(1);
  });

  it("blocks a feedback path wired to the junction's plus input, unlike the figure", async () => {
    const course = fixtureWith(SIM, (s) =>
      s.replace('["R.t", "E.in1"]', '["R.t", "E.in2"]').replace('"Y.t", "E.in2"]', '"Y.t", "E.in1"]'),
    );
    const messages = (await drawingGate.run({ contentDir: course, module: MODULE })).findings.map((f) => f.message);
    // The contract refuses the loop first: the engine models negative feedback into in2.
    expect(messages).toContainEqual(expect.stringMatching(/the block diagram isn't a unity-feedback loop/));
  });
});

describe("python-control stays a build-time oracle", () => {
  it("passes the loop's five eligibility checks, its engine run at K's min, mid and max", async () => {
    const result = await toolsGate.run({ contentDir: FIXTURE_COURSE, module: MODULE });
    expect(result.findings).toEqual([]);
    expect(result.coverage).toEqual({
      modules: 1,
      sims: 1,
      pythonTools: 0,
      parts: 0,
      kinds: 1,
      checks: 5,
      engineSamples: 4,
    });
  });

  it("blocks a Pyodide tool that would load python-control in the page", async () => {
    const tool = {
      title: "Planted",
      caption: "Planted",
      source: "locus.py",
      packages: ["control"],
      figure: {
        caption: "Planted",
        x: { label: "x", min: 0, max: 1, step: 0.5 },
        y: { label: "y", min: 0, max: 1, step: 0.5 },
      },
    };
    const listed = fixtureWith(`modules/${MODULE}/python/locus.json`, () => JSON.stringify(tool));
    const withSource = fixtureWith(`modules/${MODULE}/python/locus.py`, () => "plot = []\n", listed);
    expect((await run(toolsGate, withSource)).findings).toEqual([
      {
        outcome: "block",
        at: `modules/${MODULE}/python/locus.json`,
        message:
          "python-control is a build-time oracle only: it checks the control sims at build and never loads in the page, but this Pyodide tool lists control",
      },
    ]);
  });

  it("lists the gains a pole drag can set as the slider snaps them, ending on its max", () => {
    expect(gainsOf({ min: 0.5, max: 1.8, step: 0.5 })).toEqual([0.5, 1, 1.5, 1.8]);
    expect(gainsOf({ min: 0.5, max: 2, step: 0.5 })).toEqual([0.5, 1, 1.5, 2]);
  });

  it("breaks a plotted curve where it leaves its frame, never joining across the plane", () => {
    const inside = ([x]: readonly [number, number]) => Math.abs(x) < 10;
    const kept = within(
      [
        [1, 0],
        [20, 0],
        [30, 0],
        [-2, 0],
        [-40, 0],
      ],
      inside,
    );
    expect(kept.map(([x]) => x)).toEqual([1, NaN, -2]);
  });

  it("reads every module an import names, aliased or after a comma", () => {
    for (const source of [
      "import control",
      "import numpy as np, control as ct",
      "import control.matlab as m",
      "from control.matlab import step",
    ])
      expect(importsOracle(source), source).toBe(true);
    for (const source of ["import controller", "import numpy as np  # control later", "x = control"])
      expect(importsOracle(source), source).toBe(false);
  });

  it("catches the planted Pyodide tool that imports python-control", async () => {
    const result = await runControls({ input: { contentDir: FIXTURE_COURSE }, gates: [toolsGate] });
    const control = result.gates[0]?.controls.find((c) => c.defect.includes("python-control"));
    expect(control?.caught, control?.error).toBe(true);
  });
});

describe("the content contract for a control sim", () => {
  const base = {
    kind: "control",
    title: "A loop",
    caption: "Planted",
    recompute: "independent",
    model: {
      plant: { gain: 1, zeros: [], poles: [0, -2] },
      loop: { input: "R", sum: "E", gain: "K", plant: "G", output: "Y" },
      parts: [
        { id: "R", kind: "port", label: "R(s)" },
        { id: "E", kind: "sum" },
        { id: "K", kind: "block", label: "K" },
        { id: "G", kind: "block", label: "G(s)" },
        { id: "Y", kind: "port", label: "Y(s)" },
      ],
      nets: [
        { id: "r", pins: ["R.t", "E.in1"] },
        { id: "e", pins: ["E.out", "K.in"] },
        { id: "u", pins: ["K.out", "G.in"] },
        { id: "y", pins: ["G.out", "Y.t", "E.in2"] },
      ],
    },
    layout: {
      parts: { R: { at: [0, 0] }, E: { at: [1, 0] }, K: { at: [2, 0] }, G: { at: [3, 0] }, Y: { at: [4, 0] } },
    },
    start: { K: 4 },
    tune: { K: { min: 0.5, max: 10, step: 0.5 } },
  };

  it("keeps the unity-feedback loop", () => {
    expect(sim.safeParse(base).success).toBe(true);
  });

  it("refuses an improper plant and a loop whose roles name the wrong parts", () => {
    const improper = { ...base, model: { ...base.model, plant: { gain: 1, zeros: [-1, -3], poles: [0, -2] } } };
    expect(sim.safeParse(improper).error?.issues.map((i) => i.message)).toEqual([
      "G(s) is strictly proper: it has fewer zeros than poles",
    ]);
    const swapped = { ...base, model: { ...base.model, loop: { ...base.model.loop, sum: "K", gain: "E" } } };
    expect(sim.safeParse(swapped).error?.issues.map((i) => i.message)).toEqual([
      "the loop's sum is K, a block: the sum is a sum",
      "the loop's gain is E, a sum: the gain is a block",
    ]);
  });
});
