// A mechanism's pose: where each link sits at a driver angle, as an origin and a turn in the sheet
// frame (x along the ground line, y up, mm and degrees, counterclockwise). Both views draw from it:
// the 3D scene turns each link's group by it, and the 2D drawing sets it as the link's SVG matrix.
import { solveFourBar, wrapDegrees } from "./four-bar.ts";
import { MOVING_LINKS, TRACED_PINS, type FourBar, type LinkId, type Model, type Point } from "./model.ts";

export const TRACE_STEPS = 360;

/** Where a link's local origin sits, and its turn in degrees, CCW, in [0, 360). */
export interface LinkPose {
  at: Point;
  angle: number;
}
export interface Pose {
  theta: number;
  links: Partial<Record<LinkId, LinkPose>>;
}
type Pins = Partial<Record<LinkId, Record<string, Point>>>;

/** SVG's `matrix(a b c d e f)` for a link: turn by its angle, then move to its origin. */
export type Matrix = readonly [a: number, b: number, c: number, d: number, e: number, f: number];

export function linkMatrix(l: LinkPose): Matrix {
  const t = (l.angle * Math.PI) / 180;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  return [cos, sin, -sin, cos, l.at[0], l.at[1]];
}

export function applyMatrix(m: Matrix, p: Point): Point {
  return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
}

/** `matrix(a b c d e f)`, the numbers to 6 decimals. */
export const svgMatrix = (l: LinkPose): string =>
  `matrix(${linkMatrix(l)
    .map((n) => String(Number(n.toFixed(6))))
    .join(" ")})`;

/** The pointer's bearing from the pivot, in degrees, [0, 360): what dragging the driving pin sets. */
export function dragAngle(pivot: Point, pointer: Point): number {
  return wrapDegrees((Math.atan2(pointer[1] - pivot[1], pointer[0] - pivot[0]) * 180) / Math.PI);
}

/** Each link's pins, in its own frame. */
export function linkPins(model: Model): Pins {
  if (model.type === "four-bar") {
    const { ground: d, crank: a, coupler: b, rocker: c, couplerPoint } = model;
    return {
      ground: { O2: [0, 0], O4: [d, 0] },
      crank: { O2: [0, 0], A: [a, 0] },
      coupler: {
        A: [0, 0],
        B: [b, 0],
        ...(couplerPoint ? { P: [couplerPoint.along, couplerPoint.off] as Point } : {}),
      },
      rocker: { O4: [0, 0], B: [c, 0] },
    };
  }
  throw new Error("gear pairs arrive with the gear geometry");
}

export function pose(model: Model, theta: number): Pose {
  if (model.type === "four-bar") return fourBarPose(model, theta);
  throw new Error("gear pairs arrive with the gear geometry");
}

function fourBarPose(model: FourBar, theta: number): Pose {
  const { A, theta3, theta4 } = solveFourBar(model, theta);
  return {
    theta,
    links: {
      ground: { at: [0, 0], angle: 0 },
      crank: { at: [0, 0], angle: wrapDegrees(theta) },
      coupler: { at: A, angle: theta3 },
      rocker: { at: [model.ground, 0], angle: theta4 },
    },
  };
}

/** Each link's pins placed by its pose. */
export function pins(model: Model, p: Pose): Pins {
  const placed: Pins = {};
  for (const [link, local] of Object.entries(linkPins(model)) as [LinkId, Record<string, Point>][]) {
    const at = p.links[link];
    if (!at) continue;
    const matrix = linkMatrix(at);
    placed[link] = Object.fromEntries(Object.entries(local).map(([pin, point]) => [pin, applyMatrix(matrix, point)]));
  }
  return placed;
}

/** One driver turn at θ = k·360/steps: each moving link's angle, and each pin off the ground. */
export function trace(
  model: Model,
  steps = TRACE_STEPS,
): { theta: number[]; angles: Partial<Record<LinkId, number[]>>; points: Record<string, Point[]> } {
  const links: readonly LinkId[] = MOVING_LINKS[model.type];
  const traced: readonly string[] = TRACED_PINS[model.type];
  const out = {
    theta: [] as number[],
    angles: Object.fromEntries(links.map((link) => [link, [] as number[]])) as Partial<Record<LinkId, number[]>>,
    points: {} as Record<string, Point[]>,
  };
  for (let k = 0; k < steps; k++) {
    const theta = (k * 360) / steps;
    const p = pose(model, theta);
    const placed = pins(model, p);
    out.theta.push(theta);
    for (const link of links) out.angles[link]?.push(p.links[link]?.angle ?? NaN);
    for (const pin of traced) {
      const at = Object.values(placed).find((local) => local[pin])?.[pin];
      if (at) (out.points[pin] ??= []).push(at);
    }
  }
  return out;
}

/** Every pin, and each gear's tip circle, over one driver turn: what the drawing's box must hold. */
export function sweptBox(model: Model): { min: Point; max: Point } {
  const box = { min: [Infinity, Infinity] as [number, number], max: [-Infinity, -Infinity] as [number, number] };
  const add = (x: number, y: number) => {
    box.min = [Math.min(box.min[0], x), Math.min(box.min[1], y)];
    box.max = [Math.max(box.max[0], x), Math.max(box.max[1], y)];
  };
  for (let k = 0; k < TRACE_STEPS; k++) {
    for (const local of Object.values(pins(model, pose(model, k))))
      for (const [x, y] of Object.values(local)) add(x, y);
  }
  return box;
}
