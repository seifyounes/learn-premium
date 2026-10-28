// The pneumatic-cycle and timing-key gates on the Fixture Course's cascade (Module 12): the circuit
// runs exactly the stated sequence once S is pressed and stops back at rest, every state at every
// step agrees with the independent recompute's trace, and each broken engine its cycle reaches is
// caught; the displacement-step diagram agrees with the key three ways, each key row whole. The
// Drawing gate takes the Blind reader's reading of the synthetic figure.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { drawingGate } from "../gates/drawing.ts";
import { pneumaticCycleGate } from "../gates/pneumatic.ts";
import { runControls as runGateControls, type Gate } from "../gates/runner.ts";
import { timingKeyGate, toolsGate } from "../gates/sims.ts";
import { sim } from "../src/content/contract.ts";
import { checkDrawing, figureReading } from "../src/sims/layout/check.ts";
import { textBox, type Drawing } from "../src/sims/layout/drawing.ts";
import { layOut } from "../src/sims/layout/layout.ts";
import { boxOf, symbolOf, toDrawing, type Point } from "../src/sims/layout/symbols.ts";
import { PHYSICS, runCycle } from "../src/sims/pneumatic/engine.ts";
import { MUTANTS, runControls } from "../src/sims/pneumatic/mutants.ts";
import { FIXTURE_COURSE } from "./build-course";

const MODULE = "12-cascade";
const SIM = `modules/${MODULE}/sims/cascade.json`;
const input = { contentDir: FIXTURE_COURSE, module: MODULE };

/** A gate's negative control by a word of its defect, planted in a scratch copy of the Course. */
const planted = (gate: Gate, word: RegExp) => {
  const control = gate.controls.find((c) => word.test(c.defect));
  if (!control) throw new Error(`no control matching ${word}`);
  return control.plant(input, mkdtempSync(join(tmpdir(), "lp-pneumatic-")));
};

/** The Fixture's cascade as the content contract reads it. */
const cascade = () => {
  const parsed = sim.parse(JSON.parse(readFileSync(join(FIXTURE_COURSE, SIM), "utf8")));
  if (parsed.kind !== "pneumatic" || parsed.start === undefined)
    throw new Error("the Fixture's cascade isn't a live pneumatic sim");
  return { ...parsed, start: parsed.start };
};

describe("the pneumatic-cycle gate", () => {
  it("passes the Fixture cascade: its sequence, its rest, every state of every step, four broken engines caught", async () => {
    const result = await pneumaticCycleGate.run(input);
    expect(result.findings).toEqual([]);
    expect(result.coverage).toEqual({
      modules: 1,
      sims: 1,
      stepThroughs: 0,
      steps: 6,
      values: 144,
      movements: 4,
      controlsCaught: 4,
      controlsNotReached: 1,
    });
  });

  it("covers a Module with no pneumatic sim without checking anything in it", async () => {
    const result = await pneumaticCycleGate.run({ contentDir: FIXTURE_COURSE, module: "03-gradient-descent" });
    expect(result.findings).toEqual([]);
    expect(result.coverage).toEqual({
      modules: 1,
      sims: 0,
      stepThroughs: 0,
      steps: 0,
      values: 0,
      movements: 0,
      controlsCaught: 0,
      controlsNotReached: 0,
    });
  });

  it("blocks the bypassed cascade: it stalls at step 3 on VB's signal overlap", async () => {
    const result = await pneumaticCycleGate.run(planted(pneumaticCycleGate, /bypassed/));
    expect(result.findings).toEqual([
      {
        outcome: "block",
        at: SIM,
        message:
          "the cycle stalls at step 3 after A+ B+: VB has both pilots pressurised (a signal overlap), so it can't shift",
      },
    ]);
  });

  it("names a stated sequence the circuit doesn't run", async () => {
    const result = await pneumaticCycleGate.run(planted(pneumaticCycleGate, /stated sequence/));
    expect(result.findings.map((f) => f.message)).toEqual([
      "the circuit runs A+ B+ B- A-, but the Materials state A+ B+ A- B-",
    ]);
  });

  it("names a valve drawn on the wrong side at rest", async () => {
    const result = await pneumaticCycleGate.run(planted(pneumaticCycleGate, /drawn on its 14 side/));
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.message).toMatch(/^the circuit doesn't stay as drawn at rest: /);
    expect(result.findings[0]?.message).toMatch(/draw each valve on the side its pilots hold it at rest$/);
  });

  it("names the step a recompute trace is wrong at, field by field", async () => {
    const result = await pneumaticCycleGate.run(planted(pneumaticCycleGate, /spool off at one step/));
    expect(result.findings.map((f) => f.message)).toEqual([
      "the engine disagrees with the independent recompute: at step 3, VB's spool is 12 in the engine and 14 in the recompute",
    ]);
  });

  it("names a recompute trace a step short", async () => {
    const result = await pneumaticCycleGate.run(planted(pneumaticCycleGate, /a step short/));
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.message).toContain("the engine's cycle has 5 steps, the recompute's 4");
  });

  it("blocks a live pneumatic sim with no recompute log", async () => {
    const result = await pneumaticCycleGate.run(planted(pneumaticCycleGate, /no recompute log/));
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.message).toMatch(
      /^no recompute log at build-records\/recompute\/12-cascade\/cascade\.json: /,
    );
  });

  it("reports a broken engine whose cycle the recompute's trace repeats as missed (the control's own negative control)", () => {
    const { model, start } = cascade();
    // The normally-open 3/2 valve stalls the cascade at step 1: a cycle that runs, so it has a trace to repeat.
    // (The roller read early never settles at all: a broken engine that throws is caught outright.)
    const mutant = MUTANTS.find((m) => /passes air while released/.test(m.defect));
    if (!mutant) throw new Error("no such mutant");
    const own = runCycle(model, start, mutant.physics);
    expect(own.end).toBe("stall");
    // A trace the broken engine's own cycle writes: the recompute would be wrong the same way.
    const outcomes = runControls(model, start, { rest: own.rest, steps: own.steps });
    expect(outcomes.find((o) => o.defect === mutant.defect)?.outcome).toBe("missed");
    // The true cycle's trace catches it, and the other three the cascade's cycle reaches.
    const truth = runCycle(model, start, PHYSICS);
    const caught = runControls(model, start, { rest: truth.rest, steps: truth.steps });
    expect(caught.map((o) => o.outcome)).toEqual(["caught", "caught", "caught", "caught", "not-reached"]);
  });
});

describe("the timing-key gate", () => {
  it("passes the Fixture key: 18 cells three ways, 4 rows whole", async () => {
    const result = await timingKeyGate.run(input);
    expect(result.findings).toEqual([]);
    expect(result.coverage).toEqual({
      modules: 1,
      sims: 1,
      sheetValues: 18,
      recomputedValues: 18,
      stepThroughs: 0,
      rows: 4,
    });
  });

  it("raises a key cell the engine and the recompute agree against as a Checkpoint item", async () => {
    const result = await timingKeyGate.run(planted(timingKeyGate, /agree against/));
    expect(result.findings).toEqual([
      expect.objectContaining({ outcome: "checkpoint", at: `modules/${MODULE}/worked/1.json` }),
    ]);
  });

  it("blocks a key that maps only some steps of a row", async () => {
    const result = await timingKeyGate.run(planted(timingKeyGate, /only some steps/));
    expect(result.findings.map((f) => f.message)).toEqual([
      "the key maps A at steps 1, 2, 3, 4 only, but the timing diagram draws it at steps 1–5: a key row is checked whole",
    ]);
  });

  it("blocks a recompute log that leaves out a step of the diagram", async () => {
    const result = await timingKeyGate.run(planted(timingKeyGate, /leaves out a step/));
    expect(result.findings.map((f) => f.message)).toEqual([
      "sheet cell F2 maps B[5], which the recompute log doesn't give",
      "the recompute log doesn't give B[5]: a timing diagram's recompute works out every step of it",
    ]);
  });
});

describe("the gates' negative controls", () => {
  it("catches every planted defect, in both gates", async () => {
    const result = await runGateControls({ input, gates: [pneumaticCycleGate, timingKeyGate] });
    expect(result.gates.flatMap((g) => g.controls.filter((c) => !c.caught))).toEqual([]);
    expect(result.gates.map((g) => g.controls.length)).toEqual([6, 5]);
    expect(result.ok).toBe(true);
  });
});

type Box = [number, number, number, number];
const hit = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/** Every text on a drawing as a box: each symbol's own words at 12px, each label and mark at 13px. */
function textsOf(d: Drawing): { what: string; box: Box }[] {
  return d.parts.flatMap((part) => [
    ...(symbolOf(part.kind).text ?? []).map(([x, y, text, anchor]) => {
      const w = 7.5 * text.length;
      const left = anchor === "start" ? x : anchor === "middle" ? x - w / 2 : x - w;
      const [x0, y0] = toDrawing(part, [left, y - 10]);
      const [x1, y1] = toDrawing(part, [left + w, y + 3]);
      return { what: `${part.id}'s "${text}"`, box: [x0, y0, x1, y1] as Box };
    }),
    ...[...(part.label ? [part.label] : []), ...(part.notes ?? [])].map((t) => ({
      what: `${part.id}'s "${t.text}"`,
      box: textBox(t) as Box,
    })),
  ]);
}

/** Whether a wire segment passes through a box's inside. */
function crosses([a, b]: [Point, Point], [x0, y0, x1, y1]: Box) {
  const [sx0, sx1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
  const [sy0, sy1] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
  return sx0 === sx1 ? sx0 > x0 && sx0 < x1 && sy0 < y1 && sy1 > y0 : sy0 > y0 && sy0 < y1 && sx0 < x1 && sx1 > x0;
}

describe("the Drawing gate on the cascade", () => {
  it("passes it, its mutants caught", async () => {
    const result = await drawingGate.run(input);
    expect(result.findings).toEqual([]);
    expect(result.coverage).toMatchObject({ modules: 1, drawings: 1, checks: 12 });
    expect((result.coverage.mutantsCaught ?? 0) + (result.coverage.mutantsSkipped ?? 0)).toBe(8);
  });

  it("draws the cascade with no symbol text, label or mark across another, a body or a wire", () => {
    const { model, layout } = cascade();
    const drawing = layOut(model, layout);
    const reading = figureReading.parse(
      JSON.parse(readFileSync(join(FIXTURE_COURSE, `build-records/figure/${MODULE}/cascade.json`), "utf8")),
    );
    expect(checkDrawing(drawing, model, reading).checks.filter((c) => c.problems.length > 0)).toEqual([]);
    const texts = textsOf(drawing);
    expect(texts.length).toBeGreaterThan(30);
    const problems: string[] = [];
    texts.forEach((a, i) => {
      texts.slice(i + 1).forEach((b) => {
        if (hit(a.box, b.box)) problems.push(`${a.what} overlaps ${b.what}`);
      });
      for (const part of drawing.parts) {
        // A symbol's own words sit inside its box; every other text keeps clear of every body.
        if (a.what.startsWith(`${part.id}'s`)) continue;
        if (hit(a.box, boxOf(part) as Box)) problems.push(`${a.what} sits on ${part.id}`);
      }
      drawing.wires.forEach((w, n) =>
        w.points.slice(1).forEach((p, k) => {
          const q = w.points[k] as Point;
          if (crosses([q, p], a.box)) problems.push(`wire ${n} crosses ${a.what}`);
        }),
      );
    });
    expect(problems).toEqual([]);
  });

  it("opens the tools gate's checks: one kind, the engine run at S's min, mid and max", async () => {
    const result = await toolsGate.run(input);
    expect(result.findings).toEqual([]);
    expect(result.coverage).toMatchObject({ sims: 1, kinds: 1, engineSamples: 4 });
  });
});
