import { describe, expect, it } from "vitest";
import { contour, descend, quantities } from "../src/sims/gradient-descent/engine.ts";

// The Fixture Course's synthetic line fit, checked against exact fractions worked by hand.
const model = {
  data: [
    [0, 1],
    [1, 3],
    [2, 4],
  ] as [number, number][],
};
const example = { theta0: 0, theta1: 0, alpha: 0.1, iterations: 2 };

describe("the gradient-descent engine", () => {
  it("replays batch gradient descent on the half mean squared error, one iterate per row", () => {
    const trace = descend(model, example);
    expect(trace.iterates.map((r) => r.k)).toEqual([0, 1, 2]);
    const [start, first, second] = trace.iterates;
    expect(start).toMatchObject({ theta0: 0, theta1: 0 });
    expect(start?.J).toBeCloseTo(13 / 3, 12);
    expect(first?.theta0).toBeCloseTo(4 / 15, 12);
    expect(first?.theta1).toBeCloseTo(11 / 30, 12);
    expect(first?.J).toBeCloseTo(2.5231481481481484, 12);
    expect(second?.theta0).toBeCloseTo(0.47, 12);
    expect(second?.theta1).toBeCloseTo(0.6455555555555555, 12);
    expect(second?.J).toBeCloseTo(1.4741090534979424, 12);
    expect(trace.diverges).toBe(false);
  });

  it("finds the least-squares minimum and the largest α that still converges", () => {
    const trace = descend(model, example);
    expect(trace.minimum.theta0).toBeCloseTo(7 / 6, 12);
    expect(trace.minimum.theta1).toBeCloseTo(1.5, 12);
    expect(trace.minimum.J).toBeCloseTo(1 / 36, 12);
    // 2 / λmax of the cost's Hessian, (1/m) XᵀX: λmax = (4 + √10) / 3.
    expect(trace.alphaLimit).toBeCloseTo(6 / (4 + Math.sqrt(10)), 12);
  });

  it("converges below the α limit and diverges above it, J growing step on step", () => {
    const slow = descend(model, { ...example, iterations: 1000 });
    const last = slow.iterates.at(-1);
    expect(last?.theta0).toBeCloseTo(7 / 6, 6);
    expect(last?.theta1).toBeCloseTo(1.5, 6);

    const fast = descend(model, { ...example, alpha: 0.9, iterations: 12 });
    expect(fast.diverges).toBe(true);
    const costs = fast.iterates.map((r) => r.J);
    expect(costs.at(-1)).toBeGreaterThan(costs[0] ?? Infinity);
  });

  it("stops at the last finite iterate when the numbers overflow", () => {
    const trace = descend(model, { ...example, alpha: 50, iterations: 400 });
    expect(trace.diverges).toBe(true);
    expect(trace.iterates.length).toBeLessThan(401);
    expect(trace.iterates.every((r) => Number.isFinite(r.J))).toBe(true);
  });

  it("names every number it gives, the way a sheet or a recompute log refers to them", () => {
    const named = quantities(descend(model, example));
    expect(Object.keys(named)).toEqual([
      "theta0[0]",
      "theta1[0]",
      "J[0]",
      "theta0[1]",
      "theta1[1]",
      "J[1]",
      "theta0[2]",
      "theta1[2]",
      "J[2]",
      "minimum.theta0",
      "minimum.theta1",
      "minimum.J",
      "alpha.limit",
    ]);
    expect(named["theta1[1]"]).toBeCloseTo(11 / 30, 12);
  });

  it("draws a cost contour as an ellipse every point of which costs the level", () => {
    const ellipse = contour(model, 1);
    expect(ellipse).toBeDefined();
    for (const t of [0, 0.7, 2.1, 4]) {
      const [theta0, theta1] = ellipse?.at(t) ?? [NaN, NaN];
      const J = descend(model, { theta0, theta1, alpha: 0, iterations: 0 }).iterates[0]?.J;
      expect(J).toBeCloseTo(1, 10);
    }
    // A level at or below the minimum has no contour.
    expect(contour(model, 1 / 36)).toBeUndefined();
  });
});
