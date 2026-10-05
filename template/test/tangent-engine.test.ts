import { describe, expect, it } from "vitest";
import { at, quantities, secants, slopeAt, valueAt } from "../src/sims/tangent/engine.ts";

// The Fixture Course's synthetic cubic, f(x) = x³ − 3x² + 2x + 1, checked against values worked by
// hand: f'(x) = 3x² − 6x + 2, so at x = 2 the tangent is y = 2x − 3, and the secant over a run h
// has slope 2 + 3h + h².
const model = { coefficients: [1, 2, -3, 1] };
const example = { a: 2, h: 1 };

describe("the tangent engine", () => {
  it("evaluates the polynomial and its derivative", () => {
    expect(valueAt(model, 2)).toBe(1);
    expect(valueAt(model, 3)).toBe(7);
    expect(valueAt(model, 0)).toBe(1);
    expect(slopeAt(model, 2)).toBe(2);
    expect(slopeAt(model, 0)).toBe(2);
    expect(slopeAt(model, 1)).toBe(-1);
  });

  it("gives the tangent at a, and secants over runs shrinking by tenths, closing on its slope", () => {
    const view = at(model, example);
    expect(view.value).toBe(1);
    expect(view.slope).toBe(2);
    expect(view.intercept).toBe(-3);
    const rows = secants(model, example);
    expect(rows.map((r) => r.run)).toEqual([1, 0.1, 0.01]);
    expect(rows[0]?.value).toBeCloseTo(7, 12);
    expect(rows[1]?.value).toBeCloseTo(1.231, 12);
    expect(rows[2]?.value).toBeCloseTo(1.020301, 12);
    rows.forEach((r) => expect(r.slope).toBeCloseTo(2 + 3 * r.run + r.run ** 2, 9));
    const gaps = rows.map((r) => Math.abs(r.slope - view.slope));
    expect(gaps[1]).toBeLessThan(gaps[0] ?? 0);
    expect(gaps[2]).toBeLessThan(gaps[1] ?? 0);
  });

  it("names every number the way sheets and recompute logs do", () => {
    const named = quantities(model, example);
    expect(named).toMatchObject({ "f(a)": 1, slope: 2, intercept: -3, "h[0]": 1, "h[1]": 0.1, "h[2]": 0.01 });
    expect(named["f(a+h)[1]"]).toBeCloseTo(1.231, 12);
    expect(named["secant[2]"]).toBeCloseTo(2.0301, 9);
    expect(Object.keys(named)).toHaveLength(12);
  });

  it("stays finite wherever a student can take it, a negative point included", () => {
    for (const a of [-1, 0, 3.5]) {
      for (const h of [0.05, 1.5]) {
        for (const v of Object.values(quantities(model, { a, h }))) expect(Number.isFinite(v)).toBe(true);
      }
    }
  });
});
