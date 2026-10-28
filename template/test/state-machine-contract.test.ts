// The state-machine sims' side of the content contract: a Moore FSM or a GRAFCET as states and
// labelled edges, Layout hints (never a coordinate), and the inputs the example opens on. Each way a
// Professor's figure can be written wrong is read by name.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sim } from "../src/content/contract.ts";
import {
  diagramModelOf,
  engineQuantities,
  isSchematic,
  isStateDiagram,
  KINDS,
  type LiveSim,
} from "../src/sims/kinds.ts";
import { quantities } from "../src/sims/state-machine/engine.ts";
import { FIXTURE_COURSE } from "./build-course";
import { detector, detectorLayout, drill, drillLayout } from "./state-machine-models.ts";

const columns = (cols: string[], quantity: (col: number, k: number) => string) =>
  Object.fromEntries(cols.flatMap((c, i) => Array.from({ length: 9 }, (_, k) => [`${c}${k + 1}`, quantity(i, k + 1)])));

const detectorSim = () => ({
  kind: "fsm",
  title: "The '101' detector, clock by clock",
  caption: "Set $x$ and press Clock.",
  recompute: "independent",
  worked: "1",
  sheet: columns(["B", "D", "E", "F"], (i, k) => `${["x", "Q1", "Q0", "z"][i]}[${k}]`) as Record<string, string>,
  model: structuredClone(detector) as unknown as Record<string, unknown>,
  layout: structuredClone(detectorLayout) as unknown as Record<string, unknown>,
  start: { x: 0 } as Record<string, number>,
  tune: { x: { min: 0, max: 1, step: 1 } } as Record<string, unknown>,
  provenance: { stated: ["the states, the codes, the equations, the input sequence"] },
});

const drillSim = () => ({
  kind: "grafcet",
  title: "The drill's GRAFCET, clock by clock",
  caption: "Set $m$, $a$ and $b$ and press Clock.",
  recompute: "independent",
  worked: "2",
  sheet: columns(
    ["B", "C", "D", "E", "F", "G", "H", "I"],
    (i, k) => `${["m", "a", "b", "X0", "X1", "X2", "KM1", "KM2"][i]}[${k}]`,
  ) as Record<string, string>,
  model: structuredClone(drill) as unknown as Record<string, unknown>,
  layout: structuredClone(drillLayout) as unknown as Record<string, unknown>,
  start: { m: 0, a: 1, b: 0 } as Record<string, number>,
  tune: {
    m: { min: 0, max: 1, step: 1 },
    a: { min: 0, max: 1, step: 1 },
    b: { min: 0, max: 1, step: 1 },
  } as Record<string, unknown>,
  provenance: { stated: ["the steps, the transitions, the actions"] },
});

type Raw = ReturnType<typeof detectorSim>;
const issues = (raw: unknown) => sim.safeParse(raw).error?.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
const model = (raw: Raw) =>
  raw.model as { states: Record<string, unknown>[]; edges: Record<string, unknown>[] } & Record<string, unknown>;
const hints = (raw: Raw) =>
  raw.layout as {
    states: Record<string, Record<string, unknown>>;
    edges: Record<string, Record<string, unknown>>;
    start?: string;
  };

describe("the state-machine contract", () => {
  it("keeps the contract for the detector and the drill", () => {
    expect(issues(detectorSim())).toBeUndefined();
    expect(issues(drillSim())).toBeUndefined();
  });

  it("parses the model as written: no defaulted key for a recompute to miss", () => {
    for (const raw of [detectorSim(), drillSim()]) {
      const parsed = sim.parse(raw);
      expect(parsed.model).toEqual(raw.model);
    }
  });

  it("has no field for a drawing coordinate", () => {
    const raw = detectorSim();
    hints(raw).states.S0 = { ...hints(raw).states.S0, x: 240 };
    expect(issues(raw)).toEqual(['layout.states.S0: Unrecognized key: "x"']);
  });

  it("gives every state a layout hint", () => {
    const raw = detectorSim();
    delete hints(raw).states.S3;
    expect(issues(raw)).toEqual(["model: state S3 has no layout hint"]);
  });

  it("gives a state with a self-loop the side the figure draws it on, and nobody else", () => {
    const raw = detectorSim();
    delete hints(raw).states.S0?.loop;
    expect(issues(raw)).toEqual([
      "model: S0 has a self-loop, so its hint gives the side the figure draws it on (loop)",
    ]);
    const other = detectorSim();
    hints(other).states.S2 = { at: [2, 2], loop: "below" };
    expect(issues(other)).toEqual(["model: S2's hint gives a self-loop side, but S2 has no self-loop"]);
  });

  it("takes a bend only with a side, and a side only across the way the edge runs", () => {
    const bend = detectorSim();
    hints(bend).edges["S0>S1"] = { bend: 0.5 };
    expect(issues(bend)).toEqual(["model: S0>S1 gives a bend but no side: a bend says which side it bows to (bow)"]);
    const up = detectorSim();
    hints(up).edges["S1>S2"] = { bow: "above" };
    expect(issues(up)).toEqual(["model: S1>S2 bows above, but it runs straight up and down: bow it left or right"]);
  });

  it("names an initial state that isn't in the model", () => {
    const raw = detectorSim();
    model(raw).initial = "S9";
    expect(issues(raw)).toContain("model: the initial state S9 isn't in the model");
  });

  it("refuses a state with a part of it missing", () => {
    const raw = detectorSim();
    delete model(raw).states[1]?.label;
    expect(issues(raw)?.[0]).toContain("model.states.1.label");
  });

  it("refuses two edges for one input", () => {
    const raw = detectorSim();
    model(raw).edges[3] = { from: "S1", to: "S2", label: "-" };
    expect(issues(raw)).toEqual(['model: S1 → S1 ("1") and S1 → S2 ("-") both take x = 1: one input takes one edge']);
  });

  it("refuses a bad input pattern", () => {
    const raw = detectorSim();
    model(raw).edges[1] = { from: "S0", to: "S1", label: "10" };
    expect(issues(raw)).toEqual([
      'model: S0 → S1\'s label "10" has 2 bits, but the machine has 1 input (x): one 0, 1 or - per input',
    ]);
  });

  it("refuses a receptivity it can't read, or that names no input", () => {
    const unread = drillSim();
    model(unread).edges[0] = { from: "X0", to: "X1", label: "m·" };
    expect(issues(unread)?.[0]).toContain("X0 → X1's receptivity \"m·\" can't be read");
    const stranger = drillSim();
    model(stranger).edges[0] = { from: "X0", to: "X1", label: "q" };
    expect(issues(stranger)).toEqual(["model: X0 → X1's receptivity names q, which isn't an input"]);
  });

  it("refuses a GRAFCET with no initial step, and a step whose id isn't X and its number", () => {
    const none = drillSim();
    (model(none).states[0] as { kind: string }).kind = "step";
    expect(issues(none)).toEqual([
      "model: the GRAFCET has no initial step: the figure draws one as a double square (step-initial)",
    ]);
    const odd = drillSim();
    (model(odd).states[1] as { id: string }).id = "Y1";
    (model(odd).edges[0] as { to: string }).to = "Y1";
    (model(odd).edges[1] as { from: string }).from = "Y1";
    hints(odd).states.Y1 = hints(odd).states.X1 as never;
    delete hints(odd).states.X1;
    expect(issues(odd)).toEqual(["model: step Y1's id isn't X followed by its number (1)"]);
  });

  it("refuses a start that isn't the example's first period, or that gives other inputs", () => {
    const raw = detectorSim();
    raw.start = { x: 1 };
    expect(issues(raw)).toEqual([
      "start.x: start gives x = 1, but the example's first period has x = 0: the sim opens on it",
    ]);
    const keys = drillSim();
    keys.start = { m: 0, a: 1 };
    expect(issues(keys)).toContain("start: start gives m, a, but the inputs are m, a, b, in that order");
    const tune = drillSim();
    tune.tune = { m: { min: 0, max: 1, step: 1 } };
    expect(issues(tune)).toContain("tune: tune gives m, but the inputs are m, a, b, in that order");
  });

  it("refuses an equation that disagrees with the diagram", () => {
    const raw = detectorSim();
    (model(raw).equations as { expr: string }[])[0] = { name: "D1", gives: "Q1", expr: "Q0·x'" } as never;
    expect(issues(raw)).toEqual([
      "model: D1 = Q0·x' gives 0 with S2 active and x = 1, but the diagram gives Q1 = 1 next",
    ]);
  });
});

describe("a state machine's engine and kind", () => {
  const live = (raw: unknown) => sim.parse(raw) as LiveSim;

  it("is checked by timing-key", () => {
    expect(KINDS.fsm.checkedBy).toBe("timing-key");
    expect(KINDS.grafcet.checkedBy).toBe("timing-key");
  });

  it("engineQuantities runs the detector and the drill: the bits of their strips", () => {
    const bits = engineQuantities(live(detectorSim()));
    expect(Object.keys(bits)).toHaveLength(36);
    expect(bits).toEqual(quantities("fsm", detector));
    expect(bits["z[6]"]).toBe(1);
    const steps = engineQuantities(live(drillSim()));
    expect(Object.keys(steps)).toHaveLength(72);
    expect(steps["X1[3]"]).toBe(1);
    expect(steps["KM2[7]"]).toBe(1);
  });

  it("isSchematic leaves state diagrams to the curve drawer", () => {
    const fsm = sim.parse(detectorSim());
    const grafcet = sim.parse(drillSim());
    expect([isSchematic(fsm), isStateDiagram(fsm)]).toEqual([false, true]);
    expect([isSchematic(grafcet), isStateDiagram(grafcet)]).toEqual([false, true]);
    const adder = sim.parse(
      JSON.parse(readFileSync(join(FIXTURE_COURSE, "modules/04-full-adder/sims/adder.json"), "utf8")),
    );
    expect([isSchematic(adder), isStateDiagram(adder)]).toEqual([true, false]);
  });

  it("draws a state diagram's model as the layout core's diagram model", () => {
    const parsed = sim.parse(detectorSim());
    if (!isStateDiagram(parsed)) throw new Error("not a state diagram");
    const diagram = diagramModelOf(parsed);
    expect(diagram.style).toBe("arcs");
    expect(diagram.states.map((s) => s.label)).toEqual(["S0/0", "S1/0", "S2/0", "S3/1"]);
  });
});
