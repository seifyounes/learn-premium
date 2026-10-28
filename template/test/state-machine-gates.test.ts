// The state-diagram, state-table and timing-key gates on the Fixture Course's state machines (Module 14):
// the '101' detector's Moore diagram and the drill's GRAFCET are drawn as the Blind reader read the
// figure, their whole tables agree with the independent recompute's, four broken engines are caught
// where the example reaches them, and the timing strips agree with the key three ways, each key row
// whole.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runControls as runGateControls, type Gate } from "../gates/runner.ts";
import { stateDiagramGate } from "../gates/state-diagram.ts";
import { stateTableGate } from "../gates/state-table.ts";
import { timingKeyGate, toolsGate } from "../gates/sims.ts";
import { toolInventory } from "../gates/inventory.ts";
import { FIXTURE_COURSE } from "./build-course";

const MODULE = "14-state-machines";
const input = { contentDir: FIXTURE_COURSE, module: MODULE };
const DETECTOR = `modules/${MODULE}/sims/detector.json`;

/** A gate's negative control by a word of its defect, planted in a scratch copy of the Course. */
const planted = (gate: Gate, word: RegExp) => {
  const control = gate.controls.find((c) => word.test(c.defect));
  if (!control) throw new Error(`no control matching ${word}`);
  return control.plant(input, mkdtempSync(join(tmpdir(), "lp-machines-")));
};

describe("the state-diagram gate", () => {
  it("passes Module 14: two drawings, 22 checks, 17 mutants caught and 1 skipped", async () => {
    const result = await stateDiagramGate.run(input);
    expect(result.findings).toEqual([]);
    expect(result.coverage).toEqual({ modules: 1, drawings: 2, checks: 22, mutantsCaught: 17, mutantsSkipped: 1 });
  });

  it("covers a Module with no state diagram without checking anything in it", async () => {
    const result = await stateDiagramGate.run({ contentDir: FIXTURE_COURSE, module: "04-full-adder" });
    expect(result.findings).toEqual([]);
    expect(result.coverage).toEqual({ modules: 1, drawings: 0, checks: 0, mutantsCaught: 0, mutantsSkipped: 0 });
  });

  it("names a moved self-loop: it is drawn on the other side of the state", async () => {
    const result = await stateDiagramGate.run(planted(stateDiagramGate, /move a self-loop/));
    // The drawing is already wrong, so the moved-loop mutant moves S0's loop back onto the figure's
    // side and the gate says so too: the first finding is the one that names the defect.
    expect(result.findings.map((f) => f.message)[0]).toBe(
      "drawing ↔ figure, bends: S0's self-loop is drawn above it, the figure draws it below",
    );
  });

  it("names a redirected edge: the model's edge is not the figure's", async () => {
    const result = await stateDiagramGate.run(planted(stateDiagramGate, /redirected/));
    expect(result.findings.map((f) => f.message)).toContain(
      'model ↔ figure, transitions: S0 → S2 ("1") is in the model but not in the figure',
    );
  });

  it("names swapped labels", async () => {
    const result = await stateDiagramGate.run(planted(stateDiagramGate, /labels swapped/));
    expect(result.findings.map((f) => f.message)).toContain(
      'model ↔ figure, transitions: S0 → S0 is labelled "1" in the model, "0" in the figure',
    );
  });

  it("names a state the figure draws and the model drops", async () => {
    const result = await stateDiagramGate.run(planted(stateDiagramGate, /drops a state/));
    expect(result.findings.map((f) => f.message)).toContain(
      "model ↔ figure, transitions: the figure's S9 has no state in the model",
    );
  });

  it("names a mirrored arrangement", async () => {
    const result = await stateDiagramGate.run(planted(stateDiagramGate, /mirror/));
    expect(result.findings.map((f) => f.message)).toContain("drawing ↔ figure, arrangement: S0 should be left of S3");
  });

  it("blocks a state diagram with no figure reading", async () => {
    const result = await stateDiagramGate.run(planted(stateDiagramGate, /no figure reading/));
    expect(result.findings.map((f) => f.message)).toEqual([
      `no figure reading at build-records/figure/${MODULE}/detector.json: a Blind reader reads the Professor's figure for every state diagram, so the model can be checked against it`,
    ]);
  });
});

describe("the state-table gate", () => {
  it("passes the detector and the drill: 7 situations, 32 rows, 8 broken engines caught", async () => {
    const result = await stateTableGate.run(input);
    expect(result.findings).toEqual([]);
    expect(result.coverage).toEqual({
      modules: 1,
      sims: 2,
      stepThroughs: 0,
      situations: 7,
      rows: 32,
      controlsCaught: 8,
      controlsNotReached: 0,
    });
  });

  it("covers a Module with no state machine without checking anything in it", async () => {
    const result = await stateTableGate.run({ contentDir: FIXTURE_COURSE, module: "04-full-adder" });
    expect(result.findings).toEqual([]);
    expect(result.coverage).toEqual({
      modules: 1,
      sims: 0,
      stepThroughs: 0,
      situations: 0,
      rows: 0,
      controlsCaught: 0,
      controlsNotReached: 0,
    });
  });

  it("names the situation a recompute table sends elsewhere", async () => {
    const result = await stateTableGate.run(planted(stateTableGate, /sends one situation elsewhere/));
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.message).toMatch(
      /^the engine disagrees with the independent recompute: with S0 active and x = 0, the engine goes to S0 and the recompute to S1/,
    );
  });

  it("names a reachable row the recompute leaves out", async () => {
    const result = await stateTableGate.run(planted(stateTableGate, /missing a reachable row/));
    expect(result.findings.map((f) => f.message)).toEqual([
      "the engine disagrees with the independent recompute: the recompute's table has no row for S3 active and x = 1",
    ]);
  });

  it("names a redirected edge: the engine goes where the figure's table does not", async () => {
    const result = await stateTableGate.run(planted(stateTableGate, /re-aimed in the model/));
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.message).toMatch(
      /^the engine disagrees with the independent recompute: with S0 active and x = 1, the engine goes to S2 and the recompute to S1/,
    );
  });

  it("names a recompute worked from another input sequence", async () => {
    const result = await stateTableGate.run(planted(stateTableGate, /another input sequence/));
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.message).toMatch(/^the recompute log was worked from other inputs \(/);
    expect(result.findings[0]?.message).toContain("the sim opens on the example's values");
  });

  it("blocks a live state machine with no recompute log", async () => {
    const result = await stateTableGate.run(planted(stateTableGate, /no recompute log/));
    expect(result.findings.map((f) => f.message)).toEqual([
      `no recompute log at build-records/recompute/${MODULE}/detector.json: a state machine ships live only when an independent recompute works its table; if it can't be recomputed, mark it recompute: none`,
    ]);
  });
});

describe("the timing-key gate on Module 14", () => {
  it("passes: 108 cells three ways, 12 rows whole", async () => {
    const result = await timingKeyGate.run(input);
    expect(result.findings).toEqual([]);
    expect(result.coverage).toEqual({
      modules: 1,
      sims: 2,
      sheetValues: 108,
      recomputedValues: 108,
      stepThroughs: 0,
      rows: 12,
    });
  });

  it("plants in the detector when scoped to Module 14: a key that maps only some steps of a row", async () => {
    const result = await timingKeyGate.run(planted(timingKeyGate, /only some steps/));
    expect(result.findings.map((f) => f.message)).toEqual([
      "the key maps x at steps 1, 2, 3, 4, 5, 6, 7, 8 only, but the timing diagram draws it at steps 1–9: a key row is checked whole",
    ]);
  });
});

describe("the gates' negative controls", () => {
  it("catches every planted defect, in the three gates", async () => {
    const result = await runGateControls({ input, gates: [stateDiagramGate, stateTableGate, timingKeyGate] });
    expect(result.gates.flatMap((g) => g.controls.filter((c) => !c.caught))).toEqual([]);
    expect(result.gates.map((g) => g.controls.length)).toEqual([6, 5, 5]);
    expect(result.ok).toBe(true);
  });
});

describe("the tools gate and the inventory on Module 14", () => {
  it("passes: two kinds, each engine run at every input's min, mid and max", async () => {
    const result = await toolsGate.run(input);
    expect(result.findings).toEqual([]);
    expect(result.coverage).toMatchObject({ sims: 2, kinds: 2, engineSamples: 14 });
  });

  it("counts a state diagram's states and edges as its parts and nets", () => {
    const { tools, problems } = toolInventory(input);
    expect(problems).toEqual([]);
    expect(tools.map((t) => [t.name, t.kind, t.worked, t.live, t.counts])).toEqual([
      ["detector", "fsm", "1", true, { parts: 4, nets: 8 }],
      ["drill", "grafcet", "2", true, { parts: 3, nets: 3 }],
    ]);
  });

  it("keeps the sims on the files it names", () => {
    expect(readFileSync(join(FIXTURE_COURSE, DETECTOR), "utf8")).toContain('"kind": "fsm"');
  });
});
