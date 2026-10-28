// The curve drawer: arcs between circles, self-loops on their side, GRAFCET links. Pure geometry.
import { describe, expect, it } from "vitest";
import {
  arc,
  arrowPath,
  bowOf,
  distanceToPolyline,
  link,
  onOutline,
  outlinePoint,
  pathOf,
  pointAt,
  rotate,
  sample,
  segmentsCross,
  selfLoop,
  sideVector,
  unit,
} from "../src/sims/layout/curves.ts";
import { GRID, SIDES, type Placement, type Point } from "../src/sims/layout/symbols.ts";

const at = (kind: Placement["kind"], x: number, y: number): Placement => ({ kind, x, y, turn: 0, flip: false });
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1];
const near = (a: Point, b: Point, px = 1e-6) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= px;

describe("vectors", () => {
  it("a side is a unit vector and a rotation turns clockwise on screen", () => {
    expect(SIDES.map(sideVector)).toEqual([
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ]);
    expect(near(rotate([1, 0], 90), [0, 1])).toBe(true);
    expect(near(unit([3, 4]), [0.6, 0.8])).toBe(true);
  });
});

describe("an arc", () => {
  const A = at("state", 0, 0);
  const B = at("state", 200, 0);

  it("a straight arc runs centre to centre, outline to outline, its arrow into the target", () => {
    const edge = arc(A, B, [0, 0]);
    expect(edge.curve.points[0]).toEqual([30, 0]);
    expect(edge.curve.points.at(-1)).toEqual([170, 0]);
    expect(near(edge.arrow.dir, [1, 0])).toBe(true);
    expect(edge.arrow.tip).toEqual([170, 0]);
    expect(bowOf(edge.curve)).toBeUndefined();
  });

  it("an arc bows by its sagitta", () => {
    const edge = arc(A, B, [0, 30]);
    const middle = pointAt(edge.curve, 0.5);
    // The bow is on the sagitta's side, centred between the states; its ends sit on the outlines.
    expect(Math.abs(middle[0] - 100)).toBeLessThan(1);
    expect(middle[1]).toBeGreaterThanOrEqual(30);
    expect(middle[1]).toBeLessThanOrEqual(40);
    expect(onOutline(A, edge.curve.points[0] as Point)).toBe(true);
    expect(onOutline(B, edge.curve.points.at(-1) as Point)).toBe(true);
    const bow = bowOf(edge.curve);
    expect(bow && bow[1]).toBeGreaterThan(15);
    expect(bow && Math.abs(bow[0])).toBeLessThan(1);
    // The arrowhead points into B.
    expect(dot(edge.arrow.dir, [B.x - edge.arrow.tip[0], B.y - edge.arrow.tip[1]])).toBeGreaterThan(0);
  });

  it("an opposed pair bowed to their own right keeps clear of each other", () => {
    const there = arc(A, B, [0, 30]);
    const back = arc(B, A, [0, -30]);
    const a = sample(there.curve, 32);
    const b = sample(back.curve, 32);
    let crossing = false;
    for (let i = 1; i < a.length; i++)
      for (let j = 1; j < b.length; j++)
        if (segmentsCross(a[i - 1] as Point, a[i] as Point, b[j - 1] as Point, b[j] as Point)) crossing = true;
    expect(crossing).toBe(false);
  });
});

describe("a self-loop", () => {
  for (const side of SIDES) {
    it(`sits on its side (${side}), both ends on the outline, its arrow into the state`, () => {
      const state = at("state", 200, 200);
      const edge = selfLoop(state, side);
      const u = sideVector(side);
      const pts = edge.curve.points;
      expect(onOutline(state, pts[0] as Point)).toBe(true);
      expect(onOutline(state, pts.at(-1) as Point)).toBe(true);
      const apex = pointAt(edge.curve, 0.5);
      expect(dot([apex[0] - state.x, apex[1] - state.y], u)).toBeGreaterThanOrEqual(1.5 * 30);
      expect(dot(edge.arrow.dir, [state.x - edge.arrow.tip[0], state.y - edge.arrow.tip[1]])).toBeGreaterThan(0);
      // No sample between the ends lies inside the circle.
      for (const p of sample(edge.curve, 32).slice(1, -1))
        expect(Math.hypot(p[0] - state.x, p[1] - state.y)).toBeGreaterThan(30 - 1e-6);
    });
  }
});

describe("a GRAFCET link", () => {
  const X0 = at("step-initial", 100, 0);
  const X1 = at("step", 100, 120);

  it("a down link is straight with its bar halfway", () => {
    const edge = link(X0, X1);
    expect(edge.curve.points).toEqual([
      [100, 20],
      [100, 100],
    ]);
    expect(edge.bar).toEqual([
      [90, 60],
      [110, 60],
    ]);
    expect(edge.arrow).toEqual({ tip: [100, 100], dir: [0, 1] });
  });

  it("a link to another column runs across just above its target", () => {
    const edge = link(at("step", 100, 0), at("step", 200, 120));
    expect(edge.curve.points).toEqual([
      [100, 20],
      [100, 80],
      [200, 80],
      [200, 100],
    ]);
    expect(edge.bar).toEqual([
      [90, 40],
      [110, 40],
    ]);
  });

  it("a return link runs out on its side, up and back in from above: four bends, every corner on the grid", () => {
    const X2 = at("step", 100, 240);
    const edge = link(X2, X0, 40);
    const pts = edge.curve.points;
    expect(pts).toEqual([
      [100, 260],
      [100, 300],
      [40, 300],
      [40, -60],
      [100, -60],
      [100, -20],
    ]);
    for (const [x, y] of pts) expect(x % GRID === 0 && y % GRID === 0).toBe(true);
    expect(edge.arrow.dir).toEqual([0, 1]);
    // Four bends.
    let bends = 0;
    for (let i = 2; i < pts.length; i++) {
      const a = pts[i - 2] as Point;
      const b = pts[i - 1] as Point;
      const c = pts[i] as Point;
      if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) !== 0) bends += 1;
    }
    expect(bends).toBe(4);
  });
});

describe("outlines", () => {
  it("a square's outline point is where the ray leaves its side", () => {
    const step = at("step", 0, 0);
    expect(outlinePoint(step, [100, 0])).toEqual([20, 0]);
    expect(outlinePoint(step, [100, 100])).toEqual([20, 20]);
    expect(onOutline(step, [20, 7])).toBe(true);
    expect(onOutline(step, [10, 7])).toBe(false);
  });

  it("a circle's outline is 30px from its centre", () => {
    const state = at("state", 50, 50);
    expect(onOutline(state, [80, 50])).toBe(true);
    expect(onOutline(state, [75, 50])).toBe(false);
  });
});

describe("walking and measuring a curve", () => {
  it("pointAt walks the curve at even speed", () => {
    const c = arc(at("state", 0, 0), at("state", 200, 0), [0, 30]).curve;
    expect(near(pointAt(c, 0), c.points[0] as Point, 0.5)).toBe(true);
    expect(near(pointAt(c, 1), c.points.at(-1) as Point, 0.5)).toBe(true);
    const polyline = {
      kind: "polyline",
      points: [
        [0, 0],
        [100, 0],
        [100, 100],
      ],
    } as const;
    expect(near(pointAt(polyline, 0.5), [100, 0], 1e-6)).toBe(true);
    expect(sample(polyline, 8)).toHaveLength(9);
  });

  it("segmentsCross sees a crossing, not a touch", () => {
    expect(segmentsCross([0, 0], [10, 10], [0, 10], [10, 0])).toBe(true);
    expect(segmentsCross([0, 0], [10, 0], [10, 0], [10, 10])).toBe(false);
    expect(segmentsCross([0, 0], [10, 0], [0, 5], [10, 5])).toBe(false);
  });

  it("distanceToPolyline is the distance to the nearest segment", () => {
    const line: Point[] = [
      [0, 0],
      [100, 0],
      [100, 100],
    ];
    expect(distanceToPolyline([50, 30], line)).toBe(30);
    expect(distanceToPolyline([130, 50], line)).toBe(30);
    expect(distanceToPolyline([-10, 0], line)).toBe(10);
  });

  it("writes its path data and arrowhead", () => {
    const edge = link(at("step", 100, 0), at("step", 100, 120));
    expect(pathOf(edge.curve)).toBe("M100 20L100 100");
    expect(arrowPath(edge.arrow)).toBe("M100 100L96 90L104 90Z");
    expect(pathOf(arc(at("state", 0, 0), at("state", 200, 0), [0, 0]).curve)).toMatch(/^M30 0C/);
  });
});
