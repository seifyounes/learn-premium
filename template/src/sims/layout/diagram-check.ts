// The state-diagram gate's checks, pure. A state diagram's drawing passes only if every check passes:
//   drawing ↔ model:  the states, the edges read from the drawn curves alone, the labels, the drawing
//                     conventions, legibility and tidiness;
//   model ↔ figure:   the model's states and edges equal an independent Blind reader's;
//   drawing ↔ figure: the arrangement, each self-loop's side and each bow's side, the symbols (circle,
//                     double circle, square, double square) and the start arrow.
import { z } from "astro/zod";
import { LINED_UP_PX, ORDER_TOLERANCE, type CheckGroup } from "./check.ts";
import { bowOf, pointAt, sample, segmentsCross, sideVector, unit, onOutline, type Curve } from "./curves.ts";
import { actionBox, dense, readEdges, type DiagramDrawing, type DiagramModel, type DiagramState } from "./diagram.ts";
import { textBox, type PlacedPart, type Text } from "./drawing.ts";
import { outlineOf, STATE_DIAGRAM_KINDS, type StateDiagramKind } from "./state-diagram.ts";
import { boxOf, GRID, SIDES, type Point, type Side } from "./symbols.ts";

export const DIAGRAM_READING = "learn-premium diagram reading v1";

const fraction = z.number().min(0).max(1);

/**
 * A Blind reader's account of the Professor's state diagram, written without seeing any builder file.
 * It sits in the Course's build records beside the recompute logs. States are keyed by the name the
 * figure gives them (S3, or a step's number), edges as the figure draws and labels them.
 */
export const diagramReading = z.strictObject({
  reading: z.literal(DIAGRAM_READING),
  /** Who read it, and from what. */
  by: z.string().min(1),
  /** Each state or step by the name the figure gives it. */
  states: z.record(
    z.string(),
    z.strictObject({
      kind: z.enum(STATE_DIAGRAM_KINDS),
      /** The centre as a fraction of the figure's width and height, from its upper corner on the inline start. */
      at: z.tuple([fraction, fraction]),
      /** What the figure prints as its output: a Moore state's bits, a step's actions. */
      output: z.string().min(1).optional(),
      /** The side its self-loop is drawn on. */
      loop: z.enum(SIDES).optional(),
    }),
  ),
  /** Every edge as the figure draws it, with its label as printed, and the side it bows to when the figure bends it. */
  edges: z
    .array(
      z.strictObject({
        from: z.string(),
        to: z.string(),
        label: z.string().min(1),
        bow: z.enum(SIDES).optional(),
      }),
    )
    .min(1),
  /** The state the start arrow points at. */
  start: z.string().optional(),
  /** Anything unreadable or ambiguous. */
  doubts: z.array(z.string()).default([]),
});
export type DiagramReading = z.output<typeof diagramReading>;

export type DiagramCheckId =
  | "parts"
  | "edges"
  | "labels"
  | "conventions"
  | "legibility"
  | "tidiness"
  | "transitions"
  | "arrangement"
  | "bends"
  | "symbols"
  | "start";

export interface DiagramCheck {
  id: DiagramCheckId;
  group: CheckGroup;
  problems: string[];
}

const check = (id: DiagramCheckId, group: CheckGroup, problems: string[]): DiagramCheck => ({
  id,
  group,
  problems: [...new Set(problems)],
});

/** The most bends a link may have. */
const MOST_BENDS = 4;
/** A curve may graze another state's outline this far in before it counts as crossing its body. */
const BODY_SLACK = 2;
const LOOP_DOT = 0.7;

const minus = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1];
const at = ([x, y]: Point) => `(${Math.round(x)}, ${Math.round(y)})`;
const isStep = (kind: StateDiagramKind) => kind === "step" || kind === "step-initial";

/** The side of the compass a vector points to: its dominant axis. */
const compass = ([x, y]: Point): Side =>
  Math.abs(x) >= Math.abs(y) ? (x < 0 ? "left" : "right") : y < 0 ? "above" : "below";

const SHAPES: Record<StateDiagramKind, string> = {
  state: "circle",
  "state-accepting": "double circle",
  step: "square",
  "step-initial": "double square",
};

/** A label as the figure prints it, read however the editor spaced it: `.` and `*` are the AND dot. */
const printed = (text: string) => text.replace(/\s+/g, "").replace(/[.*]/g, "·");

type Box = readonly [number, number, number, number];
const hits = (a: Box, b: Box, margin = 0) =>
  a[0] < b[2] + margin && b[0] < a[2] + margin && a[1] < b[3] + margin && b[1] < a[3] + margin;
const inBox = ([x, y]: Point, [x0, y0, x1, y1]: Box) => x >= x0 && x <= x1 && y >= y0 && y <= y1;

/** Whether `p` lies inside the state's outline shrunk by `slack` px. */
function inside(part: PlacedPart, p: Point, slack: number): boolean {
  const shape = outlineOf(part.kind as StateDiagramKind);
  const d = minus(p, [part.x, part.y]);
  return shape.shape === "circle"
    ? Math.hypot(d[0], d[1]) < shape.r - slack
    : Math.max(Math.abs(d[0]), Math.abs(d[1])) < shape.half - slack;
}

/** A curve as the polyline the crossing test walks: a cubic sampled 32 times, a link by its corners. */
const walk = (curve: Curve): readonly Point[] => (curve.kind === "cubic" ? sample(curve, 32) : curve.points);

export function checkDiagram(
  d: DiagramDrawing,
  model: DiagramModel,
  reading?: DiagramReading,
): { pass: boolean; checks: DiagramCheck[] } {
  const byId = new Map(model.states.map((s) => [s.id, s]));
  const display = (s: DiagramState) => (isStep(s.kind) ? `step ${s.name}` : s.name);
  const nameOfId = (id: string) => {
    const s = byId.get(id);
    return s ? display(s) : id;
  };
  const read = readEdges(d, nameOfId);
  const edgeName = (i: number) => {
    const r = read.edges[i];
    return r?.from !== undefined && r.to !== undefined ? `${nameOfId(r.from)} → ${nameOfId(r.to)}` : `edge ${i + 1}`;
  };

  const checks = [
    check("parts", "drawing ↔ model", partsProblems(d, model, display)),
    check("edges", "drawing ↔ model", edgeProblems(model, read, nameOfId)),
    check("labels", "drawing ↔ model", labelProblems(d, model, display)),
    check("conventions", "drawing ↔ model", conventionProblems(d, model, edgeName, nameOfId)),
    check("legibility", "drawing ↔ model", legibilityProblems(d, model, edgeName, display)),
    check("tidiness", "drawing ↔ model", tidinessProblems(d, edgeName)),
  ];
  if (reading) checks.push(...figureChecks(d, model, reading, read.edges, display, nameOfId));
  return { pass: checks.every((c) => c.problems.length === 0), checks };
}

function partsProblems(d: DiagramDrawing, model: DiagramModel, display: (s: DiagramState) => string): string[] {
  const drawn = new Map(d.states.map((p) => [p.id, p]));
  const modelled = new Set(model.states.map((s) => s.id));
  const out: string[] = [];
  for (const m of model.states) {
    const p = drawn.get(m.id);
    if (!p) out.push(`${display(m)} is in the model but not drawn`);
    else if (p.kind !== m.kind) out.push(`${display(m)} is drawn as a ${p.kind}, the model says ${m.kind}`);
  }
  for (const p of d.states) if (!modelled.has(p.id)) out.push(`${p.id} is drawn but not in the model`);
  return out;
}

function edgeProblems(
  model: DiagramModel,
  read: ReturnType<typeof readEdges>,
  nameOfId: (id: string) => string,
): string[] {
  const out = [...read.problems];
  const drawn = read.edges.filter((r) => r.from !== undefined && r.to !== undefined);
  for (const m of model.edges) {
    const found = drawn.find((r) => r.from === m.from && r.to === m.to);
    const name = `${nameOfId(m.from)} → ${nameOfId(m.to)}`;
    if (!found) out.push(`${name} ("${m.label}") is in the model but not drawn`);
    else if (found.label !== undefined && found.label !== m.label)
      out.push(`${name} is labelled "${found.label}" in the drawing, "${m.label}" in the model`);
  }
  for (const r of drawn) {
    if (model.edges.some((m) => m.from === r.from && m.to === r.to)) continue;
    const name = `${nameOfId(r.from as string)} → ${nameOfId(r.to as string)}`;
    out.push(`${name}${r.label === undefined ? "" : ` ("${r.label}")`} is drawn but not in the model`);
  }
  return out;
}

function labelProblems(d: DiagramDrawing, model: DiagramModel, display: (s: DiagramState) => string): string[] {
  return model.states.flatMap((m) => {
    const p = d.states.find((q) => q.id === m.id);
    if (!p) return [];
    const out: string[] = [];
    if (p.label?.text !== m.label)
      out.push(`${display(m)}'s label is ${p.label ? `"${p.label.text}"` : "missing"}, the model prints "${m.label}"`);
    const want = Object.values(m.notes ?? {}).sort();
    const got = (p.notes ?? []).map((n) => n.text).sort();
    if (want.join("\n") !== got.join("\n"))
      out.push(
        `${m.id} prints ${got.length > 0 ? got.map((t) => `"${t}"`).join(", ") : "no values"}, the model gives ${want.length > 0 ? want.map((t) => `"${t}"`).join(", ") : "none"}`,
      );
    return out;
  });
}

function conventionProblems(
  d: DiagramDrawing,
  model: DiagramModel,
  edgeName: (i: number) => string,
  nameOfId: (id: string) => string,
): string[] {
  const out: string[] = [];
  for (const p of d.states)
    if (p.x % GRID !== 0 || p.y % GRID !== 0) out.push(`state ${p.id} at ${at([p.x, p.y])} is off the ${GRID}px grid`);
  d.edges.forEach((e, i) => {
    const last = e.curve.points[e.curve.points.length - 1] as Point;
    const before = e.curve.points[e.curve.points.length - 2] as Point;
    const heads = unit(minus(last, before));
    if (e.arrow.tip[0] !== last[0] || e.arrow.tip[1] !== last[1] || dot(e.arrow.dir, heads) < 0.9)
      out.push(`${edgeName(i)}'s arrowhead isn't at its end`);
    if (model.style === "links" && e.curve.kind === "polyline") {
      const pts = e.curve.points;
      pts.forEach((p, k) => {
        const q = pts[k - 1];
        if (q && p[0] !== q[0] && p[1] !== q[1]) out.push(`link ${i + 1} has a diagonal segment`);
        if (p[0] % GRID !== 0 || p[1] % GRID !== 0)
          out.push(`link ${i + 1} has a corner off the ${GRID}px grid at ${at(p)}`);
      });
    }
  });
  const initial = model.initial === undefined ? undefined : byIdOf(model, model.initial);
  if (model.style === "links") {
    if (d.start) out.push("a GRAFCET draws no start arrow");
  } else if (initial) {
    if (!d.start) out.push(`the drawing has no start arrow into ${nameOfId(initial.id)}`);
    else {
      const target = d.states.find((s) => onOutline(s, d.start?.tip as Point));
      if (!target) out.push(`the start arrow points at no state, the model starts in ${nameOfId(initial.id)}`);
      else if (target.id !== initial.id)
        out.push(`the start arrow points at ${nameOfId(target.id)}, the model starts in ${nameOfId(initial.id)}`);
    }
  }
  return out;
}

const byIdOf = (model: DiagramModel, id: string) => model.states.find((s) => s.id === id);

function legibilityProblems(
  d: DiagramDrawing,
  model: DiagramModel,
  edgeName: (i: number) => string,
  display: (s: DiagramState) => string,
): string[] {
  const out: string[] = [];
  const nameOf = (p: PlacedPart) => {
    const m = byIdOf(model, p.id);
    return m ? display(m) : p.id;
  };
  const texts: { text: Text; owner?: string }[] = [
    ...d.states.flatMap((s) => [
      ...(s.label ? [{ text: s.label, owner: s.id }] : []),
      ...(s.notes ?? []).map((n) => ({ text: n, owner: s.id })),
    ]),
    ...d.edgeLabels.map((t) => ({ text: t })),
  ];
  texts.forEach((a, i) =>
    texts.slice(i + 1).forEach((b) => {
      if (hits(textBox(a.text), textBox(b.text))) out.push(`"${a.text.text}" overlaps "${b.text.text}"`);
    }),
  );
  // A text, or a step's action box, on another state's body.
  for (const { text, owner } of texts)
    for (const s of d.states)
      if (s.id !== owner && hits(textBox(text), boxOf(s), 1)) out.push(`"${text.text}" sits on ${nameOf(s)}`);
  for (const s of d.states)
    for (const note of s.notes ?? [])
      for (const other of d.states)
        if (other.id !== s.id && hits(actionBox(s, note), boxOf(other), 1))
          out.push(`"${note.text}" sits on ${nameOf(other)}`);
  // Two bodies touching.
  d.states.forEach((a, i) =>
    d.states.slice(i + 1).forEach((b) => {
      if (hits(boxOf(a), boxOf(b), BODY_SLACK)) out.push(`${nameOf(a)} overlaps ${nameOf(b)}`);
    }),
  );
  // An edge through a body, or over a text.
  d.edges.forEach((e, i) => {
    const pts = dense(e.curve);
    for (const s of d.states) {
      const own = onOutline(s, e.curve.points[0] as Point) || onOutline(s, e.arrow.tip);
      const crossed = pts.some((p, k) => (own ? k > 0 && k < pts.length - 1 : true) && inside(s, p, BODY_SLACK));
      if (crossed) out.push(`${edgeName(i)} crosses the body of ${nameOf(s)}`);
    }
    for (const { text } of texts) {
      const box = textBox(text);
      if (pts.some((p) => inBox(p, box))) out.push(`${edgeName(i)} runs over "${text.text}"`);
    }
  });
  return out;
}

function tidinessProblems(d: DiagramDrawing, edgeName: (i: number) => string): string[] {
  const out: string[] = [];
  const walks = d.edges.map((e) => walk(e.curve));
  walks.forEach((a, i) =>
    walks.slice(i + 1).forEach((b, k) => {
      const j = i + 1 + k;
      const crosses = a.some(
        (p, m) => m > 0 && b.some((q, n) => n > 0 && segmentsCross(a[m - 1] as Point, p, b[n - 1] as Point, q)),
      );
      if (crosses) out.push(`${edgeName(i)} and ${edgeName(j)} cross`);
    }),
  );
  d.edges.forEach((e, i) => {
    if (e.curve.kind !== "polyline") return;
    const pts = e.curve.points;
    let bends = 0;
    for (let k = 2; k < pts.length; k++) {
      const [a, b, c] = [pts[k - 2], pts[k - 1], pts[k]] as [Point, Point, Point];
      if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) !== 0) bends += 1;
    }
    if (bends > MOST_BENDS) out.push(`link ${i + 1} bends ${bends} times, more than ${MOST_BENDS}`);
  });
  return out;
}

function figureChecks(
  d: DiagramDrawing,
  model: DiagramModel,
  reading: DiagramReading,
  edges: ReturnType<typeof readEdges>["edges"],
  display: (s: DiagramState) => string,
  nameOfId: (id: string) => string,
): DiagramCheck[] {
  const byName = new Map(model.states.map((s) => [s.name, s]));
  const drawnById = new Map(d.states.map((s) => [s.id, s]));
  const shown = (name: string) => {
    const m = byName.get(name);
    if (m) return display(m);
    const kind = reading.states[name]?.kind;
    return kind && isStep(kind) ? `step ${name}` : name;
  };

  // model ↔ figure
  const transitions: string[] = [];
  for (const [name, r] of Object.entries(reading.states)) {
    const m = byName.get(name);
    if (!m) {
      transitions.push(`the figure's ${shown(name)} has no state in the model`);
      continue;
    }
    if (m.kind !== r.kind) transitions.push(`the model makes ${display(m)} a ${m.kind}, the figure draws a ${r.kind}`);
    if (m.output !== undefined && r.output === undefined)
      transitions.push(`the figure reading records no output for ${display(m)}, the model prints "${m.output}"`);
    else if (m.output !== undefined && r.output !== undefined && printed(m.output) !== printed(r.output))
      transitions.push(`${display(m)}'s output is "${m.output}" in the model, the figure prints "${r.output}"`);
    else if (m.output === undefined && r.output !== undefined)
      transitions.push(`the figure prints ${display(m)}'s output "${r.output}", the model gives none`);
  }
  for (const m of model.states)
    if (!(m.name in reading.states)) transitions.push(`${display(m)} is in the model but not in the figure`);
  const idName = (id: string) => byIdOf(model, id)?.name ?? id;
  for (const r of reading.edges)
    if (!model.edges.some((m) => idName(m.from) === r.from && idName(m.to) === r.to))
      transitions.push(`${shown(r.from)} → ${shown(r.to)} ("${r.label}") is in the figure but not in the model`);
  for (const m of model.edges) {
    const r = reading.edges.find((q) => q.from === idName(m.from) && q.to === idName(m.to));
    const name = `${nameOfId(m.from)} → ${nameOfId(m.to)}`;
    if (!r) transitions.push(`${name} ("${m.label}") is in the model but not in the figure`);
    else if (printed(r.label) !== printed(m.label))
      transitions.push(`${name} is labelled "${m.label}" in the model, "${r.label}" in the figure`);
  }
  const initial = model.initial === undefined ? undefined : byIdOf(model, model.initial);
  if (initial && reading.start !== undefined && reading.start !== initial.name)
    transitions.push(
      `the model starts in ${display(initial)}, the figure's start arrow points at ${shown(reading.start)}`,
    );

  // drawing ↔ figure
  const placed = [...byName].flatMap(([name, m]) => {
    const part = drawnById.get(m.id);
    const read = reading.states[name];
    return part && read ? [{ m, part, read }] : [];
  });
  const arrangement: string[] = [];
  placed.forEach((a, i) =>
    placed.slice(i + 1).forEach((b) => {
      for (const [axis, before, after] of [
        [0, "left of", "right of"],
        [1, "above", "below"],
      ] as const) {
        const figure = b.read.at[axis] - a.read.at[axis];
        if (Math.abs(figure) < ORDER_TOLERANCE) continue;
        const drawn = axis === 0 ? b.part.x - a.part.x : b.part.y - a.part.y;
        const reversed = Math.abs(drawn) >= LINED_UP_PX && Math.sign(drawn) !== Math.sign(figure);
        const flattened = Math.abs(drawn) < LINED_UP_PX && Math.abs(figure) >= 2 * ORDER_TOLERANCE;
        if (reversed || flattened)
          arrangement.push(`${display(a.m)} should be ${figure > 0 ? before : after} ${display(b.m)}`);
      }
    }),
  );

  const bends: string[] = [];
  const drawnLoops = new Set<string>();
  d.edges.forEach((e, i) => {
    const r = edges[i];
    if (r?.from === undefined || r.to === undefined) return;
    const from = byIdOf(model, r.from);
    const to = byIdOf(model, r.to);
    const part = drawnById.get(r.from);
    if (!from || !to || !part) return;
    if (r.from === r.to) {
      drawnLoops.add(from.name);
      const v = minus(pointAt(e.curve, 0.5), [part.x, part.y]);
      const figure = reading.states[from.name]?.loop;
      if (figure === undefined)
        bends.push(`${display(from)}'s self-loop is drawn ${compass(v)} it, the figure draws none`);
      else if (dot(unit(v), sideVector(figure)) <= LOOP_DOT)
        bends.push(`${display(from)}'s self-loop is drawn ${compass(v)} it, the figure draws it ${figure}`);
      return;
    }
    const figure = reading.edges.find((q) => q.from === from.name && q.to === to.name);
    if (!figure) return;
    // A GRAFCET link bows only when it runs back up: the others run on the grid.
    const returning = model.style === "arcs" || e.arrow.tip[1] <= (e.curve.points[0] as Point)[1];
    if (!returning) return;
    const bow = bowOf(e.curve);
    const name = `${display(from)} → ${display(to)}`;
    if (bow && figure.bow) {
      if (dot(bow, sideVector(figure.bow)) <= 0)
        bends.push(`${name} bows ${compass(bow)} in the drawing, ${figure.bow} in the figure`);
    } else if (bow) bends.push(`${name} is drawn bowed, the figure draws it straight`);
    else if (figure.bow) bends.push(`the figure bows ${name} ${figure.bow}, the drawing draws it straight`);
  });
  for (const [name, r] of Object.entries(reading.states))
    if (r.loop !== undefined && !drawnLoops.has(name))
      bends.push(`the figure draws a self-loop on ${shown(name)}, the drawing has none`);

  const symbols = placed.flatMap(({ m, part, read }) =>
    SHAPES[part.kind as StateDiagramKind] === SHAPES[read.kind]
      ? []
      : [
          `${display(m)} is drawn as a ${SHAPES[part.kind as StateDiagramKind]}, the figure draws a ${SHAPES[read.kind]}`,
        ],
  );

  const start: string[] = [];
  const target = d.start && d.states.find((s) => onOutline(s, d.start?.tip as Point));
  const drawnInto = target ? nameOfId(target.id) : "no state";
  if (reading.start !== undefined && d.start) {
    if (!target || idName(target.id) !== reading.start)
      start.push(`the start arrow is drawn into ${drawnInto}, the figure's points at ${shown(reading.start)}`);
  } else if (reading.start === undefined && d.start)
    start.push(`the figure has no start arrow, the drawing draws one into ${drawnInto}`);
  else if (reading.start !== undefined && !d.start)
    start.push(`the figure's start arrow points at ${shown(reading.start)}, the drawing draws none`);

  return [
    check("transitions", "model ↔ figure", transitions),
    check("arrangement", "drawing ↔ figure", arrangement),
    check("bends", "drawing ↔ figure", bends),
    check("symbols", "drawing ↔ figure", symbols),
    check("start", "drawing ↔ figure", start),
  ];
}
