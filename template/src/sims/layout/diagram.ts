// The diagram layout: a state diagram's states (circles or GRAFCET steps) and the Layout hints read
// off its figure in, a finished drawing out. States are placed by the layout core's `place`; the
// edges are drawn by the curve drawer, not the router. Pure and deterministic, so the state-diagram
// gate checks exactly the drawing the page shows. Edges carry no ids: `readEdges` reads each one's
// ends and label back from geometry alone.
import {
  arc,
  ARROW,
  DEFAULT_BEND,
  LABEL_GAP,
  link,
  onOutline,
  pointAt,
  sample,
  selfLoop,
  sideVector,
  unit,
  distanceToPolyline,
  type Curve,
  type DrawnEdge,
} from "./curves.ts";
import { textBox, textWidth, type PlacedPart, type SchematicModel, type Text } from "./drawing.ts";
import { PITCH, place } from "./place.ts";
import { STEP_HALF, type StateDiagramKind } from "./state-diagram.ts";
import { boxOf, GRID, type Point, type Side } from "./symbols.ts";

export interface DiagramState {
  id: string;
  kind: StateDiagramKind;
  /** The name the figure gives it (S3, a step's number 1): a figure reading keys it by this. */
  name: string;
  /** What the figure prints in it: `S3/1` (a Moore state's name and output), `1` (a step). */
  label: string;
  /** What the figure prints as its output, for the figure check: `1` for S3, `KM1` for a step's action. */
  output?: string | undefined;
  /** A step's actions, set in its symbol's `action` slot. */
  notes?: Readonly<Record<string, string>> | undefined;
}

export interface DiagramEdge {
  from: string;
  to: string;
  label: string;
}

export interface DiagramModel {
  states: readonly DiagramState[];
  edges: readonly DiagramEdge[];
  /** The FSM's reset state, drawn with the start arrow; a GRAFCET has none (its initial steps are double squares). */
  initial?: string | undefined;
  /** `arcs`: curved edges between circles (an FSM); `links`: orthogonal links between squares (a GRAFCET). */
  style: "arcs" | "links";
}

export interface DiagramHints {
  states: Readonly<Record<string, { at: readonly [number, number]; loop?: Side | undefined }>>;
  /** By `from>to`: the side an edge bows to, how far (coarse steps, arcs only), and its label's side. */
  edges: Readonly<Record<string, { bow?: Side | undefined; bend?: number | undefined; label?: Side | undefined }>>;
  /** The side the start arrow comes from (an FSM). Default `left`. */
  start?: Side | undefined;
}

export interface DiagramDrawing {
  width: number;
  height: number;
  states: readonly PlacedPart[];
  edges: readonly DrawnEdge[];
  /** Each edge's printed label: read back by nearness, never by index. */
  edgeLabels: readonly Text[];
  start?: { tail: Point; tip: Point } | undefined;
}

/** The clear sheet left round the drawing, in grid steps. */
const MARGIN = 1;
/** A label is read as an edge's only within this many px of it... */
export const LABEL_REACH = 40;
/** ...and only when it is this much nearer it than any other edge. */
export const LABEL_MARGIN = 8;
/** Samples along an edge when a label is matched to it. */
const MATCH_SAMPLES = 48;
const LABEL_HEIGHT = 14;

const minus = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const plus = (a: Point, b: Point): Point => [a[0] + b[0], a[1] + b[1]];
const scaled = (a: Point, k: number): Point => [a[0] * k, a[1] * k];
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1];

/** An edge's key in the hints: `S0>S1`. */
const edgeKey = (e: { from: string; to: string }) => `${e.from}>${e.to}`;

/** A step's action box: the step's height, 8px round the note's text; [x0, y0, x1, y1]. */
export function actionBox(part: PlacedPart, note: Text): [number, number, number, number] {
  return [note.x - 8, part.y - STEP_HALF, note.x + textWidth(note.text) + 8, part.y + STEP_HALF];
}

/** The points of a curve densely enough that no point or segment of it hides from a box. */
export function dense(curve: Curve): Point[] {
  if (curve.kind === "cubic") return sample(curve, MATCH_SAMPLES);
  const out: Point[] = [];
  curve.points.forEach((p, i) => {
    const before = curve.points[i - 1];
    if (!before) return void out.push(p);
    const steps = Math.max(1, Math.ceil(Math.hypot(p[0] - before[0], p[1] - before[1]) / 6));
    for (let k = 1; k <= steps; k++)
      out.push([before[0] + ((p[0] - before[0]) * k) / steps, before[1] + ((p[1] - before[1]) * k) / steps]);
  });
  return out;
}

/** A label of width `w` set along unit `n` from `anchor`, its box a `LABEL_GAP` clear of the anchor. */
function labelAt(text: string, anchor: Point, n: Point): Text {
  const w = textWidth(text);
  const reach = LABEL_GAP + (w / 2) * Math.abs(n[0]) + (LABEL_HEIGHT / 2) * Math.abs(n[1]);
  const centre = plus(anchor, scaled(n, reach));
  return { text, x: Math.round(centre[0] - w / 2), y: Math.round(centre[1] + 4) };
}

/** The unit normal to a chord that points toward `side`. */
function normalToward(chord: Point, side: Point): Point {
  const n = unit([-chord[1], chord[0]]);
  return dot(n, side) < 0 ? scaled(n, -1) : n;
}

export function layOutDiagram(model: DiagramModel, hints: DiagramHints): DiagramDrawing {
  const schematic: SchematicModel = {
    parts: model.states.map((s) => ({ id: s.id, kind: s.kind, label: s.label, notes: s.notes })),
    nets: [],
  };
  const states = place(schematic, {
    parts: Object.fromEntries(model.states.map((s) => [s.id, { at: hints.states[s.id]?.at ?? [0, 0] }])),
  });
  const byId = new Map(states.map((s) => [s.id, s]));
  const centroid: Point = [
    states.reduce((sum, s) => sum + s.x, 0) / Math.max(1, states.length),
    states.reduce((sum, s) => sum + s.y, 0) / Math.max(1, states.length),
  ];
  const has = (from: string, to: string) => model.edges.some((e) => e.from === from && e.to === to);

  // GRAFCET return links run beside the outermost step (and its action box) on their side.
  const outer = (side: "left" | "right") => {
    const xs = states.flatMap((s) => {
      const [x0, , x1] = boxOf(s);
      const actions = (s.notes ?? []).map((n) => actionBox(s, n)[2]);
      return side === "left" ? [x0] : [x1, ...actions];
    });
    return side === "left"
      ? Math.floor((Math.min(...xs) - 40) / GRID) * GRID
      : Math.ceil((Math.max(...xs) + 40) / GRID) * GRID;
  };

  const edges: DrawnEdge[] = [];
  const edgeLabels: Text[] = [];
  for (const e of model.edges) {
    const from = byId.get(e.from);
    const to = byId.get(e.to);
    if (!from || !to) continue;
    const hint = hints.edges[edgeKey(e)];
    let drawn: DrawnEdge;
    let anchor: Point;
    let n: Point;
    if (e.from === e.to) {
      const side = hints.states[e.from]?.loop ?? "above";
      drawn = selfLoop(from, side);
      anchor = pointAt(drawn.curve, 0.5);
      n = sideVector(side);
    } else if (model.style === "links") {
      const bow = hint?.bow === "right" ? "right" : "left";
      drawn = link(from, to, to.y <= from.y ? outer(bow) : undefined);
      // The label sits beside the bar: 16px along from its centre on the right (default), or the same
      // clear of it on the left; its baseline 5px below the bar.
      const [barA, barB] =
        drawn.bar ??
        ([
          [from.x, from.y],
          [from.x, from.y],
        ] as const);
      const cx = (barA[0] + barB[0]) / 2;
      const w = textWidth(e.label);
      edgeLabels.push({ text: e.label, x: hint?.label === "left" ? cx - 16 - w : cx + 16, y: barA[1] + 5 });
      edges.push(drawn);
      continue;
    } else {
      const toward = to.x - from.x;
      const chord: Point = [toward, to.y - from.y];
      let sagitta: Point = [0, 0];
      if (hint?.bow) {
        sagitta = scaled(normalToward(chord, sideVector(hint.bow)), (hint.bend ?? DEFAULT_BEND) * PITCH);
      } else if (has(e.to, e.from)) {
        sagitta = scaled(unit([-chord[1], chord[0]]), DEFAULT_BEND * PITCH);
      }
      drawn = arc(from, to, sagitta);
      anchor = pointAt(drawn.curve, 0.5);
      const bowed = sagitta[0] !== 0 || sagitta[1] !== 0;
      if (hint?.label) n = normalToward(chord, sideVector(hint.label));
      else if (bowed) n = unit(sagitta);
      else {
        const away = normalToward(chord, minus(anchor, centroid));
        const tie = Math.abs(dot(unit([-chord[1], chord[0]]), minus(anchor, centroid))) < 1;
        n = tie ? unit([-chord[1], chord[0]]) : away;
      }
    }
    edges.push(drawn);
    edgeLabels.push(labelAt(e.label, anchor, n));
  }

  const initial = model.initial === undefined ? undefined : byId.get(model.initial);
  let start: DiagramDrawing["start"];
  if (model.style === "arcs" && initial) {
    const u = sideVector(hints.start ?? "left");
    const tip = outlineToward(initial, u);
    start = { tail: plus(tip, scaled(u, 40)), tip };
  }
  return framed({ width: 0, height: 0, states, edges, edgeLabels, start });
}

/** Where the start arrow meets the state: the outline point on the given side. */
function outlineToward(state: PlacedPart, u: Point): Point {
  const reach = onOutlineReach(state);
  return [state.x + u[0] * reach, state.y + u[1] * reach];
}

const onOutlineReach = (state: PlacedPart) => {
  const [x0, , x1] = boxOf(state);
  return (x1 - x0) / 2;
};

/** The three corners of an arrowhead. */
export function arrowCorners({ tip, dir }: DrawnEdge["arrow"]): Point[] {
  const base = minus(tip, scaled(dir, ARROW.length));
  const side: Point = [-dir[1], dir[0]];
  return [tip, plus(base, scaled(side, ARROW.half)), minus(base, scaled(side, ARROW.half))];
}

/** The drawing moved by whole grid steps so its ink starts one step in, and sized to hold it. */
function framed(d: DiagramDrawing): DiagramDrawing {
  const xs: number[] = [];
  const ys: number[] = [];
  const add = ([x, y]: Point) => (xs.push(x), ys.push(y));
  for (const s of d.states) {
    const [x0, y0, x1, y1] = boxOf(s);
    add([x0, y0]);
    add([x1, y1]);
    for (const t of [...(s.label ? [s.label] : []), ...(s.notes ?? [])]) {
      const [tx0, ty0, tx1, ty1] = textBox(t);
      add([tx0, ty0]);
      add([tx1, ty1]);
    }
    for (const note of s.notes ?? []) {
      const [bx0, by0, bx1, by1] = actionBox(s, note);
      add([bx0, by0]);
      add([bx1, by1]);
    }
  }
  for (const e of d.edges) {
    dense(e.curve).forEach(add);
    arrowCorners(e.arrow).forEach(add);
    e.bar?.forEach(add);
  }
  for (const t of d.edgeLabels) {
    const [tx0, ty0, tx1, ty1] = textBox(t);
    add([tx0, ty0]);
    add([tx1, ty1]);
  }
  if (d.start) {
    add(d.start.tail);
    add(d.start.tip);
  }
  if (xs.length === 0) return d;
  const dx = MARGIN * GRID - Math.floor(Math.min(...xs) / GRID) * GRID;
  const dy = MARGIN * GRID - Math.floor(Math.min(...ys) / GRID) * GRID;
  return {
    ...shifted(d, dx, dy),
    width: Math.ceil((Math.max(...xs) + dx) / GRID) * GRID + MARGIN * GRID,
    height: Math.ceil((Math.max(...ys) + dy) / GRID) * GRID + MARGIN * GRID,
  };
}

/** The drawing moved by `dx`, `dy`, its size left as it was. */
export function shifted(d: DiagramDrawing, dx: number, dy: number): DiagramDrawing {
  const move = ([x, y]: Point): Point => [x + dx, y + dy];
  const text = (t: Text): Text => ({ ...t, x: t.x + dx, y: t.y + dy });
  return {
    width: d.width,
    height: d.height,
    states: d.states.map((s) => ({
      ...s,
      x: s.x + dx,
      y: s.y + dy,
      ...(s.label ? { label: text(s.label) } : {}),
      ...(s.notes ? { notes: s.notes.map(text) } : {}),
    })),
    edges: d.edges.map((e) => ({
      curve:
        e.curve.kind === "cubic"
          ? { kind: "cubic", points: e.curve.points.map(move) as unknown as [Point, Point, Point, Point] }
          : { kind: "polyline", points: e.curve.points.map(move) },
      arrow: { tip: move(e.arrow.tip), dir: e.arrow.dir },
      ...(e.bar ? { bar: [move(e.bar[0]), move(e.bar[1])] as const } : {}),
    })),
    edgeLabels: d.edgeLabels.map(text),
    ...(d.start ? { start: { tail: move(d.start.tail), tip: move(d.start.tip) } } : {}),
  };
}

// ---- reading a drawing back ---------------------------------------------------------------------

export interface ReadEdge {
  /** The ids of the states whose outlines hold the edge's first point and its arrowhead's tip. */
  from?: string | undefined;
  to?: string | undefined;
  /** The printed label nearest it, when exactly one belongs to it. */
  label?: string | undefined;
}

const at = ([x, y]: Point) => `(${Math.round(x)}, ${Math.round(y)})`;

/**
 * Each drawn edge's ends and label, read from geometry alone: the states whose outlines hold its first
 * point and its tip, and the label nearest it. `problems` lists the ends on no outline and every label
 * that isn't plainly one edge's.
 */
export function readEdges(
  d: DiagramDrawing,
  nameOf: (id: string) => string = (id) => id,
): { edges: ReadEdge[]; problems: string[] } {
  const problems: string[] = [];
  const stateAt = (p: Point) => d.states.find((s) => onOutline(s, p));
  const edges: ReadEdge[] = d.edges.map((e) => {
    const first = e.curve.points[0] as Point;
    const from = stateAt(first);
    const to = stateAt(e.arrow.tip);
    if (!from) problems.push(`an edge starts at ${at(first)}, on no state's outline`);
    if (!to) problems.push(`an edge ends at ${at(e.arrow.tip)}, on no state's outline`);
    return { from: from?.id, to: to?.id };
  });
  const nameOfEdge = (i: number) => {
    const e = edges[i];
    return e?.from !== undefined && e.to !== undefined ? `${nameOf(e.from)} → ${nameOf(e.to)}` : `edge ${i + 1}`;
  };
  const curves = d.edges.map((e) => dense(e.curve));
  const owned: string[][] = d.edges.map(() => []);
  for (const label of d.edgeLabels) {
    const [x0, y0, x1, y1] = textBox(label);
    const centre: Point = [(x0 + x1) / 2, (y0 + y1) / 2];
    const near = curves.map((c, i) => ({ i, gap: distanceToPolyline(centre, c) })).sort((a, b) => a.gap - b.gap);
    const [best, next] = near;
    if (!best) continue;
    if (best.gap > LABEL_REACH) {
      problems.push(`the label "${label.text}" sits ${Math.round(best.gap)}px from every edge`);
      continue;
    }
    if (next && next.gap - best.gap < LABEL_MARGIN) {
      problems.push(
        `the label "${label.text}" sits as near ${nameOfEdge(best.i)} as ${nameOfEdge(next.i)}: a label is nearest its own edge`,
      );
      continue;
    }
    owned[best.i]?.push(label.text);
  }
  owned.forEach((labels, i) => {
    if (labels.length === 0) problems.push(`${nameOfEdge(i)} has no label`);
    else if (labels.length > 1)
      problems.push(`${nameOfEdge(i)} has two labels, ${labels.map((l) => `"${l}"`).join(" and ")}`);
    else if (edges[i]) edges[i].label = labels[0];
  });
  return { edges, problems };
}

/** The model edge each drawn edge is, read from geometry (−1 for none): what the page inks and runs the token on. */
export function modelEdgesOf(d: DiagramDrawing, model: DiagramModel): number[] {
  return readEdges(d).edges.map((r) => model.edges.findIndex((e) => e.from === r.from && e.to === r.to));
}

// ---- the contract's structure check -------------------------------------------------------------

/** Structure and hints (the contract reports them before anything else), each once, in order. */
export function diagramProblems(model: DiagramModel, hints: DiagramHints): string[] {
  const out: string[] = [];
  const once = (message: string) => out.includes(message) || out.push(message);
  const ids = new Set<string>();
  for (const s of model.states) {
    if (ids.has(s.id)) once(`state ${s.id} is listed twice`);
    ids.add(s.id);
  }
  const pairs = new Set<string>();
  for (const e of model.edges) {
    for (const end of [e.from, e.to])
      if (!ids.has(end)) once(`edge ${e.from} → ${e.to} names ${end}, which the model doesn't have`);
    if (pairs.has(edgeKey(e)))
      once(`${e.from} → ${e.to} is listed twice: write one edge per pair, its labels joined by commas`);
    pairs.add(edgeKey(e));
  }
  const loops = new Set(model.edges.filter((e) => e.from === e.to).map((e) => e.from));
  for (const s of model.states) {
    const hint = hints.states[s.id];
    if (!hint) once(`state ${s.id} has no layout hint`);
    else if (loops.has(s.id) && hint.loop === undefined)
      once(`${s.id} has a self-loop, so its hint gives the side the figure draws it on (loop)`);
    else if (!loops.has(s.id) && hint.loop !== undefined)
      once(`${s.id}'s hint gives a self-loop side, but ${s.id} has no self-loop`);
  }
  for (const id of Object.keys(hints.states))
    if (!ids.has(id)) once(`the layout hints place ${id}, which the model doesn't have`);
  const cell = (id: string) => {
    const at = hints.states[id]?.at;
    return at ? ([Math.round(at[0] * PITCH), Math.round(at[1] * PITCH)] as const) : undefined;
  };
  for (const [key, hint] of Object.entries(hints.edges)) {
    const [from, to] = key.split(">") as [string, string];
    if (!pairs.has(key)) {
      once(`the layout hints bend ${key}, which is no edge of the model`);
      continue;
    }
    if (from === to) {
      once(`${key} is a self-loop: its side is ${from}'s loop hint`);
      continue;
    }
    if (model.style === "links") {
      if (hint.bend !== undefined) once(`${key} gives a bend, but a GRAFCET link runs on the grid: give only its bow`);
      continue;
    }
    if (hint.bend !== undefined && hint.bow === undefined)
      once(`${key} gives a bend but no side: a bend says which side it bows to (bow)`);
    const [a, b] = [cell(from), cell(to)];
    if (hint.bow && a && b) {
      if ((hint.bow === "above" || hint.bow === "below") && a[0] === b[0])
        once(`${key} bows ${hint.bow}, but it runs straight up and down: bow it left or right`);
      if ((hint.bow === "left" || hint.bow === "right") && a[1] === b[1])
        once(`${key} bows ${hint.bow}, but it runs straight across: bow it above or below`);
    }
  }
  if (model.style === "arcs" && model.initial !== undefined && !ids.has(model.initial))
    once(`the initial state ${model.initial} isn't in the model`);
  if (model.style === "links" && hints.start !== undefined)
    once("a GRAFCET draws no start arrow: its initial steps are double squares");
  return out;
}
