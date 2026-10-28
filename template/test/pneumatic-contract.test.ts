// The pneumatic sim's side of the content contract: a netlist of the pneumatic pack, the sequence
// the Materials state, the buttons the example presses, Layout hints (never a coordinate) and the
// buttons it opens on. Each way a Professor's figure can be written wrong is read by name.
import { describe, expect, it } from "vitest";
import { sim } from "../src/content/contract.ts";
import { engineQuantities, KINDS, schematicModelOf, type LiveSim } from "../src/sims/kinds.ts";
import { runCycle, stepDiagram } from "../src/sims/pneumatic/engine.ts";
import { compareTrace, pneumaticLog } from "../src/sims/pneumatic/log.ts";
import { threeWay } from "../src/sims/three-way.ts";

type Raw = ReturnType<typeof cascade>;
const cascade = () => ({
  kind: "pneumatic",
  title: "The two-group cascade, running",
  caption: "Press S and the cascade runs A+ B+ B- A-.",
  recompute: "independent",
  worked: "1",
  sheet: {
    B1: "A[1]",
    C1: "A[2]",
    D1: "A[3]",
    E1: "A[4]",
    F1: "A[5]",
    B2: "B[1]",
    C2: "B[2]",
    D2: "B[3]",
    E2: "B[4]",
    F2: "B[5]",
    B3: "I[1]",
    C3: "I[2]",
    D3: "I[3]",
    E3: "I[4]",
    B4: "II[1]",
    C4: "II[2]",
    D4: "II[3]",
    E4: "II[4]",
  } as Record<string, string>,
  model: {
    parts: [
      { id: "A", kind: "cylinder", label: "A", notes: { retracted: "a0", extended: "a1" }, rest: "retracted" },
      { id: "B", kind: "cylinder", label: "B", notes: { retracted: "b0", extended: "b1" }, rest: "retracted" },
      { id: "VA", kind: "valve-52", label: "VA", rest: "12" },
      { id: "VB", kind: "valve-52", label: "VB", rest: "12" },
      { id: "CV", kind: "valve-52", label: "CV", rest: "12" },
      { id: "a0", kind: "valve-32-roller", label: "a0" },
      { id: "a1", kind: "valve-32-roller", label: "a1" },
      { id: "b0", kind: "valve-32-roller", label: "b0" },
      { id: "b1", kind: "valve-32-roller", label: "b1" },
      { id: "S", kind: "valve-32-button", label: "S" },
      { id: "P1", kind: "air-source" },
      { id: "P2", kind: "air-source" },
      { id: "P3", kind: "air-source" },
    ] as Record<string, unknown>[],
    nets: [
      { id: "P", pins: ["P1.t", "P2.t", "P3.t", "VA.1", "VB.1", "CV.1"] },
      { id: "Acap", pins: ["VA.4", "A.cap"] },
      { id: "Arod", pins: ["VA.2", "A.rod"] },
      { id: "Bcap", pins: ["VB.4", "B.cap"] },
      { id: "Brod", pins: ["VB.2", "B.rod"] },
      { id: "I", pins: ["CV.4", "VA.14", "a1.1", "b1.1"] },
      { id: "II", pins: ["CV.2", "VB.12", "b0.1", "a0.1"] },
      { id: "a1out", pins: ["a1.2", "VB.14"] },
      { id: "b1out", pins: ["b1.2", "CV.12"] },
      { id: "b0out", pins: ["b0.2", "VA.12"] },
      { id: "a0out", pins: ["a0.2", "S.1"] },
      { id: "Sout", pins: ["S.2", "CV.14"] },
    ] as { id: string; pins: string[] }[],
    sequence: ["A+", "B+", "B-", "A-"],
    press: ["S"],
    signals: ["I", "II"],
  },
  layout: {
    parts: {
      A: { at: [1.4, 0], label: "left" },
      B: { at: [5.4, 0], label: "left" },
      VA: { at: [1.4, 1.6], label: "above" },
      VB: { at: [5.4, 1.6], label: "above" },
      P1: { at: [1.4, 2.2] },
      P2: { at: [5.4, 2.2] },
      S: { at: [-1, 2.2], label: "left" },
      a0: { at: [-1, 3.2], label: "left" },
      b0: { at: [2.6, 3.2], label: "left" },
      a1: { at: [4.6, 3.2], label: "left" },
      b1: { at: [6.8, 3.2], label: "left" },
      CV: { at: [1.4, 5.6], label: "above" },
      P3: { at: [1.4, 6.2] },
    } as Record<string, Record<string, unknown>>,
    dots: ["I", "II"],
  },
  start: { S: 0 } as Record<string, number>,
  tune: { S: { min: 0, max: 1, step: 1 } } as Record<string, unknown>,
  provenance: { stated: ["cylinders $A$ and $B$ with roller valves a0, a1, b0, b1"] },
});

const issues = (raw: unknown) => sim.safeParse(raw).error?.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
const part = (raw: Raw, id: string) => raw.model.parts.find((p) => p.id === id) ?? {};
const net = (raw: Raw, id: string) => raw.model.nets.find((n) => n.id === id) ?? { id, pins: [] };

describe("the pneumatic sim contract", () => {
  it("keeps the contract for the Fixture cascade", () => {
    expect(issues(cascade())).toBeUndefined();
  });

  it("parses the model as written: no defaulted key for a recompute to miss", () => {
    const raw = cascade();
    const parsed = sim.parse(raw);
    expect(parsed.kind).toBe("pneumatic");
    expect(parsed.model).toEqual(raw.model);
  });

  it("is drawn as a schematic by the layout core, its model as written", () => {
    const parsed = sim.parse(cascade());
    expect(parsed.kind === "pneumatic" && schematicModelOf(parsed).parts).toHaveLength(13);
  });

  it("has no field for a drawing coordinate", () => {
    const placed = cascade();
    (placed.layout.parts.A as Record<string, unknown>).x = 240;
    expect(issues(placed)).toEqual(['layout.parts.A: Unrecognized key: "x"']);
  });

  it("states each cylinder's rest end", () => {
    const raw = cascade();
    delete part(raw, "A").rest;
    expect(issues(raw)).toEqual(["model: cylinder A states no rest end: the figure draws it retracted or extended"]);
  });

  it("states each 5/2 valve's rest side", () => {
    const raw = cascade();
    delete part(raw, "VA").rest;
    expect(issues(raw)).toEqual(["model: 5/2 valve VA states no rest side: the figure draws it on its 12 or 14 side"]);
  });

  it("gives a rest only to a cylinder (retracted, extended) or a 5/2 valve (12, 14), and the right kind of one", () => {
    const button = cascade();
    part(button, "S").rest = "12";
    expect(issues(button)).toEqual([
      "model: S is a valve-32-button: only a cylinder (retracted, extended) or a 5/2 valve (12, 14) has a rest",
    ]);
    const cylinder = cascade();
    part(cylinder, "A").rest = "14";
    expect(issues(cylinder)).toEqual([
      "model: A is a cylinder: only a cylinder (retracted, extended) or a 5/2 valve (12, 14) has a rest",
    ]);
  });

  it("lets only a cylinder print stroke-end marks, and only at its two ends", () => {
    const valve = cascade();
    part(valve, "VA").notes = { retracted: "a0" };
    expect(issues(valve)).toEqual(["model: VA prints marks, but only a cylinder prints stroke-end marks"]);
    const odd = cascade();
    part(odd, "A").notes = { retracted: "a0", extended: "a1", middle: "b0" };
    expect(issues(odd)).toEqual([
      "model: cylinder A marks middle, which is no stroke end: its marks are retracted and extended",
    ]);
  });

  it("ties every roller valve to one cylinder's stroke end by its label", () => {
    const unmarked = cascade();
    part(unmarked, "A").notes = { retracted: "a0" };
    expect(issues(unmarked)).toEqual([
      "model: roller valve a1 is marked at no cylinder's stroke end: the figure shows where each roller sits",
    ]);
    const unlabelled = cascade();
    delete part(unlabelled, "a1").label;
    expect(issues(unlabelled)).toEqual([
      "model: roller valve a1 has no label: its label is how the figure ties it to a stroke end",
      "model: cylinder A's mark a1 names no roller valve",
    ]);
    const twice = cascade();
    part(twice, "B").notes = { retracted: "b0", extended: "a1" };
    expect(issues(twice)).toEqual([
      "model: roller valve b1 is marked at no cylinder's stroke end: the figure shows where each roller sits",
      "model: roller valve a1 is marked at two stroke ends",
    ]);
  });

  it("marks a stroke end only with a roller valve that is in the circuit", () => {
    const raw = cascade();
    part(raw, "A").notes = { retracted: "a0", extended: "zz" };
    expect(issues(raw)).toEqual([
      "model: roller valve a1 is marked at no cylinder's stroke end: the figure shows where each roller sits",
      "model: cylinder A's mark zz names no roller valve",
    ]);
  });

  it("runs a sequence of the circuit's cylinders, each going out and coming back", () => {
    const stranger = cascade();
    stranger.model.sequence = ["A+", "B+", "B-", "C+"];
    expect(issues(stranger)).toEqual([
      "model: the sequence's C+ names no cylinder",
      "model: cylinder A never retracts in the sequence: a cycle brings every cylinder back",
    ]);
    const short = cascade();
    short.model.sequence = ["A+", "B+", "A-"];
    expect(issues(short)).toEqual([
      "model: cylinder B never retracts in the sequence: a cycle brings every cylinder back",
    ]);
    const stuck = cascade();
    stuck.model.sequence = ["A+", "A-", "B-"];
    expect(issues(stuck)).toEqual([
      "model: cylinder B never extends in the sequence: a cycle brings every cylinder back",
    ]);
  });

  it("presses only push-button valves", () => {
    const raw = cascade();
    raw.model.press = ["VA"];
    expect(issues(raw)).toEqual(["model: press names VA, which isn't a push-button valve"]);
  });

  it("draws a signal row only for a net the model has, named apart from the cylinders", () => {
    const missing = cascade();
    missing.model.signals = ["X"];
    expect(issues(missing)).toEqual(["model: signals names net X, which the model doesn't have"]);
    const clash = cascade();
    net(clash, "I").id = "A";
    clash.model.signals = ["A", "II"];
    clash.layout.dots = ["A", "II"];
    expect(issues(clash)).toEqual([
      "model: signal A shares its name with a cylinder: the timing diagram names its rows by them",
    ]);
  });

  it("needs an air source", () => {
    const raw = cascade();
    raw.model.parts = raw.model.parts.filter((p) => !String(p.id).startsWith("P"));
    net(raw, "P").pins = ["VA.1", "VB.1", "CV.1"];
    raw.layout.parts = Object.fromEntries(Object.entries(raw.layout.parts).filter(([id]) => !id.startsWith("P")));
    expect(issues(raw)).toEqual(["model: the circuit has no air source"]);
  });

  it("opens on exactly the push buttons the circuit has, in order", () => {
    const raw = cascade();
    raw.start = { S: 0, T: 0 };
    expect(issues(raw)).toEqual(["start: start gives S, T, but the push buttons are S, in that order"]);
    const tuned = cascade();
    tuned.tune = {};
    expect(issues(tuned)).toEqual(["tune: tune gives nothing, but the push buttons are S, in that order"]);
  });

  it("gives every part one layout hint", () => {
    const raw = cascade();
    delete raw.layout.parts.CV;
    expect(issues(raw)).toEqual(["model: part CV has no layout hint"]);
  });

  it("takes a model that isn't a pneumatic one's kinds as a schema error, not a crash", () => {
    const raw = cascade();
    part(raw, "A").kind = "resistor";
    expect(issues(raw)?.[0]).toContain("model.parts.0.kind");
  });
});

describe("a pneumatic sim's engine and recompute log", () => {
  const live = () => sim.parse(cascade()) as LiveSim;

  it("is checked by timing-key", () => {
    expect(KINDS.pneumatic.checkedBy).toBe("timing-key");
  });

  it("engineQuantities runs the cascade: the 18 bits of its displacement-step diagram", () => {
    const bits = engineQuantities(live());
    expect(Object.keys(bits)).toHaveLength(18);
    expect(bits["A[3]"]).toBe(1);
    expect(bits["B[3]"]).toBe(1);
    expect(bits["I[3]"]).toBe(0);
    expect(bits["II[3]"]).toBe(1);
  });

  const good = () => {
    const s = live();
    const cycle = runCycle(s.model as never, s.start);
    return {
      recompute: "learn-premium recompute log v1",
      by: "test",
      inputs: { model: s.model, start: s.start },
      values: stepDiagram(s.model as never, cycle),
      trace: { rest: cycle.rest, steps: cycle.steps },
    };
  };

  it("pneumaticLog takes a trace, and refuses an unknown key and a step-short trace", () => {
    expect(pneumaticLog.safeParse(good()).success).toBe(true);
    expect(pneumaticLog.safeParse({ ...good(), extra: 1 }).success).toBe(false);
    const short = good();
    short.trace.steps = short.trace.steps.slice(0, 1);
    expect(pneumaticLog.safeParse(short).success).toBe(false);
    const bare: Record<string, unknown> = good();
    bare.trace = undefined;
    expect(pneumaticLog.safeParse(bare).success).toBe(false);
  });

  it("compares the engine's cycle with the trace, state by state", () => {
    const s = live();
    const cycle = runCycle(s.model as never, s.start);
    const log = pneumaticLog.parse(good());
    expect(compareTrace(cycle, log.trace)).toEqual({ mismatches: [], states: 6, values: 144 });
    const off = pneumaticLog.parse(good());
    (off.trace.steps[2] as { spools: Record<string, string> }).spools.VB = "14";
    expect(compareTrace(cycle, off.trace).mismatches).toEqual([
      "at step 3, VB's spool is 12 in the engine and 14 in the recompute",
    ]);
    const made = pneumaticLog.parse(good());
    (made.trace.steps[1] as { made: Record<string, number> }).made.a1 = 0;
    expect(compareTrace(cycle, made.trace).mismatches).toEqual([
      "at step 2, a1 is made in the engine and freed in the recompute",
    ]);
    const motion = pneumaticLog.parse(good());
    (motion.trace.steps[2] as { motion: Record<string, number> }).motion.B = 0;
    expect(compareTrace(cycle, motion.trace).mismatches).toEqual([
      "at step 3, B's motion is −1 in the engine and 0 in the recompute",
    ]);
    const line = pneumaticLog.parse(good());
    (line.trace.rest.lines as Record<string, number>).II = 0;
    expect(compareTrace(cycle, line.trace).mismatches).toEqual([
      "at rest, line II is 1 in the engine and 0 in the recompute",
    ]);
    const short = pneumaticLog.parse(good());
    short.trace.steps = short.trace.steps.slice(0, 4);
    const result = compareTrace(cycle, short.trace);
    expect(result.mismatches).toEqual(["the engine's cycle has 5 steps, the recompute's 4"]);
    expect(result.states).toBe(5);
  });

  it("three-way checks the diagram exactly: the log's every bit, and none the engine lacks", () => {
    // No sheet here: this is the engine against the recompute (the gate's tests add the key).
    const s = { ...live(), sheet: {} } as LiveSim;
    const log = pneumaticLog.parse(good());
    const every = "a timing diagram's recompute works out every step of it";
    const clean = threeWay(s, log, undefined, { exact: true, every });
    expect(clean.problems).toEqual([]);
    expect(clean.recomputedValues).toBe(18);
    const rest = Object.fromEntries(Object.entries(log.values).filter(([quantity]) => quantity !== "II[4]"));
    const missing = threeWay(s, { ...log, values: rest }, undefined, { exact: true, every });
    expect(missing.problems.map((p) => p.message)).toEqual([
      "the recompute log doesn't give II[4]: a timing diagram's recompute works out every step of it",
    ]);
    // The default reason is still a truth table's.
    const table = threeWay(s, { ...log, values: rest }, undefined, { exact: true });
    expect(table.problems[0]?.message).toContain("a truth table's recompute works out every row");
  });
});
