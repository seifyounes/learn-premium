// The pneumatic engine on the two-group cascade: the circuit as the Fixture's figure draws it,
// run A+ B+ B− A− step by step. Every state of the five steps is checked against a table worked by
// hand from the figure, and every defect a Professor could draw (a bypassed cascade, a valve on the
// wrong side, a short, a valve that never settles) is read by name.
import { describe, expect, it } from "vitest";
import {
  advance,
  atRest,
  CycleError,
  isStill,
  liveDiagram,
  quantities,
  restState,
  runCycle,
  setHeld,
  ShortError,
  STROKE_MS,
  stepDiagram,
  stepStateOf,
  timingRows,
  toNextStep,
  type PneumaticModel,
  type StepState,
} from "../src/sims/pneumatic/engine.ts";
import { restCaption, stepCaption } from "../src/sims/pneumatic/captions.ts";

/** The Fixture's cascade, as the figure draws it (model order orders events and captions). */
const CASCADE: PneumaticModel = {
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
  ],
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
  ],
  sequence: ["A+", "B+", "B-", "A-"],
  press: ["S"],
  signals: ["I", "II"],
};

const NETS = CASCADE.nets.map((n) => n.id);
const MADE = ["a0", "a1", "b0", "b1", "S"];
/** A step state from the table's columns: cylinders A B, motion A B, spools VA VB CV, lines in net order, made in order. */
function step(
  cyl: [number, number],
  motion: [number, number],
  spools: ["12" | "14", "12" | "14", "12" | "14"],
  lines: string,
  made: string,
): StepState {
  const bits = (s: string) => s.split(" ").map(Number);
  const l = bits(lines);
  const m = bits(made);
  return {
    cylinders: { A: cyl[0] as 0 | 1, B: cyl[1] as 0 | 1 },
    motion: { A: motion[0] as 0 | 1, B: motion[1] as 0 | 1 },
    spools: { VA: spools[0], VB: spools[1], CV: spools[2] },
    lines: Object.fromEntries(NETS.map((id, i) => [id, l[i] as 0 | 1])),
    made: Object.fromEntries(MADE.map((id, i) => [id, m[i] as 0 | 1])),
  };
}
const REST = step([0, 0], [0, 0], ["12", "12", "12"], "1 0 1 0 1 0 1 0 0 1 1 0", "1 0 1 0 0");
const TABLE: StepState[] = [
  step([0, 0], [1, 0], ["14", "12", "14"], "1 1 0 0 1 1 0 0 0 0 0 0", "0 0 1 0 0"),
  step([1, 0], [0, 1], ["14", "14", "14"], "1 1 0 1 0 1 0 1 0 0 0 0", "0 1 0 0 0"),
  step([1, 1], [0, -1], ["14", "12", "12"], "1 1 0 0 1 0 1 0 0 0 0 0", "0 1 0 0 0"),
  step([1, 0], [-1, 0], ["12", "12", "12"], "1 0 1 0 1 0 1 0 0 1 0 0", "0 0 1 0 0"),
  REST,
];

const pressed = () => {
  const rest = restState(CASCADE).state;
  const a = setHeld(CASCADE, rest, "S", 1);
  const b = setHeld(CASCADE, a.state, "S", 0);
  return { state: b.state, events: [...a.events, ...b.events] };
};

/** The cascade with `edit` applied to a copy of its nets. */
const withNets = (
  edit: (nets: { id: string; pins: string[] }[]) => void,
  rest: Partial<Record<string, "12" | "14">> = {},
) => {
  const nets = CASCADE.nets.map((n) => ({ id: n.id, pins: [...n.pins] }));
  edit(nets);
  const parts = CASCADE.parts.map((p) => (p.id in rest ? { ...p, rest: rest[p.id] } : p));
  return { ...CASCADE, parts, nets } satisfies PneumaticModel;
};
const move = (nets: { id: string; pins: string[] }[], pin: string, to: string) => {
  for (const n of nets) n.pins = n.pins.filter((p) => p !== pin);
  nets.find((n) => n.id === to)?.pins.push(pin);
};

describe("the cascade at rest", () => {
  it("stays as drawn at rest: every valve on its rest side, nothing moving, no shift or start", () => {
    const { state, events } = restState(CASCADE);
    expect(stepStateOf(CASCADE, state)).toEqual(REST);
    expect(events.filter((e) => e.kind === "shift" || e.kind === "start")).toEqual([]);
    expect(atRest(CASCADE, state)).toBe(true);
    expect(isStill(state)).toBe(true);
  });
});

describe("pressing S", () => {
  it("runs A+ B+ B− A− and stops back at rest, every state of the five steps as the table says", () => {
    const cycle = runCycle(CASCADE);
    expect(cycle.end).toBe("rest");
    expect(cycle.still).toBe(true);
    expect(cycle.movements).toEqual(["A+", "B+", "B-", "A-"]);
    expect(cycle.rest).toEqual(REST);
    expect(cycle.steps).toHaveLength(5);
    cycle.steps.forEach((s, i) => expect(s, `step ${i + 1}`).toEqual(TABLE[i]));
  });

  it("gives the step diagram: A 0 1 1 1 0, B 0 0 1 0 0, line I 1 1 0 0, line II 0 0 1 1", () => {
    const cycle = runCycle(CASCADE);
    const diagram = stepDiagram(CASCADE, cycle);
    const row = (id: string, n: number) => Array.from({ length: n }, (_, k) => diagram[`${id}[${k + 1}]`]);
    expect(row("A", 5)).toEqual([0, 1, 1, 1, 0]);
    expect(row("B", 5)).toEqual([0, 0, 1, 0, 0]);
    expect(row("I", 4)).toEqual([1, 1, 0, 0]);
    expect(row("II", 4)).toEqual([0, 0, 1, 1]);
    expect(Object.keys(diagram)).toHaveLength(18);
    expect(quantities(CASCADE, { S: 0 })).toEqual(diagram);
  });

  it("holding S cycles again, and the diagram is still one cycle", () => {
    const base = quantities(CASCADE, { S: 0 });
    expect(quantities(CASCADE, { S: 1 })).toEqual(base);
    const held = runCycle(CASCADE, { S: 1 });
    expect(held.end).toBe("rest");
    expect(held.still).toBe(false);
  });

  it("names the rows: each cylinder, then each signal line", () => {
    expect(timingRows(CASCADE)).toEqual([
      { id: "A", label: "A", kind: "travel", at: "lines" },
      { id: "B", label: "B", kind: "travel", at: "lines" },
      { id: "I", label: "line I", kind: "signal", at: "intervals" },
      { id: "II", label: "line II", kind: "signal", at: "intervals" },
    ]);
  });
});

describe("time", () => {
  it("advance moves pistons in whole ms and processes each stroke end in order", () => {
    const { state } = pressed();
    expect(state.motion).toEqual({ A: 1, B: 0 });
    const quarter = advance(CASCADE, state, 250);
    expect(quarter.state.travel).toEqual({ A: 250, B: 0 });
    expect(quarter.events).toEqual([]);
    const past = advance(CASCADE, quarter.state, 800);
    // A ended at 1000 ms (750 more), then B set off and travelled the 50 ms left.
    expect(past.events).toContainEqual({ kind: "end", part: "A", at: "extended" });
    expect(past.events).toContainEqual({ kind: "made", part: "a1" });
    expect(past.events).toContainEqual({ kind: "shift", part: "VB", to: "14" });
    expect(past.events).toContainEqual({ kind: "start", part: "B", dir: 1 });
    expect(past.state.travel).toEqual({ A: STROKE_MS, B: 50 });
    expect(Number.isInteger(past.state.travel.B)).toBe(true);
  });

  it("toNextStep lands exactly on the next stroke end", () => {
    const { state } = pressed();
    const next = toNextStep(CASCADE, state);
    expect(next.state.ms).toBe(1000);
    expect(next.state.travel.A).toBe(STROKE_MS);
    expect(stepStateOf(CASCADE, next.state)).toEqual(TABLE[1]);
    const still = restState(CASCADE).state;
    expect(toNextStep(CASCADE, still)).toEqual({ state: still, events: [] });
  });

  it("a cylinder mid-stroke has no level at a step line", () => {
    const quarter = advance(CASCADE, pressed().state, 250).state;
    expect(() => stepStateOf(CASCADE, quarter)).toThrow(CycleError);
  });
});

describe("the live diagram", () => {
  it("after the press and half of A's stroke: line I on during the movement, A halfway", () => {
    const { state } = pressed();
    const half = advance(CASCADE, state, 500).state;
    const live = liveDiagram(CASCADE, [stepStateOf(CASCADE, state)], half);
    expect(live.levels).toEqual({ "A[1]": 0, "B[1]": 0, "I[1]": 1, "II[1]": 0 });
    expect(live.now).toEqual({ line: 1, fraction: 0.5, travel: { A: 0.5, B: 0 } });
  });

  it("has no movement under way when nothing moves", () => {
    const rest = restState(CASCADE).state;
    expect(liveDiagram(CASCADE, [], rest)).toEqual({ levels: {} });
    const cycle = runCycle(CASCADE);
    const done = liveDiagram(CASCADE, cycle.steps, rest);
    expect(done.now).toBeUndefined();
    expect(Object.keys(done.levels)).toHaveLength(18);
  });
});

describe("circuits a Professor could draw wrong", () => {
  it("a circuit without the cascade stalls at step 3 on VB's signal overlap", () => {
    const bypass = withNets((nets) => move(nets, "a1.1", "P"));
    const cycle = runCycle(bypass);
    expect(cycle.end).toBe("stall");
    expect(cycle.steps).toHaveLength(3);
    expect(cycle.movements).toEqual(["A+", "B+"]);
    expect(cycle.why).toBe("VB has both pilots pressurised (a signal overlap), so it can't shift");
    expect(() => quantities(bypass, { S: 0 })).toThrow(/the cycle stalls: VB has both pilots pressurised/);
  });

  it("a valve drawn on the wrong side at rest is reported", () => {
    const wrong = withNets(() => {}, { CV: "14" });
    const cycle = runCycle(wrong);
    expect(cycle.end).toBe("unstable");
    expect(cycle.why).toContain("VA shifts to 14");
    expect(cycle.why).toContain("A extends (A+)");
    expect(() => quantities(wrong, { S: 0 })).toThrow(/doesn't stay as drawn at rest/);
  });

  it("supply meeting exhaust throws a ShortError naming its pins", () => {
    const short = withNets((nets) => {
      move(nets, "VA.2", "Acap");
    });
    expect(() => restState(short)).toThrow(ShortError);
    expect(() => restState(short)).toThrow(/supply and exhaust meet through .*VA\.2.*VA\.4/);
  });

  it("a circuit that never settles throws, naming the valve", () => {
    const flutter = withNets((nets) => {
      for (const n of nets) n.pins = n.pins.filter((p) => p !== "VA.14" && p !== "VA.12");
      // Each pilot is fed from the opposite power port of its own valve: it shifts, which feeds the other.
      nets.push({ id: "f14", pins: ["VA.14", "VA.2"] }, { id: "f12", pins: ["VA.12", "VA.4"] });
    });
    expect(() => restState(flutter)).toThrow(CycleError);
    expect(() => restState(flutter)).toThrow(/the circuit doesn't settle: VA keeps shifting/);
  });
});

describe("captions", () => {
  it("each step of the Fixture cycle in causal order", () => {
    const cycle = runCycle(CASCADE);
    const captions = cycle.events.map((e, i) => stepCaption(CASCADE, e, i === cycle.events.length - 1));
    expect(captions).toEqual([
      "S pressed: CV shifts to 14; line I on, line II off; VA shifts to 14; A extends (A+); S let go",
      "A out: a1 made; VB shifts to 14; B extends (B+)",
      "B out: b1 made; CV shifts to 12; line I off, line II on; VB shifts to 12; B retracts (B−)",
      "B back: b0 made; VA shifts to 12; A retracts (A−)",
      "A back: a0 made; back at rest, the cycle is done",
    ]);
    expect(restCaption(CASCADE, cycle.rest.lines)).toBe("At rest: line II on. Press S to run A+ B+ B− A−.");
  });
});
