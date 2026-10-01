import { describe, expect, it } from "vitest";
import { startTuning, tuning, type Tune } from "../src/sims/tuning.ts";

const start = { theta0: 0, theta1: 0, alpha: 0.1, iterations: 2 };
const tune: Tune = {
  theta0: { min: -1, max: 3, step: 0.1 },
  theta1: { min: -1, max: 3, step: 0.1 },
  alpha: { min: 0.01, max: 1, step: 0.01 },
  iterations: { min: 0, max: 30, step: 1 },
};
const opened = startTuning(start);

describe("tuning a sim", () => {
  it("opens on the example's values, drawn at once", () => {
    expect(opened).toEqual({ inputs: start, landing: undefined, epoch: 0 });
  });

  it("snaps a tuned value to its slider's step, inside its range, with no float dust", () => {
    expect(tuning(tune, opened, { type: "set", input: "alpha", value: 0.30000000000000004 }).inputs.alpha).toBe(0.3);
    expect(tuning(tune, opened, { type: "set", input: "theta0", value: 1.234 }).inputs.theta0).toBe(1.2);
    expect(tuning(tune, opened, { type: "set", input: "theta1", value: 9 }).inputs.theta1).toBe(3);
    expect(tuning(tune, opened, { type: "set", input: "alpha", value: -4 }).inputs.alpha).toBe(0.01);
  });

  it("tunes only what the sim lets students tune: anything else is the Professor's", () => {
    expect(tuning(tune, opened, { type: "set", input: "data", value: 5 })).toBe(opened);
    expect(tuning(tune, opened, { type: "set", input: "alpha", value: Number.NaN })).toBe(opened);
  });

  it("redraws at once when an input moves, and lands only the new row when it takes one more step", () => {
    const moved = tuning(tune, opened, { type: "set", input: "alpha", value: 0.2 });
    expect(moved.landing).toBeUndefined();
    expect(moved.epoch).toBe(1);
    const stepped = tuning(tune, moved, { type: "step" });
    expect(stepped.inputs.iterations).toBe(3);
    expect(stepped.landing).toBe(3);
    expect(stepped.epoch).toBe(1);
  });

  it("takes no step past its last", () => {
    const last = tuning(tune, opened, { type: "set", input: "iterations", value: 30 });
    expect(tuning(tune, last, { type: "step" })).toBe(last);
  });

  it("resets to the example's values", () => {
    const moved = tuning(tune, opened, { type: "set", input: "theta0", value: 2 });
    expect(tuning(tune, moved, { type: "reset", start })).toEqual({ inputs: start, landing: undefined, epoch: 2 });
  });
});
