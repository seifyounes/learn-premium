// The state-diagram gate's negative control, run on every drawing at every build: each mutant breaks a
// good drawing one known way, and the gate must fail it on the check named. A gate that passes a
// mutant can't see what it claims to check.
import { arc, pointAt, selfLoop, unit, onOutline, type DrawnEdge } from "./curves.ts";
import type { DiagramCheckId } from "./diagram-check.ts";
import { readEdges, type DiagramDrawing } from "./diagram.ts";
import { textBox, textWidth, type PlacedPart, type Text } from "./drawing.ts";
import type { Point, Side } from "./symbols.ts";

export type DiagramMutantId =
  | "redirected"
  | "reversed"
  | "swapped-labels"
  | "dropped-state"
  | "moved-loop"
  | "mirrored"
  | "extra-state"
  | "plain-symbol"
  | "label";

export interface DiagramMutant {
  id: DiagramMutantId;
  what: string;
  /** The checks that must fail on it: any one catches it. */
  expect: readonly DiagramCheckId[];
  drawing: DiagramDrawing;
}

/** A mutant the drawing has nothing to plant in (no self-loop to move), and why. */
export interface SkippedDiagramMutant {
  id: DiagramMutantId;
  why: string;
}

const clone = (d: DiagramDrawing): DiagramDrawing => structuredClone(d);
const compass = ([x, y]: Point): Side =>
  Math.abs(x) >= Math.abs(y) ? (x < 0 ? "left" : "right") : y < 0 ? "above" : "below";
/** The other side of the same axis. */
function opposite(side: Side): Side {
  switch (side) {
    case "left":
      return "right";
    case "right":
      return "left";
    case "above":
      return "below";
    case "below":
      return "above";
  }
}

/** Every mutant the drawing can carry, and why any it can't was left out. */
export function diagramMutantsOf(d: DiagramDrawing): { mutants: DiagramMutant[]; skipped: SkippedDiagramMutant[] } {
  const mutants: DiagramMutant[] = [];
  const skipped: SkippedDiagramMutant[] = [];
  const skip = (id: DiagramMutantId, why: string) => skipped.push({ id, why });
  const read = readEdges(d).edges;
  const part = (id: string | undefined) => d.states.find((s) => s.id === id);
  const first = read.findIndex((r) => r.from !== undefined && r.to !== undefined && r.from !== r.to);

  // An edge re-aimed at a state the figure doesn't point it at.
  const aimed = first < 0 ? undefined : read[first];
  const third = aimed
    ? d.states.find(
        (s) => s.id !== aimed.from && s.id !== aimed.to && !read.some((r) => r.from === aimed.from && r.to === s.id),
      )
    : undefined;
  const source = part(aimed?.from);
  if (aimed && third && source) {
    const m = clone(d);
    (m.edges as DrawnEdge[])[first] = arc(source, third, [0, 0]);
    mutants.push({
      id: "redirected",
      what: `${aimed.from} → ${aimed.to} re-aimed at ${third.id}`,
      expect: ["edges"],
      drawing: m,
    });
  } else skip("redirected", "no edge whose source has a third state to point it at");

  // An edge drawn the wrong way round.
  const flipped = first < 0 ? undefined : d.edges[first];
  if (flipped) {
    const m = clone(d);
    const points = [...flipped.curve.points].reverse();
    const tip = points[points.length - 1] as Point;
    const before = points[points.length - 2] as Point;
    (m.edges as DrawnEdge[])[first] = {
      curve: (flipped.curve.kind === "cubic"
        ? { kind: "cubic", points: points as unknown as [Point, Point, Point, Point] }
        : { kind: "polyline", points }) as DrawnEdge["curve"],
      arrow: { tip, dir: unit([tip[0] - before[0], tip[1] - before[1]]) },
      ...(flipped.bar ? { bar: flipped.bar } : {}),
    };
    mutants.push({
      id: "reversed",
      what: `${aimed?.from} → ${aimed?.to} drawn the other way round`,
      expect: ["edges"],
      drawing: m,
    });
  } else skip("reversed", "no edge between two states");

  // Two labels' texts swapped.
  const a = 0;
  const b = d.edgeLabels.findIndex((t) => t.text !== d.edgeLabels[a]?.text);
  if (d.edgeLabels.length >= 2 && b > 0) {
    const m = clone(d);
    const labels = m.edgeLabels as Text[];
    [labels[a], labels[b]] = [
      { ...(labels[a] as Text), text: (d.edgeLabels[b] as Text).text },
      { ...(labels[b] as Text), text: (d.edgeLabels[a] as Text).text },
    ];
    mutants.push({
      id: "swapped-labels",
      what: `the labels "${d.edgeLabels[a]?.text}" and "${d.edgeLabels[b]?.text}" swapped`,
      expect: ["edges"],
      drawing: m,
    });
  } else skip("swapped-labels", "fewer than two different labels");

  // A state dropped with every edge that meets it and their labels.
  const startTarget = d.start ? d.states.find((s) => onOutline(s, d.start?.tip as Point)) : undefined;
  const droppable = d.states.filter((s) => s.id !== startTarget?.id && s.kind !== "step-initial").at(-1);
  if (droppable) {
    const m = clone(d);
    const meets = d.edges.map(
      (e) => onOutline(droppable, e.curve.points[0] as Point) || onOutline(droppable, e.arrow.tip),
    );
    m.states = m.states.filter((s) => s.id !== droppable.id);
    m.edges = m.edges.filter((_, i) => !meets[i]);
    m.edgeLabels = m.edgeLabels.filter((_, i) => !meets[i]);
    mutants.push({
      id: "dropped-state",
      what: `${droppable.id} dropped with its edges`,
      expect: ["parts"],
      drawing: m,
    });
  } else skip("dropped-state", "every state is the start or an initial step");

  // A self-loop moved to the opposite side.
  const loop = read.findIndex((r) => r.from !== undefined && r.from === r.to);
  const loopState = part(read[loop]?.from);
  const loopEdge = d.edges[loop];
  if (loopState && loopEdge) {
    const m = clone(d);
    const apex = pointAt(loopEdge.curve, 0.5);
    const side = compass([apex[0] - loopState.x, apex[1] - loopState.y]);
    (m.edges as DrawnEdge[])[loop] = selfLoop(loopState, opposite(side));
    mutants.push({
      id: "moved-loop",
      what: `${loopState.id}'s self-loop moved from ${side} to ${opposite(side)}`,
      expect: ["bends"],
      drawing: m,
    });
  } else skip("moved-loop", "the diagram draws no self-loop");

  // The whole drawing mirrored.
  mutants.push({
    id: "mirrored",
    what: "the diagram mirrored, every edge intact",
    expect: ["arrangement", "bends"],
    drawing: mirrored(d),
  });

  // A state the model doesn't have.
  {
    const m = clone(d);
    const kind = d.states.some((s) => s.kind === "step" || s.kind === "step-initial") ? "step" : "state";
    const x = d.width + 60;
    const y = 60;
    const label = { text: "SX", x: Math.round(x - textWidth("SX") / 2), y: y + 5 };
    (m.states as PlacedPart[]).push({ id: "SX", kind, x, y, turn: 0, flip: false, label });
    mutants.push({ id: "extra-state", what: `an extra ${kind} SX drawn`, expect: ["parts"], drawing: m });
  }

  // A double circle or double square drawn single.
  const doubled = d.states.find((s) => s.kind === "state-accepting") ?? d.states.find((s) => s.kind === "step-initial");
  if (doubled) {
    const m = clone(d);
    const plain = doubled.kind === "state-accepting" ? "state" : "step";
    (m.states as PlacedPart[]).forEach((s) => {
      if (s.id === doubled.id) s.kind = plain;
    });
    mutants.push({
      id: "plain-symbol",
      what: `${doubled.id} drawn as a plain ${plain}`,
      expect: ["parts", "symbols"],
      drawing: m,
    });
  } else skip("plain-symbol", "the diagram has no double circle or double square");

  // A state's label dropped.
  const labelled = d.states[0];
  if (labelled) {
    const m = clone(d);
    const s = (m.states as PlacedPart[])[0] as PlacedPart;
    delete s.label;
    mutants.push({ id: "label", what: `${labelled.id}'s label dropped`, expect: ["labels"], drawing: m });
  } else skip("label", "the diagram has no state");

  return { mutants, skipped };
}

/** `d` mirrored about its middle: states, labels, curves, arrows, bars and the start arrow reflected. */
function mirrored(d: DiagramDrawing): DiagramDrawing {
  const xs = [...d.states.map((s) => s.x), ...d.edges.flatMap((e) => e.curve.points.map((p) => p[0]))];
  const span = Math.min(...xs) + Math.max(...xs);
  const flip = ([x, y]: Point): Point => [span - x, y];
  const text = (t: Text): Text => ({ ...t, x: span - textBox(t)[2] });
  return {
    width: d.width,
    height: d.height,
    states: d.states.map((s) => ({
      ...s,
      x: span - s.x,
      ...(s.label ? { label: text(s.label) } : {}),
      ...(s.notes ? { notes: s.notes.map(text) } : {}),
    })),
    edges: d.edges.map((e) => ({
      curve: (e.curve.kind === "cubic"
        ? { kind: "cubic", points: e.curve.points.map(flip) as unknown as [Point, Point, Point, Point] }
        : { kind: "polyline", points: e.curve.points.map(flip) }) as DrawnEdge["curve"],
      arrow: { tip: flip(e.arrow.tip), dir: [-e.arrow.dir[0], e.arrow.dir[1]] },
      ...(e.bar ? { bar: [flip(e.bar[0]), flip(e.bar[1])] as const } : {}),
    })),
    edgeLabels: d.edgeLabels.map(text),
    ...(d.start ? { start: { tail: flip(d.start.tail), tip: flip(d.start.tip) } } : {}),
  };
}
