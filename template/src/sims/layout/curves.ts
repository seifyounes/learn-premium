// The curve drawer: the state diagram's edges, which the router (orthogonal wires between pins)
// can't draw. Cubic arcs between two circles, self-loops on the side the figure draws them, and
// GRAFCET's orthogonal links with their transition bars. Pure geometry; every edge ends in an
// arrowhead and carries no ids or state names, so the check reads its ends from geometry alone.
import { outlineOf, type StateDiagramKind } from "./state-diagram.ts";
import { GRID, type Placement, type Point, type Side } from "./symbols.ts";

export type Curve =
  { kind: "cubic"; points: readonly [Point, Point, Point, Point] } | { kind: "polyline"; points: readonly Point[] };

/** A drawn edge: no ids and no state names, so the check reads its ends from geometry alone. */
export interface DrawnEdge {
  curve: Curve;
  /** The arrowhead at the curve's last point: `tip` is that point, `dir` the unit vector it points along. */
  arrow: { tip: Point; dir: Point };
  /** A GRAFCET transition's bar across its link. */
  bar?: readonly [Point, Point] | undefined;
}

/** Coarse steps: the sagitta of each arc of an opposed pair. */
export const DEFAULT_BEND = 0.3;
/** Px between an edge and its label's box. */
export const LABEL_GAP = 6;
/** A curve whose farthest point is this close to its chord is straight. */
export const STRAIGHT_PX = 4;
export const ARROW = { length: 10, half: 4 } as const;
/** A self-loop: degrees either side of its side where it meets the state, and how far its controls reach, × r. */
export const LOOP = { ends: 22, controls: 40, reach: 2.8 } as const;

/** One coarse step of the hints is this many px (`place.ts`'s PITCH); a link's jog is a fifth of it. */
const LINK_JOG = GRID;
const LINK_RUN = 2 * GRID;

const centreOf = (part: Placement): Point => [part.x, part.y];
const outline = (part: Placement) => outlineOf(part.kind as StateDiagramKind);
const plus = (a: Point, b: Point): Point => [a[0] + b[0], a[1] + b[1]];
const minus = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const scaled = (a: Point, k: number): Point => [a[0] * k, a[1] * k];
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1];
const norm = (a: Point) => Math.hypot(a[0], a[1]);
const lerp = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** The unit vector a side points along: above (0, −1), below (0, 1), left (−1, 0), right (1, 0). */
export function sideVector(side: Side): Point {
  switch (side) {
    case "left":
      return [-1, 0];
    case "right":
      return [1, 0];
    case "above":
      return [0, -1];
    case "below":
      return [0, 1];
  }
}

export function unit(v: Point): Point {
  const n = norm(v);
  return n === 0 ? [0, 0] : [v[0] / n, v[1] / n];
}

/** `v` turned clockwise on screen (y down) for positive degrees. */
export function rotate(v: Point, degrees: number): Point {
  const a = (degrees * Math.PI) / 180;
  return [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a)];
}

/** Where the ray from the part's centre toward `toward` leaves its outline. */
export function outlinePoint(part: Placement, toward: Point): Point {
  const c = centreOf(part);
  const d = minus(toward, c);
  const shape = outline(part);
  if (shape.shape === "circle") return plus(c, scaled(unit(d), shape.r));
  const reach = Math.max(Math.abs(d[0]), Math.abs(d[1]));
  return reach === 0 ? c : plus(c, scaled(d, shape.half / reach));
}

/** Whether `p` lies on the part's outline, within `tolerance` px (default 1). */
export function onOutline(part: Placement, p: Point, tolerance = 1): boolean {
  const d = minus(p, centreOf(part));
  const shape = outline(part);
  if (shape.shape === "circle") return Math.abs(norm(d) - shape.r) <= tolerance;
  const reach = Math.max(Math.abs(d[0]), Math.abs(d[1]));
  return Math.abs(reach - shape.half) <= tolerance;
}

/** The radius the outline reaches at most: a circle's r, a square's half side. */
const reachOf = (part: Placement) => {
  const shape = outline(part);
  return shape.shape === "circle" ? shape.r : shape.half;
};

const finishing = (curve: Curve): DrawnEdge => {
  const pts = curve.points;
  const tip = pts[pts.length - 1] as Point;
  const before = pts[pts.length - 2] as Point;
  return { curve, arrow: { tip, dir: unit(minus(tip, before)) } };
};

/**
 * An arc between two different states. `sagitta` is how far it bows at the middle (a vector from the
 * midpoint of the centres); `[0, 0]` draws it straight. The curve leaves one outline and arrives on
 * the other, its arrowhead into the target.
 */
export function arc(from: Placement, to: Placement, sagitta: Point): DrawnEdge {
  const m = lerp(centreOf(from), centreOf(to), 0.5);
  const q = plus(m, scaled(sagitta, 2));
  const p0 = outlinePoint(from, q);
  const p3 = outlinePoint(to, q);
  const p1 = plus(p0, scaled(minus(q, p0), 2 / 3));
  const p2 = plus(p3, scaled(minus(q, p3), 2 / 3));
  return finishing({ kind: "cubic", points: [p0, p1, p2, p3] });
}

/** A self-loop on the given side of the state: it leaves and re-enters its outline, its arrowhead into the state. */
export function selfLoop(state: Placement, side: Side): DrawnEdge {
  const u = sideVector(side);
  const c = centreOf(state);
  const r = reachOf(state);
  const away = (degrees: number, k: number): Point => plus(c, scaled(rotate(u, degrees), k));
  const p0 = outlinePoint(state, away(-LOOP.ends, 100));
  const p3 = outlinePoint(state, away(LOOP.ends, 100));
  const p1 = away(-LOOP.controls, LOOP.reach * r);
  const p2 = away(LOOP.controls, LOOP.reach * r);
  return finishing({ kind: "cubic", points: [p0, p1, p2, p3] });
}

const down: Point = [0, 1];
const half = (part: Placement) => reachOf(part);

/**
 * A GRAFCET link from one step to another, with its transition bar. A target level or above runs round by
 * `returnX`. A link that leaves a step with other links (an alternative branch) runs out along a line
 * just under the step and carries its own bar on its last vertical, so each branch's transition and
 * label sit on that branch.
 */
export function link(from: Placement, to: Placement, returnX?: number, branches = false): DrawnEdge {
  const h = half(from);
  const ht = half(to);
  const [cx, cy] = centreOf(from);
  const [tx, ty] = centreOf(to);
  let points: Point[];
  let barY: number;
  let barX = cx;
  if (ty > cy && Math.abs(tx - cx) < 1) {
    points = [
      [cx, cy + h],
      [cx, ty - ht],
    ];
    barY = Math.round((cy + ty) / 2 / GRID) * GRID;
  } else if (ty > cy && branches) {
    const bus = cy + h + LINK_JOG;
    points = [
      [cx, cy + h],
      [cx, bus],
      [tx, bus],
      [tx, ty - ht],
    ];
    barX = tx;
    barY = Math.round((bus + ty - ht) / 2 / GRID) * GRID;
  } else if (ty > cy) {
    points = [
      [cx, cy + h],
      [cx, ty - ht - LINK_JOG],
      [tx, ty - ht - LINK_JOG],
      [tx, ty - ht],
    ];
    barY = cy + h + LINK_JOG;
  } else {
    const x = returnX ?? cx - 3 * LINK_RUN;
    points = [
      [cx, cy + h],
      [cx, cy + h + LINK_RUN],
      [x, cy + h + LINK_RUN],
      [x, ty - ht - LINK_RUN],
      [tx, ty - ht - LINK_RUN],
      [tx, ty - ht],
    ];
    barY = cy + h + LINK_JOG;
  }
  const tip = points[points.length - 1] as Point;
  return {
    curve: { kind: "polyline", points },
    arrow: { tip, dir: down },
    bar: [
      [barX - 10, barY],
      [barX + 10, barY],
    ],
  };
}

const cubicAt = ([a, b, c, d]: readonly [Point, Point, Point, Point], t: number): Point => {
  const s = 1 - t;
  return [
    s * s * s * a[0] + 3 * s * s * t * b[0] + 3 * s * t * t * c[0] + t * t * t * d[0],
    s * s * s * a[1] + 3 * s * s * t * b[1] + 3 * s * t * t * c[1] + t * t * t * d[1],
  ];
};

const lengthOf = (pts: readonly Point[]) =>
  pts.reduce((sum, p, i) => (i === 0 ? 0 : sum + norm(minus(p, pts[i - 1] as Point))), 0);

/** The point at `distance` px along a polyline. */
function along(pts: readonly Point[], distance: number): Point {
  let left = distance;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as Point;
    const b = pts[i] as Point;
    const len = norm(minus(b, a));
    if (left <= len || i === pts.length - 1) return len === 0 ? b : lerp(a, b, Math.min(1, left / len));
    left -= len;
  }
  return pts[0] as Point;
}

/** `n + 1` points along the curve, ends included: a cubic evenly in its parameter, a polyline evenly in length. */
export function sample(curve: Curve, n = 32): Point[] {
  if (curve.kind === "cubic") return Array.from({ length: n + 1 }, (_, i) => cubicAt(curve.points, i / n));
  const total = lengthOf(curve.points);
  return Array.from({ length: n + 1 }, (_, i) => along(curve.points, (total * i) / n));
}

/** The point at fraction `t` of the curve's length (0 its first point, 1 its last). */
export function pointAt(curve: Curve, t: number): Point {
  const pts = curve.kind === "cubic" ? sample(curve, 96) : curve.points;
  return along(pts, lengthOf(pts) * Math.min(1, Math.max(0, t)));
}

const fixed = (v: number) => String(Math.round(v * 10) / 10);
const at = (p: Point) => `${fixed(p[0])} ${fixed(p[1])}`;

/** SVG path data: `M x y C …` for a cubic, `M x y L …` for a polyline, one decimal. */
export function pathOf(curve: Curve): string {
  const [first, ...rest] = curve.points;
  if (!first) return "";
  return `M${at(first)}${curve.kind === "cubic" ? "C" : "L"}${rest.map(at).join(curve.kind === "cubic" ? " " : "L")}`;
}

/** The filled triangle of an arrowhead. */
export function arrowPath({ tip, dir }: DrawnEdge["arrow"]): string {
  const base = minus(tip, scaled(dir, ARROW.length));
  const side: Point = [-dir[1], dir[0]];
  return `M${at(tip)}L${at(plus(base, scaled(side, ARROW.half)))}L${at(minus(base, scaled(side, ARROW.half)))}Z`;
}

/** Where `p` is nearest on the segment a–b. */
function nearestOnSegment(p: Point, a: Point, b: Point): Point {
  const ab = minus(b, a);
  const len2 = dot(ab, ab);
  if (len2 === 0) return a;
  const t = Math.min(1, Math.max(0, dot(minus(p, a), ab) / len2));
  return plus(a, scaled(ab, t));
}

/** The shortest distance from `p` to a polyline. */
export function distanceToPolyline(p: Point, points: readonly Point[]): number {
  if (points.length === 1) return norm(minus(p, points[0] as Point));
  let best = Infinity;
  for (let i = 1; i < points.length; i++)
    best = Math.min(best, norm(minus(p, nearestOnSegment(p, points[i - 1] as Point, points[i] as Point))));
  return best;
}

const side = (a: Point, b: Point, c: Point) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));

/** Whether segment a–b crosses segment c–d: a proper crossing, never a touch or an overlap. */
export function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const [s1, s2, s3, s4] = [side(a, b, c), side(a, b, d), side(c, d, a), side(c, d, b)];
  return s1 * s2 < 0 && s3 * s4 < 0;
}

/**
 * The vector from the chord's nearest point to the curve's farthest point from its chord; undefined
 * when the curve is straight (its farthest point within `STRAIGHT_PX`).
 */
export function bowOf(curve: Curve): Point | undefined {
  const pts = sample(curve, 32);
  const first = pts[0] as Point;
  const last = pts[pts.length - 1] as Point;
  let best: { gap: number; v: Point } | undefined;
  for (const p of pts) {
    const v = minus(p, nearestOnSegment(p, first, last));
    const gap = norm(v);
    if (!best || gap > best.gap) best = { gap, v };
  }
  return best && best.gap >= STRAIGHT_PX ? best.v : undefined;
}
