// The Drawing gate's checks, pure. A schematic sim's drawing passes only if every check passes:
//   drawing ↔ model:  the parts, the connectivity read from geometry alone, the labels, the
//                     drawing conventions, legibility and tidiness;
//   model ↔ figure:   the model's nets equal an independent Blind reader's;
//   drawing ↔ figure: the arrangement, each part's turn, each label's side, the unlabelled
//                     symbols, and the junction dots, which copy the figure.
import { z } from "astro/zod";
import { splitPin, textBox, type Drawing, type PlacedPart, type SchematicModel, type Text } from "./drawing.ts";
import {
  connectivity,
  drawnPins,
  endsOf,
  modelNets,
  onSegment,
  onWire,
  samePoint,
  segmentsOf,
  type DrawnPin,
} from "./geometry.ts";
import {
  boxOf,
  GRID,
  orient,
  SIDES,
  SYMBOL_KINDS,
  symbolOf,
  TURNS,
  type Point,
  type Side,
  type SymbolKind,
  type Turn,
} from "./symbols.ts";

export const FIGURE_READING = "learn-premium figure reading v1";

/** A part's turn, as the figure and the Layout hints both write it. */
export const turnSchema = z.union(TURNS.map((t) => z.literal(t)) as [z.ZodLiteral<Turn>, ...z.ZodLiteral<Turn>[]]);

const fraction = z.number().min(0).max(1);
/**
 * A Blind reader's account of the Professor's figure, written without seeing any builder file. It
 * sits in the Course's build records beside the recompute logs. Parts are keyed by the label the
 * figure prints; every ground pin is `GND.g` and every rail pin `RAIL.t`, since unlabelled symbols
 * can't be keyed, and an unlabelled kind with a `figureKey` (a summing junction) is keyed by it.
 */
export const figureReading = z.strictObject({
  reading: z.literal(FIGURE_READING),
  /** Who read it, and from what. */
  by: z.string().min(1),
  parts: z.record(
    z.string(),
    z.strictObject({
      kind: z.enum(SYMBOL_KINDS as [SymbolKind, ...SymbolKind[]]),
      /** The body's centre as a fraction of the figure's width and height, measured from its upper corner on the inline start. */
      at: z.tuple([fraction, fraction]),
      turn: turnSchema,
      flip: z.boolean().default(false),
      /** The side its label is printed on. */
      label: z.enum(SIDES).optional(),
    }),
  ),
  /** Symbols the figure doesn't label, counted by kind (grounds, rails). */
  unlabelled: z
    .partialRecord(z.enum(SYMBOL_KINDS as [SymbolKind, ...SymbolKind[]]), z.number().int().nonnegative())
    .default({}),
  nets: z
    .array(
      z.strictObject({
        pins: z.array(z.string().min(1)).min(1),
        /** Whether the figure dots this net's joints. A T connects either way. */
        dotted: z.boolean().default(false),
      }),
    )
    .min(1),
  /** Anything unreadable or ambiguous. */
  doubts: z.array(z.string()).default([]),
});
export type FigureReading = z.output<typeof figureReading>;

export const CHECK_GROUPS = ["drawing ↔ model", "model ↔ figure", "drawing ↔ figure"] as const;
export type CheckGroup = (typeof CHECK_GROUPS)[number];

export type CheckId =
  | "parts"
  | "connectivity"
  | "labels"
  | "conventions"
  | "legibility"
  | "tidiness"
  | "netlist"
  | "arrangement"
  | "turn"
  | "label side"
  | "symbols"
  | "dots";

export interface Check {
  id: CheckId;
  group: CheckGroup;
  problems: string[];
}

export interface DrawingVerdict {
  pass: boolean;
  checks: Check[];
}

const check = (id: CheckId, group: CheckGroup, problems: string[]): Check => ({
  id,
  group,
  problems: [...new Set(problems)],
});

/** The smallest gap tidy wiring leaves: one grid step. */
const MIN_JOG = GRID;
const MOST_BENDS = 4;

export function checkDrawing(d: Drawing, model: SchematicModel, reading?: FigureReading): DrawingVerdict {
  const conn = connectivity(d);
  const pins = drawnPins(d);
  const checks = [
    check("parts", "drawing ↔ model", partsProblems(d, model)),
    check("connectivity", "drawing ↔ model", connectivityProblems(d, model, conn)),
    check("labels", "drawing ↔ model", labelProblems(d, model)),
    check("conventions", "drawing ↔ model", conventionProblems(d, pins, conn.joints)),
    check("legibility", "drawing ↔ model", legibilityProblems(d)),
    check("tidiness", "drawing ↔ model", tidinessProblems(d)),
  ];
  if (reading) checks.push(...figureChecks(d, model, reading, conn.joints));
  return { pass: checks.every((c) => c.problems.length === 0), checks };
}

function partsProblems(d: Drawing, model: SchematicModel): string[] {
  const drawn = new Map(d.parts.map((p) => [p.id, p]));
  const modelled = new Map(model.parts.map((p) => [p.id, p]));
  return [
    ...model.parts.filter((p) => !drawn.has(p.id)).map((p) => `${p.id} is in the model but not drawn`),
    ...d.parts.filter((p) => !modelled.has(p.id)).map((p) => `${p.id} is drawn but not in the model`),
    ...d.parts.flatMap((p) => {
      const m = modelled.get(p.id);
      return m && m.kind !== p.kind ? [`${p.id} is drawn as a ${p.kind}, the model says ${m.kind}`] : [];
    }),
  ];
}

function connectivityProblems(d: Drawing, model: SchematicModel, conn: ReturnType<typeof connectivity>): string[] {
  const drawnIds = new Set(d.parts.map((p) => p.id));
  const byId = new Map(model.parts.map((p) => [p.id, p]));
  const want = modelNets(model, model.nets).map((n) => n.filter((k) => drawnIds.has(splitPin(k)[0])));
  const isImplicit = (k: string) => {
    const part = byId.get(splitPin(k)[0]);
    return part !== undefined && symbolOf(part.kind).implicit !== undefined;
  };
  // A pin alone in its net (an unused input the figure leaves open) needs no wire.
  const wired = new Set(want.filter((n) => n.length > 1).flat());
  return [
    ...d.unrouted.map((k) => `the router couldn't reach ${k}`),
    ...[...wired].filter((k) => !conn.reached.has(k) && !isImplicit(k)).map((k) => `${k} has no wire`),
    ...diffPartitions(want, conn.nets, DRAWN),
  ];
}

/** How a difference between two netlists reads: a pair one joins and the other doesn't. */
interface Phrasing {
  missing: (a: string, b: string) => string;
  extra: (a: string, b: string) => string;
}
const DRAWN: Phrasing = {
  missing: (a, b) => `${a} and ${b} should connect but aren't drawn connected`,
  extra: (a, b) => `${a} and ${b} are drawn connected but shouldn't be`,
};
const AGAINST_FIGURE: Phrasing = {
  missing: (a, b) => `${a} and ${b} connect in the figure but not in the model`,
  extra: (a, b) => `${a} and ${b} connect in the model but not in the figure`,
};

/** Pairs that `want` connects but `got` doesn't, and the other way round. */
function diffPartitions(want: string[][], got: string[][], say: Phrasing): string[] {
  const where = (nets: string[][]) => new Map(nets.flatMap((n, i) => n.map((k) => [k, i] as const)));
  const w = where(want);
  const g = where(got);
  const out: string[] = [];
  for (const n of want) {
    const [first, ...rest] = n;
    for (const k of rest) if (first !== undefined && g.get(k) !== g.get(first)) out.push(say.missing(first, k));
  }
  for (const n of got) {
    const [first, ...rest] = n;
    for (const k of rest) {
      if (first === undefined || !w.has(k) || !w.has(first)) continue;
      if (w.get(k) !== w.get(first)) out.push(say.extra(first, k));
    }
  }
  return out;
}

function labelProblems(d: Drawing, model: SchematicModel): string[] {
  return model.parts.flatMap((m) => {
    const p = d.parts.find((q) => q.id === m.id);
    if (!p || m.label === undefined || p.label?.text === m.label) return [];
    return [`${m.id}'s label is ${p.label ? `"${p.label.text}"` : "missing"}, the model says "${m.label}"`];
  });
}

const onGrid = ([x, y]: Point) => x % GRID === 0 && y % GRID === 0;
const at = ([x, y]: Point) => `(${x}, ${y})`;

function conventionProblems(d: Drawing, pins: DrawnPin[], joints: { at: Point }[]): string[] {
  const out: string[] = [];
  for (const pin of pins) if (!onGrid(pin.at)) out.push(`pin ${pin.key} at ${at(pin.at)} is off the 20px grid`);
  d.wires.forEach((w, i) => {
    w.points.filter((p) => !onGrid(p)).forEach((p) => out.push(`wire ${i} has a corner off the 20px grid at ${at(p)}`));
    segmentsOf(w).forEach(([a, b]) => {
      if (a[0] !== b[0] && a[1] !== b[1]) out.push(`wire ${i} has a diagonal segment`);
    });
    for (const pin of pins) {
      if (!w.points.some((q) => samePoint(q, pin.at)) && onWire(pin.at, w))
        out.push(`wire ${i} runs over pin ${pin.key} without ending there`);
    }
    for (const end of endsOf(w)) {
      const onPin = pins.some((p) => samePoint(p.at, end));
      const onOther = d.wires.some((v, j) => j !== i && onWire(end, v));
      if (!onPin && !onOther) out.push(`wire ${i} ends in the open at ${at(end)}`);
    }
  });
  // Two wires along the same stretch, or a wire's corner lying inside another wire.
  const all = d.wires.flatMap((w, i) => segmentsOf(w).map((s) => ({ i, s })));
  all.forEach((A, x) =>
    all.slice(x + 1).forEach((B) => {
      if (A.i === B.i) return;
      if (overlapLength(A.s, B.s) > 0) out.push(`wire ${A.i} runs along wire ${B.i}`);
    }),
  );
  d.wires.forEach((w, i) =>
    w.points.slice(1, -1).forEach((corner) => {
      d.wires.forEach((v, j) => {
        if (
          j !== i &&
          segmentsOf(v).some(([a, b]) => onSegment(corner, [a, b]) && !samePoint(corner, a) && !samePoint(corner, b))
        )
          out.push(`wire ${i} turns on wire ${j} at ${at(corner)}`);
      });
    }),
  );
  for (const dot of d.dots) {
    if (!joints.some((j) => samePoint(j.at, dot))) {
      const crossing = d.wires.filter((w) => onWire(dot, w)).length >= 2;
      out.push(`a dot at ${at(dot)} marks ${crossing ? "a crossing, which never connects" : "no joint"}`);
    }
  }
  return out;
}

/** How far two collinear orthogonal segments run along each other, in px (0 when they don't). */
function overlapLength([a, b]: [Point, Point], [c, e]: [Point, Point]): number {
  const h1 = a[1] === b[1];
  const h2 = c[1] === e[1];
  if (h1 !== h2) return 0;
  if (h1 ? a[1] !== c[1] : a[0] !== c[0]) return 0;
  const axis = h1 ? 0 : 1;
  const lo = Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], e[axis]));
  const hi = Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], e[axis]));
  return hi - lo;
}

type Box = [number, number, number, number];
const boxesHit = (a: Box, b: Box, margin = 0) =>
  a[0] < b[2] + margin && b[0] < a[2] + margin && a[1] < b[3] + margin && b[1] < a[3] + margin;
const shrink = ([x0, y0, x1, y1]: Box, m: number): Box => [x0 + m, y0 + m, x1 - m, y1 - m];
/** Whether an orthogonal segment passes through a box's inside (touching its edge doesn't count). */
function segmentHitsBox([a, b]: [Point, Point], [x0, y0, x1, y1]: Box): boolean {
  const [sx0, sx1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
  const [sy0, sy1] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
  if (sx0 === sx1) return sx0 > x0 && sx0 < x1 && sy0 < y1 && sy1 > y0;
  return sy0 > y0 && sy0 < y1 && sx0 < x1 && sx1 > x0;
}

function legibilityProblems(d: Drawing): string[] {
  const out: string[] = [];
  const labels = d.parts.flatMap((p) => (p.label ? [{ text: p.label, owner: p.id }] : []));
  const bodies = d.parts.map((p) => ({ id: p.id, part: p, box: boxOf(p) as Box }));
  for (const { text, owner } of labels) {
    const tb = textBox(text);
    for (const b of bodies) if (b.id !== owner && boxesHit(tb, b.box, 1)) out.push(`"${text.text}" sits on ${b.id}`);
    d.wires.forEach((w, i) => {
      if (segmentsOf(w).some((s) => segmentHitsBox(s, tb))) out.push(`"${text.text}" sits on wire ${i}`);
    });
  }
  labels.forEach((a, i) =>
    labels.slice(i + 1).forEach((b) => {
      if (boxesHit(textBox(a.text), textBox(b.text))) out.push(`"${a.text.text}" overlaps "${b.text.text}"`);
    }),
  );
  bodies.forEach((a, i) =>
    bodies.slice(i + 1).forEach((b) => {
      if (boxesHit(a.box, b.box, 2)) out.push(`${a.id} overlaps ${b.id}`);
    }),
  );
  d.wires.forEach((w, i) =>
    segmentsOf(w).forEach((s) =>
      bodies.forEach((b) => {
        // A terminal's own wire ends inside its circle.
        const own =
          Object.values(symbolOf(b.part.kind).pins).some((p) => !p.lead) &&
          endsOf(w).some((e) => samePoint(e, [b.part.x, b.part.y]));
        if (!own && segmentHitsBox(s, shrink(b.box, 2))) out.push(`wire ${i} crosses the body of ${b.id}`);
      }),
    ),
  );
  return out;
}

/** A figure's wiring is calm: no jog under a grid step, few bends, no wires squeezed together. */
function tidinessProblems(d: Drawing): string[] {
  const out: string[] = [];
  const length = ([a, b]: [Point, Point]) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
  d.wires.forEach((w, i) => {
    const segs = segmentsOf(w);
    const jogs = segs.filter((s, j) => j > 0 && j < segs.length - 1 && length(s) < MIN_JOG).length;
    if (jogs > 0) out.push(`wire ${i} has ${jogs === 1 ? "a jog" : `${jogs} jogs`} under ${MIN_JOG}px`);
    if (segs.length - 1 > MOST_BENDS) out.push(`wire ${i} bends ${segs.length - 1} times, more than ${MOST_BENDS}`);
  });
  const all = d.wires.flatMap((w, i) => segmentsOf(w).map((s) => ({ i, s })));
  all.forEach((A, x) =>
    all.slice(x + 1).forEach((B) => {
      if (A.i === B.i) return;
      const [[a, b], [c, e]] = [A.s, B.s];
      const hA = a[1] === b[1];
      if (hA !== (c[1] === e[1])) return;
      const gap = hA ? Math.abs(a[1] - c[1]) : Math.abs(a[0] - c[0]);
      if (gap === 0 || gap >= MIN_JOG) return;
      const axis = hA ? 0 : 1;
      const lo = Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], e[axis]));
      const hi = Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], e[axis]));
      if (hi > lo) out.push(`wires ${A.i} and ${B.i} run ${gap}px apart`);
    }),
  );
  return out;
}

// ---------- against the figure ----------

/** The reading's key for each model part: its printed label, or its id when the figure prints that. */
function readingKeys(model: SchematicModel, reading: FigureReading): Map<string, string> {
  const byKey = new Map<string, string>();
  for (const key of Object.keys(reading.parts)) {
    const hit = model.parts.find((p) => p.id === key || p.label === key);
    if (hit) byKey.set(key, hit.id);
  }
  return byKey;
}

/** How a part is told apart from its turned or mirrored self (see `SymbolDef.orientation`). */
function orientationKey(kind: SymbolKind, turn: Turn, flip: boolean): string {
  const o = symbolOf(kind).orientation;
  const compass = ([x, y]: Point) =>
    Math.abs(x) >= Math.abs(y) ? (x < 0 ? "pointing left" : "pointing right") : y < 0 ? "pointing up" : "pointing down";
  switch (o.by) {
    case "any":
      return "any";
    case "axis": {
      const [x] = orient({ turn, flip }, [1, 0]);
      return x === 0 ? "vertical" : "horizontal";
    }
    case "pin":
      return compass(orient({ turn, flip }, symbolOf(kind).pins[o.pin]?.at ?? [1, 0]));
    case "full":
      return `turned ${turn}${flip ? ", mirrored" : ""}`;
  }
}

function sideOf(part: PlacedPart, t: Text): Side {
  const [x0, y0, x1, y1] = textBox(t);
  const dx = (x0 + x1) / 2 - part.x;
  const dy = (y0 + y1) / 2 - part.y;
  return Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? "left" : "right") : dy < 0 ? "above" : "below";
}

/** The figure must separate a pair by this fraction for their order to count. */
const ORDER_TOLERANCE = 0.04;
/** Drawn closer than this (px), a pair counts as lined up. */
const LINED_UP_PX = 10;

function figureChecks(
  d: Drawing,
  model: SchematicModel,
  reading: FigureReading,
  joints: { at: Point; net: string[] }[],
): Check[] {
  const keys = readingKeys(model, reading);
  const byId = new Map(d.parts.map((p) => [p.id, p]));
  const kindOf = new Map(model.parts.map((p) => [p.id, p.kind]));
  const keyOf = new Map([...keys].map(([k, id]) => [id, k]));
  const canon = (pinKey: string) => {
    const [id, pin] = splitPin(pinKey);
    const kind = kindOf.get(id);
    if (kind === "ground") return "GND.g";
    if (kind === "rail") return "RAIL.t";
    const figureKey = kind && symbolOf(kind).figureKey;
    if (figureKey && !keyOf.has(id)) return `${figureKey}.${pin}`;
    return `${keyOf.get(id) ?? `?${id}`}.${pin}`;
  };

  // model ↔ figure: the nets, a swappable pair's wires allowed to swap where that fits the figure.
  const modelled = modelNets(model, model.nets).map((n) => [...new Set(n.map(canon))]);
  let figured = reading.nets.map((n) => n.pins);
  const cost = (nets: string[][]) => diffPartitions(nets, modelled, AGAINST_FIGURE).length;
  for (const part of model.parts) {
    const pair = symbolOf(part.kind).swappable;
    const key = keyOf.get(part.id);
    if (!pair || key === undefined) continue;
    const [a, b] = pair.map((p) => `${key}.${p}`) as [string, string];
    const swapped = figured.map((n) => n.map((k) => (k === a ? b : k === b ? a : k)));
    if (cost(swapped) < cost(figured)) figured = swapped;
  }
  const unread = Object.keys(reading.parts).filter((k) => !keys.has(k));
  const unshown = model.parts.filter((p) => p.label !== undefined && !keyOf.has(p.id));
  const netlist = check("netlist", "model ↔ figure", [
    ...unread.map((k) => `the figure's ${k} has no part in the model`),
    ...unshown.map((p) => `${p.id} is in the model but not in the figure`),
    ...diffPartitions(figured, modelled, AGAINST_FIGURE),
  ]);

  // drawing ↔ figure
  const placed = [...keys].flatMap(([key, id]) => {
    const part = byId.get(id);
    const read = reading.parts[key];
    return part && read ? [{ key, part, read }] : [];
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
        // Opposite order always fails; lining a pair up fails only when the figure clearly parts them.
        const reversed = Math.abs(drawn) >= LINED_UP_PX && Math.sign(drawn) !== Math.sign(figure);
        const flattened = Math.abs(drawn) < LINED_UP_PX && Math.abs(figure) >= 2 * ORDER_TOLERANCE;
        if (reversed || flattened) arrangement.push(`${a.key} should be ${figure > 0 ? before : after} ${b.key}`);
      }
    }),
  );
  const turn = placed.flatMap(({ key, part, read }) => {
    const want = orientationKey(part.kind, read.turn, read.flip);
    const got = orientationKey(part.kind, part.turn, part.flip);
    return want === got ? [] : [`${key} is drawn ${got}, the figure has it ${want}`];
  });
  const labelSide = placed.flatMap(({ key, part, read }) => {
    if (!read.label || !part.label) return [];
    const side = sideOf(part, part.label);
    return side === read.label ? [] : [`${key}'s label is drawn ${side} it, the figure prints it ${read.label}`];
  });
  const count = (kind: SymbolKind) => d.parts.filter((p) => p.kind === kind).length;
  const symbols = Object.entries(reading.unlabelled).flatMap(([kind, n]) =>
    count(kind as SymbolKind) === n ? [] : [`${count(kind as SymbolKind)} ${kind} symbols drawn, the figure has ${n}`],
  );
  // Junction dots copy the figure: each joint is dotted exactly when the figure dots its net.
  const dotted = (net: string[]) => {
    const keysOnNet = new Set(net.map(canon));
    const index = figured.findIndex((n) => n.some((k) => k !== "GND.g" && k !== "RAIL.t" && keysOnNet.has(k)));
    return index < 0 ? undefined : (reading.nets[index]?.dotted ?? false);
  };
  const dots = joints.flatMap((j) => {
    const want = dotted(j.net);
    const has = d.dots.some((dot) => samePoint(dot, j.at));
    if (want === undefined || want === has) return [];
    return [
      `the joint at ${at(j.at)} is ${has ? "dotted" : "undotted"}, the figure ${want ? "dots" : "doesn't dot"} that net`,
    ];
  });

  return [
    netlist,
    check("arrangement", "drawing ↔ figure", arrangement),
    check("turn", "drawing ↔ figure", turn),
    check("label side", "drawing ↔ figure", labelSide),
    check("symbols", "drawing ↔ figure", symbols),
    check("dots", "drawing ↔ figure", dots),
  ];
}
