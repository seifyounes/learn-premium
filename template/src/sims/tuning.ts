// How a student tunes a live sim: the inputs it lets them change, each snapped to its slider's step
// inside its range. Nothing else can change: the model is the Professor's (tune, never rewire).
// Pure, so the island is a thin view over it.
import { decimalsOf } from "./print.ts";

export interface Range {
  min: number;
  max: number;
  step: number;
}

/** The inputs students may tune, each with its slider's range. */
export type Tune = Readonly<Record<string, Range>>;
/** The inputs students tune, by name. */
export type Inputs = Readonly<Record<string, number>>;

export interface Tuning {
  inputs: Inputs;
  /** The row that lands with motion: the step just taken. Anything else redraws at once. */
  landing: number | undefined;
  /** Bumped whenever the whole trace must redraw without motion. */
  epoch: number;
}

export type TuningAction =
  | { type: "set"; input: string; value: number }
  /** One more step of the engine, landing its row. */
  | { type: "step" }
  | { type: "reset"; start: Inputs };

export const startTuning = (start: Inputs): Tuning => ({ inputs: start, landing: undefined, epoch: 0 });

/** `value` on the slider: snapped to its step from its minimum, inside its range. */
export function snap(value: number, { min, max, step }: Range): number {
  const steps = Math.round((Math.min(Math.max(value, min), max) - min) / step);
  const snapped = Math.min(min + steps * step, max);
  return Number(snapped.toFixed(Math.max(decimalsOf(step), decimalsOf(min))));
}

export function tuning(tune: Tune, t: Tuning, action: TuningAction): Tuning {
  switch (action.type) {
    case "set": {
      const range = tune[action.input];
      if (!range || !Number.isFinite(action.value)) return t;
      const value = snap(action.value, range);
      if (value === t.inputs[action.input]) return t;
      return { inputs: { ...t.inputs, [action.input]: value }, landing: undefined, epoch: t.epoch + 1 };
    }
    case "step": {
      // A sim that steps names its step count `iterations`.
      const range = tune.iterations;
      const iterations = (t.inputs.iterations ?? 0) + 1;
      if (!range || iterations > range.max) return t;
      return { ...t, inputs: { ...t.inputs, iterations }, landing: iterations };
    }
    case "reset":
      return { inputs: action.start, landing: undefined, epoch: t.epoch + 1 };
  }
}
