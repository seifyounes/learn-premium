// The state-diagram layout, its check and its mutants: the '101' detector's Moore diagram and the
// drill's GRAFCET, laid out by the layout core and the curve drawer, read back from geometry alone.
import { describe, expect, it } from "vitest";
import { ORDER_TOLERANCE, LINED_UP_PX } from "../src/sims/layout/check.ts";
import { checkDiagram, diagramReading, type DiagramReading } from "../src/sims/layout/diagram-check.ts";
import { diagramMutantsOf } from "../src/sims/layout/diagram-mutants.ts";
import {
  diagramProblems,
  layOutDiagram,
  modelEdgesOf,
  readEdges,
  type DiagramDrawing,
  type DiagramHints,
  type DiagramModel,
} from "../src/sims/layout/diagram.ts";
import { pointAt } from "../src/sims/layout/curves.ts";
import { textBox } from "../src/sims/layout/drawing.ts";

const detector: DiagramModel = {
  style: "arcs",
  initial: "S0",
  states: [
    { id: "S0", kind: "state", name: "S0", label: "S0/0", output: "0" },
    { id: "S1", kind: "state", name: "S1", label: "S1/0", output: "0" },
    { id: "S2", kind: "state", name: "S2", label: "S2/0", output: "0" },
    { id: "S3", kind: "state-accepting", name: "S3", label: "S3/1", output: "1" },
  ],
  edges: [
    { from: "S0", to: "S0", label: "0" },
    { from: "S0", to: "S1", label: "1" },
    { from: "S1", to: "S1", label: "1" },
    { from: "S1", to: "S2", label: "0" },
    { from: "S2", to: "S0", label: "0" },
    { from: "S2", to: "S3", label: "1" },
    { from: "S3", to: "S1", label: "1" },
    { from: "S3", to: "S2", label: "0" },
  ],
};
const detectorHints: DiagramHints = {
  states: {
    S0: { at: [0, 1], loop: "below" },
    S1: { at: [2, 0], loop: "above" },
    S2: { at: [2, 2] },
    S3: { at: [4, 1] },
  },
  edges: { "S2>S3": { bow: "below" }, "S3>S2": { bow: "above" } },
  start: "left",
};
const detectorReading: DiagramReading = diagramReading.parse({
  reading: "learn-premium diagram reading v1",
  by: "test",
  states: {
    S0: { kind: "state", at: [0, 0.5], output: "0", loop: "below" },
    S1: { kind: "state", at: [0.5, 0], output: "0", loop: "above" },
    S2: { kind: "state", at: [0.5, 1], output: "0" },
    S3: { kind: "state-accepting", at: [1, 0.5], output: "1" },
  },
  edges: [
    { from: "S0", to: "S0", label: "0" },
    { from: "S0", to: "S1", label: "1" },
    { from: "S1", to: "S1", label: "1" },
    { from: "S1", to: "S2", label: "0" },
    { from: "S2", to: "S0", label: "0" },
    { from: "S2", to: "S3", label: "1", bow: "below" },
    { from: "S3", to: "S1", label: "1" },
    { from: "S3", to: "S2", label: "0", bow: "above" },
  ],
  start: "S0",
});

const drill: DiagramModel = {
  style: "links",
  states: [
    { id: "X0", kind: "step-initial", name: "0", label: "0" },
    { id: "X1", kind: "step", name: "1", label: "1", output: "KM1", notes: { action: "KM1" } },
    { id: "X2", kind: "step", name: "2", label: "2", output: "KM2", notes: { action: "KM2" } },
  ],
  edges: [
    { from: "X0", to: "X1", label: "m·a" },
    { from: "X1", to: "X2", label: "b" },
    { from: "X2", to: "X0", label: "a" },
  ],
};
const drillHints: DiagramHints = {
  states: { X0: { at: [1, 0] }, X1: { at: [1, 1.2] }, X2: { at: [1, 2.4] } },
  edges: { "X2>X0": { bow: "left" } },
};
const drillReading: DiagramReading = diagramReading.parse({
  reading: "learn-premium diagram reading v1",
  by: "test",
  states: {
    "0": { kind: "step-initial", at: [0.5, 0] },
    "1": { kind: "step", at: [0.5, 0.5], output: "KM1" },
    "2": { kind: "step", at: [0.5, 1], output: "KM2" },
  },
  edges: [
    { from: "0", to: "1", label: "m·a" },
    { from: "1", to: "2", label: "b" },
    { from: "2", to: "0", label: "a", bow: "left" },
  ],
});

const failing = (d: DiagramDrawing, model: DiagramModel, reading: DiagramReading) =>
  checkDiagram(d, model, reading).checks.filter((c) => c.problems.length > 0);

describe("laying out the detector", () => {
  const d = layOutDiagram(detector, detectorHints);

  it("puts the states on the grid, draws eight edges with their labels and the start arrow into S0", () => {
    expect(d.states).toHaveLength(4);
    for (const s of d.states) expect([s.x % 20, s.y % 20]).toEqual([0, 0]);
    expect(d.edges).toHaveLength(8);
    expect(d.edgeLabels.map((t) => t.text)).toEqual(["0", "1", "1", "0", "0", "1", "1", "0"]);
    for (const e of d.edges) expect(e.curve.kind).toBe("cubic");
    const s0 = d.states.find((s) => s.id === "S0");
    expect(d.start?.tip[0]).toBe((s0?.x ?? 0) - 30);
    expect(d.start?.tip[1]).toBe(s0?.y);
    expect(d.width % 20).toBe(0);
    expect(d.height % 20).toBe(0);
  });

  it("the detector's loops sit where the hints put them: S0's below, S1's above", () => {
    const loops = readEdges(d).edges.flatMap((r, i) => (r.from !== undefined && r.from === r.to ? [{ r, i }] : []));
    expect(loops.map(({ r }) => r.from)).toEqual(["S0", "S1"]);
    for (const { r, i } of loops) {
      const state = d.states.find((s) => s.id === r.from);
      const apex = pointAt((d.edges[i] as DiagramDrawing["edges"][number]).curve, 0.5);
      if (r.from === "S0") expect(apex[1]).toBeGreaterThan((state?.y ?? 0) + 40);
      else expect(apex[1]).toBeLessThan((state?.y ?? 0) - 40);
    }
  });

  it("modelEdgesOf reads every drawn edge back to its model edge", () => {
    expect(modelEdgesOf(d, detector)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("reads every edge's ends and label back from geometry alone", () => {
    const { edges, problems } = readEdges(d);
    expect(problems).toEqual([]);
    expect(edges.map((r) => `${r.from}>${r.to}:${r.label}`)).toEqual([
      "S0>S0:0",
      "S0>S1:1",
      "S1>S1:1",
      "S1>S2:0",
      "S2>S0:0",
      "S2>S3:1",
      "S3>S1:1",
      "S3>S2:0",
    ]);
  });
});

describe("the detector and the drill pass every check against their models and readings", () => {
  it("eleven checks each, none failing", () => {
    for (const [model, hints, reading] of [
      [detector, detectorHints, detectorReading],
      [drill, drillHints, drillReading],
    ] as const) {
      const verdict = checkDiagram(layOutDiagram(model, hints), model, reading);
      expect(verdict.checks).toHaveLength(11);
      expect(verdict.checks.filter((c) => c.problems.length > 0)).toEqual([]);
      expect(verdict.pass).toBe(true);
    }
  });

  it("without a reading it runs the six drawing ↔ model checks only", () => {
    const verdict = checkDiagram(layOutDiagram(detector, detectorHints), detector);
    expect(verdict.checks.map((c) => c.id)).toEqual([
      "parts",
      "edges",
      "labels",
      "conventions",
      "legibility",
      "tidiness",
    ]);
  });
});

describe("the mutants", () => {
  it("each mutant fails the check it breaks; the detector yields nine, the drill eight and skips moved-loop", () => {
    for (const [model, hints, reading, count] of [
      [detector, detectorHints, detectorReading, 9],
      [drill, drillHints, drillReading, 8],
    ] as const) {
      const d = layOutDiagram(model, hints);
      const { mutants, skipped } = diagramMutantsOf(d);
      expect(mutants).toHaveLength(count);
      expect(skipped).toEqual(count === 9 ? [] : [{ id: "moved-loop", why: "the diagram draws no self-loop" }]);
      for (const mutant of mutants) {
        const ids = failing(mutant.drawing, model, reading).map((c) => c.id);
        expect(
          ids.some((id) => mutant.expect.includes(id)),
          `${mutant.id}: ${mutant.what} failed ${ids.join(", ") || "nothing"}`,
        ).toBe(true);
      }
    }
  });

  const messages = (id: string, model = detector, hints = detectorHints, reading = detectorReading) => {
    const mutant = diagramMutantsOf(layOutDiagram(model, hints)).mutants.find((m) => m.id === id);
    if (!mutant) throw new Error(`no ${id} mutant`);
    return checkDiagram(mutant.drawing, model, reading).checks.flatMap((c) => c.problems.map((p) => `${c.id}: ${p}`));
  };

  it("redirected: the model's edge is no longer drawn", () => {
    expect(messages("redirected")).toContain('edges: S0 → S1 ("1") is in the model but not drawn');
  });
  it("swapped-labels: the first two labels trade places", () => {
    expect(messages("swapped-labels")).toContain('edges: S0 → S0 is labelled "1" in the drawing, "0" in the model');
  });
  it("dropped-state: the model's state is no longer drawn", () => {
    expect(messages("dropped-state")).toContain("parts: S3 is in the model but not drawn");
  });
  it("moved-loop: the loop is drawn on the wrong side", () => {
    expect(messages("moved-loop")).toContain("bends: S0's self-loop is drawn above it, the figure draws it below");
  });
  it("plain-symbol: a double circle drawn as a circle", () => {
    const out = messages("plain-symbol");
    expect(out).toContain("symbols: S3 is drawn as a circle, the figure draws a double circle");
    expect(out).toContain("parts: S3 is drawn as a state, the model says state-accepting");
  });
  it("reversed: an edge drawn the other way is another edge", () => {
    const out = messages("reversed");
    expect(out.some((m) => m.startsWith("edges: S0 → S1 (") && m.endsWith("is in the model but not drawn"))).toBe(true);
  });
});

describe("alternative GRAFCET branches", () => {
  const branching: DiagramModel = {
    style: "links",
    states: [
      { id: "X0", kind: "step-initial", name: "0", label: "0" },
      { id: "X1", kind: "step", name: "1", label: "1" },
      { id: "X2", kind: "step", name: "2", label: "2" },
    ],
    edges: [
      { from: "X0", to: "X1", label: "a" },
      { from: "X0", to: "X2", label: "!a" },
    ],
  };
  const hints: DiagramHints = {
    states: { X0: { at: [2, 0] }, X1: { at: [0, 2] }, X2: { at: [4, 2] } },
    edges: {},
  };

  it("each branch carries its own bar and label, and the diagram passes every check", () => {
    const d = layOutDiagram(branching, hints);
    const bars = d.edges.map((e) => e.bar?.[0]);
    expect(bars[0]).not.toEqual(bars[1]);
    const reading = diagramReading.parse({
      reading: "learn-premium diagram reading v1",
      by: "test",
      states: {
        "0": { kind: "step-initial", at: [0.5, 0] },
        "1": { kind: "step", at: [0, 1] },
        "2": { kind: "step", at: [1, 1] },
      },
      edges: [
        { from: "0", to: "1", label: "a" },
        { from: "0", to: "2", label: "!a" },
      ],
    });
    expect(failing(d, branching, reading)).toEqual([]);
    expect(modelEdgesOf(d, branching)).toEqual([0, 1]);
  });

  it("a GRAFCET step that loops to itself is named, since a link joins one step to another", () => {
    const loop: DiagramModel = { ...branching, edges: [...branching.edges, { from: "X1", to: "X1", label: "b" }] };
    expect(diagramProblems(loop, hints)).toEqual([
      "X1 → X1 is a self-loop: a GRAFCET link joins one step to another, so a step doesn't loop to itself",
    ]);
  });
});

describe("the mirror mutant", () => {
  it("is skipped for a single-column GRAFCET with no return link, which a mirror reads the same", () => {
    const two: DiagramModel = {
      style: "links",
      states: [
        { id: "X0", kind: "step-initial", name: "0", label: "0" },
        { id: "X1", kind: "step", name: "1", label: "1" },
      ],
      edges: [{ from: "X0", to: "X1", label: "a" }],
    };
    const hints: DiagramHints = { states: { X0: { at: [1, 0] }, X1: { at: [1, 1.2] } }, edges: {} };
    const reading = diagramReading.parse({
      reading: "learn-premium diagram reading v1",
      by: "test",
      states: { "0": { kind: "step-initial", at: [0.5, 0] }, "1": { kind: "step", at: [0.5, 1] } },
      edges: [{ from: "0", to: "1", label: "a" }],
    });
    const d = layOutDiagram(two, hints);
    expect(failing(d, two, reading)).toEqual([]);
    const { mutants, skipped } = diagramMutantsOf(d);
    expect(skipped.map((s) => s.id)).toContain("mirrored");
    expect(mutants.map((m) => m.id)).not.toContain("mirrored");
    // Every mutant that is planted fails a check it names, so the valid diagram passes the gate.
    for (const mutant of mutants)
      expect(
        failing(mutant.drawing, two, reading).some((c) => mutant.expect.includes(c.id)),
        mutant.id,
      ).toBe(true);
  });
});

describe("a label as near two edges is ambiguous", () => {
  it("names the label and both edges", () => {
    const d = layOutDiagram(detector, detectorHints);
    // Move the label of S3 → S1 to the midpoint between S3 → S1 and S3 → S2.
    const labels = d.edgeLabels.map((t) => ({ ...t }));
    const a = pointAt((d.edges[6] as DiagramDrawing["edges"][number]).curve, 0.5);
    const b = pointAt((d.edges[7] as DiagramDrawing["edges"][number]).curve, 0.5);
    const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const target = labels[6];
    if (!target) throw new Error("no label");
    const [x0, y0, x1, y1] = textBox(target);
    labels[6] = { ...target, x: Math.round(mid[0] - (x1 - x0) / 2), y: Math.round(mid[1] + (y1 - y0) / 2 - 3) };
    const problems = readEdges({ ...d, edgeLabels: labels }, (id) => id).problems;
    expect(problems.some((p) => p.startsWith('the label "1" sits as near') || p.includes("from every edge"))).toBe(
      true,
    );
  });
});

describe("diagramProblems names each broken hint", () => {
  const say = (model: DiagramModel, hints: DiagramHints) => diagramProblems(model, hints);

  it("passes the detector and the drill", () => {
    expect(say(detector, detectorHints)).toEqual([]);
    expect(say(drill, drillHints)).toEqual([]);
  });

  it("names a repeated state, an edge to nowhere and a repeated pair", () => {
    const twice = { ...detector, states: [...detector.states, detector.states[0]] } as DiagramModel;
    expect(say(twice, detectorHints)).toContain("state S0 is listed twice");
    const nowhere = { ...detector, edges: [...detector.edges, { from: "S0", to: "S9", label: "1" }] };
    expect(say(nowhere, detectorHints)).toContain("edge S0 → S9 names S9, which the model doesn't have");
    const repeated = { ...detector, edges: [...detector.edges, { from: "S0", to: "S1", label: "0" }] };
    expect(say(repeated, detectorHints)).toContain(
      "S0 → S1 is listed twice: write one edge per pair, its labels joined by commas",
    );
  });

  it("names a state with no hint and a hint for no state", () => {
    const rest = Object.fromEntries(Object.entries(detectorHints.states).filter(([id]) => id !== "S3"));
    expect(say(detector, { ...detectorHints, states: rest })).toContain("state S3 has no layout hint");
    expect(say(detector, { ...detectorHints, states: { ...detectorHints.states, S9: { at: [1, 1] } } })).toContain(
      "the layout hints place S9, which the model doesn't have",
    );
  });

  it("names a self-loop with no side and a side on a state with no self-loop", () => {
    expect(say(detector, { ...detectorHints, states: { ...detectorHints.states, S0: { at: [0, 1] } } })).toContain(
      "S0 has a self-loop, so its hint gives the side the figure draws it on (loop)",
    );
    expect(
      say(detector, { ...detectorHints, states: { ...detectorHints.states, S2: { at: [2, 2], loop: "below" } } }),
    ).toContain("S2's hint gives a self-loop side, but S2 has no self-loop");
  });

  it("names an edge hint for no edge, for a self-loop, with a bend but no side, and bowed the wrong way", () => {
    const edges = (more: DiagramHints["edges"]) => ({ ...detectorHints, edges: { ...detectorHints.edges, ...more } });
    expect(say(detector, edges({ "S0>S9": { bow: "above" } }))).toContain(
      "the layout hints bend S0>S9, which is no edge of the model",
    );
    expect(say(detector, edges({ "S0>S0": { bow: "above" } }))).toContain(
      "S0>S0 is a self-loop: its side is S0's loop hint",
    );
    expect(say(detector, edges({ "S0>S1": { bend: 0.5 } }))).toContain(
      "S0>S1 gives a bend but no side: a bend says which side it bows to (bow)",
    );
    expect(say(detector, edges({ "S1>S2": { bow: "above" } }))).toContain(
      "S1>S2 bows above, but it runs straight up and down: bow it left or right",
    );
    expect(say(detector, edges({ "S2>S3": { bow: "left" } })).length).toBe(0);
  });

  it("names a horizontal edge bowed along itself", () => {
    const flat: DiagramHints = {
      ...detectorHints,
      states: { ...detectorHints.states, S3: { at: [4, 2] } },
      edges: { "S2>S3": { bow: "left" } },
    };
    expect(say(detector, flat)).toContain("S2>S3 bows left, but it runs straight across: bow it above or below");
  });

  it("names a bend on a GRAFCET link, an unknown initial state and a GRAFCET start arrow", () => {
    expect(say(drill, { ...drillHints, edges: { "X2>X0": { bow: "left", bend: 0.5 } } })).toContain(
      "X2>X0 gives a bend, but a GRAFCET link runs on the grid: give only its bow",
    );
    expect(say({ ...detector, initial: "S9" }, detectorHints)).toContain("the initial state S9 isn't in the model");
    expect(say(drill, { ...drillHints, start: "left" })).toContain(
      "a GRAFCET draws no start arrow: its initial steps are double squares",
    );
  });
});

describe("the arrangement rule is check.ts's", () => {
  it("shares its tolerances", () => {
    expect(ORDER_TOLERANCE).toBe(0.04);
    expect(LINED_UP_PX).toBe(10);
  });
});
