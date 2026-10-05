import { describe, expect, it } from "vitest";
import { field, profile, quantities } from "../src/sims/plane-wall/engine.ts";

// The Fixture Course's synthetic plate: 40 mm thick, α = 12 mm²/s, at 200 °C until both faces are
// held at 20 °C. Checked against the exact solution, the Fourier series, written here apart from
// the engine's Crank–Nicolson march.
const model = { thickness: 40, initial: 200, surface: 20 };
const example = { time: 30, diffusivity: 12 };

function fourier(x: number, time: number, diffusivity = example.diffusivity): number {
  const { thickness: L, initial, surface } = model;
  let sum = 0;
  for (let n = 1; n < 4001; n += 2)
    sum +=
      (4 / (n * Math.PI)) *
      Math.sin((n * Math.PI * x) / L) *
      Math.exp(-(((n * Math.PI) / L) ** 2) * diffusivity * time);
  return surface + (initial - surface) * sum;
}

describe("the plane-wall engine", () => {
  it("agrees with the Fourier series to well inside a sheet's one decimal", () => {
    for (const time of [5, 30, 90, 300]) {
      const { at } = profile(model, { ...example, time });
      for (const x of [5, 10, 20, 30])
        expect(Math.abs(at(x) - fourier(x, time)), `x = ${x}, t = ${time}`).toBeLessThan(0.02);
    }
    // Early, once the change at the faces has spread a few grid intervals (Fo = 0.015).
    const early = profile(model, { ...example, time: 2 });
    for (const x of [1, 2, 5, 20]) expect(Math.abs(early.at(x) - fourier(x, 2)), `x = ${x}, t = 2`).toBeLessThan(0.03);
    // A faster-diffusing wall too, at a slider's far end.
    const fast = profile(model, { time: 30, diffusivity: 50 });
    expect(Math.abs(fast.at(20) - fourier(20, 30, 50))).toBeLessThan(0.02);
  });

  it("holds the faces at the surface temperature, keeps the wall symmetric, and cools towards the faces", () => {
    const { at } = profile(model, example);
    expect(at(0)).toBe(20);
    expect(at(40)).toBe(20);
    expect(at(10)).toBeCloseTo(at(30), 9);
    expect(at(20)).toBeGreaterThan(at(10));
    expect(profile(model, { ...example, time: 0 }).at(20)).toBe(200);
    expect(profile(model, { ...example, time: 1e5 }).at(20)).toBeCloseTo(20, 6);
  });

  it("names every number the way sheets and recompute logs do", () => {
    const named = quantities(model, example);
    expect(Object.keys(named)).toEqual(["T(0)", "T(L/4)", "T(L/2)", "T(3L/4)", "T(L)", "Fo"]);
    expect(named.Fo).toBeCloseTo(0.225, 12);
    expect(named["T(L/2)"]).toBeCloseTo(fourier(20, 30), 1);
  });

  it("maps the wall over time, from the start to the end of the slider, for the heatmap", () => {
    const map = field(model, { diffusivity: 12, until: 120 });
    expect(map.x[0]).toBe(0);
    expect(map.x.at(-1)).toBe(40);
    expect(map.t[0]).toBe(0);
    expect(map.t.at(-1)).toBeCloseTo(120, 9);
    expect(map.T).toHaveLength(map.t.length);
    for (const row of map.T) expect(row).toHaveLength(map.x.length);
    const middle = map.x.indexOf(20);
    const late = map.T.at(-1)?.[middle] ?? 0;
    expect(Math.abs(late - fourier(20, 120))).toBeLessThan(0.02);
  });
});
