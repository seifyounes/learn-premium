// What the ladder sim's view shows, worked out from the run: each scan kept for the timing chart,
// each timer's gauge (how far it has run), and the delays the chart measures (from a timer's input
// rising to its Q rising). Pure, so the page and the tests read the same numbers.

import { parseS5Time, parseTime, s5tSeconds } from "../s7/core.ts";
import { TIMER_KIND, type Bit, type Inputs, type LadderRun, type ScanState } from "./engine.ts";
import { netOf, parseOperand, type LadderModel, type LadderPart } from "./model.ts";

/** One scan as the chart keeps it: its time, every net's level, and the watched values after it. */
export interface Moment extends ScanState {
  /** The input bits the scan read. */
  inputs: Inputs;
  watch: Record<string, number>;
  /** Each timer box's gauge, 0 to 1, by part id. */
  gauges: Record<string, number>;
}

/** The timer boxes and coils a model draws, which carry a gauge. */
export const timerParts = (model: LadderModel) =>
  model.parts.filter((p) => p.kind === "ton" || (TIMER_KIND[p.kind] !== undefined && p.kind.startsWith("s-")));

/** How far each timer box has run, 0 to 1: ET over PT, or the S5 time gone over its preset. */
export function gauges(run: LadderRun): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of timerParts(run.model)) {
    const o = parseOperand(part.operand ?? "");
    const n = o && "number" in o ? o.number : 0;
    if (part.kind === "ton") {
      const ton = run.tons.get(n);
      const pt = parseTime(part.params?.PT ?? "T#0S");
      out[part.id] = ton && pt > 0 ? Math.min(1, ton.ET / pt) : 0;
    } else {
      const timer = run.timers.get(n);
      const preset = s5tSeconds(parseS5Time(part.params?.TV ?? "S5T#0S"));
      if (!timer || preset <= 0) out[part.id] = 0;
      else if (timer.running) out[part.id] = Math.min(1, Math.max(0, 1 - timer.remaining / preset));
      else out[part.id] = timer.status && (TIMER_KIND[part.kind] === "SD" || TIMER_KIND[part.kind] === "SS") ? 1 : 0;
    }
  }
  return out;
}

/** The scan just run, as the chart keeps it. */
export const momentOf = (run: LadderRun, state: ScanState, inputs: Inputs): Moment => ({
  ...state,
  inputs,
  watch: run.watch(),
  gauges: gauges(run),
});

/** A delay the chart measures: a timer's input rising at `from`, its Q rising at `to` (ms). */
export interface Measure {
  part: string;
  from: number;
  to: number;
}

const levelAt = (m: Moment, model: LadderModel, part: LadderPart, pin: string): Bit => {
  const net = netOf(model, `${part.id}.${pin}`);
  return net ? (m.levels[net.id] ?? 0) : 0;
};

/** Every completed on-delay in the history: input up, then Q up while the input held. */
export function measures(model: LadderModel, history: readonly Moment[]): Measure[] {
  const out: Measure[] = [];
  for (const part of timerParts(model)) {
    const kind = part.kind === "ton" ? "TON" : TIMER_KIND[part.kind];
    if (kind !== "TON" && kind !== "SD" && kind !== "SS") continue;
    const input = part.kind === "ton" ? "IN" : "S";
    let rose: number | undefined;
    history.forEach((m, i) => {
      const before = history[i - 1];
      const up = levelAt(m, model, part, input) === 1;
      const wasUp = before ? levelAt(before, model, part, input) === 1 : false;
      if (up && !wasUp) rose = m.ms;
      if (!up && kind !== "SS") rose = undefined;
      const q = levelAt(m, model, part, "Q") === 1;
      const wasQ = before ? levelAt(before, model, part, "Q") === 1 : false;
      if (q && !wasQ && rose !== undefined) {
        out.push({ part: part.id, from: rose, to: m.ms });
        rose = undefined;
      }
    });
  }
  return out;
}

/** Seconds as the chart prints them: one decimal. */
export const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
