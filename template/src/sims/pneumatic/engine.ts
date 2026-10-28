// The pneumatic engine: a pure function of the circuit and the push buttons held. Tests, `kinds.ts`,
// the gates and the island import the engine only through this file. Valves switch instantly,
// every stroke takes STROKE_MS, travel is a whole number of ms, so a run's trace is exact.
//
// The circuit settles in Jacobi rounds: every roller and button, then every line's pressure (one
// union-find over the pins the nets and each valve's passages join), then every spool and every
// cylinder's drive from those pressures at once. Time then moves pistons to the next stroke end.
import type { Actuation, PneumaticKind } from "../layout/pneumatic.ts";
import { quantityOf, type Now, type TimingRow } from "../timing/diagram.ts";
import { stepCaption } from "./captions.ts";
import {
  cylinders,
  markOf,
  netOf,
  restEnd,
  sensors,
  valves52,
  type Level,
  type PneumaticModel,
  type Side,
} from "./model.ts";

export * from "./model.ts";

/** One stroke, either way, at every cylinder. */
export const STROKE_MS = 1000;
export const MAX_STEPS = 32;
export const SETTLE_ROUNDS = 64;

export interface State {
  ms: number;
  /** Each cylinder, 0 (retracted) … STROKE_MS (extended), whole ms. */
  travel: Record<string, number>;
  /** 1 extending, −1 retracting, 0 still. */
  motion: Record<string, -1 | 0 | 1>;
  /** Each 5/2 valve. */
  spools: Record<string, Side>;
  /** Each push button. */
  held: Record<string, Level>;
  /** Each net's pressure. */
  lines: Record<string, Level>;
  /** Each roller and push-button valve: 1 actuated. */
  made: Record<string, Level>;
}

export type PneumaticEvent =
  | { kind: "press" | "release"; part: string }
  | { kind: "made" | "freed"; part: string }
  | { kind: "shift"; part: string; to: Side }
  | { kind: "overlap"; part: string }
  | { kind: "line"; net: string; level: Level }
  | { kind: "start"; part: string; dir: 1 | -1 }
  | { kind: "end"; part: string; at: "retracted" | "extended" };

export interface Physics {
  /** The pins a valve joins in a state; `EXH` is an exhaust, `AIR` the supply. */
  passages(kind: PneumaticKind, state: Actuation): readonly (readonly [string, string])[];
  /** A double-pilot valve's side from its pilots and its side now. */
  pilot(p14: Level, p12: Level, now: Side): Side;
  /** A cylinder's drive from its ports: 1 extend, −1 retract, 0 hold. */
  drive(cap: Level, rod: Level): -1 | 0 | 1;
  /** Whether a roller valve is made: `atEnd` its cylinder sits at the roller's end, `away`/`toward` its motion. */
  made(atEnd: boolean, away: boolean, toward: boolean): boolean;
}

export const PHYSICS: Physics = {
  passages(kind, state) {
    switch (kind) {
      case "valve-52":
        return state === "14"
          ? [
              ["1", "4"],
              ["2", "EXH"],
            ]
          : [
              ["1", "2"],
              ["4", "EXH"],
            ];
      case "valve-32-roller":
      case "valve-32-button":
        return state === "made" ? [["1", "2"]] : [["2", "EXH"]];
      case "air-source":
        return [["t", "AIR"]];
      case "cylinder":
        return [];
    }
  },
  // Both pilots pressurised is a signal overlap: the valve keeps its side. Neither keeps it too.
  pilot: (p14, p12, now) => (p14 && !p12 ? "14" : p12 && !p14 ? "12" : now),
  drive: (cap, rod) => (cap && !rod ? 1 : rod && !cap ? -1 : 0),
  // A roller is made while its cylinder sits at that end and isn't setting off from it.
  made: (atEnd, away) => atEnd && !away,
};

export class CycleError extends Error {}
/** Supply and exhaust meet. */
export class ShortError extends CycleError {}

const clone = (s: State): State => ({
  ms: s.ms,
  travel: { ...s.travel },
  motion: { ...s.motion },
  spools: { ...s.spools },
  held: { ...s.held },
  lines: { ...s.lines },
  made: { ...s.made },
});

/** What a valve's passages join in its state, by pin (`VA.4`) or `AIR` / `EXH`. */
function passagesOf(
  model: PneumaticModel,
  spools: Readonly<Record<string, Side>>,
  made: Readonly<Record<string, Level>>,
  physics: Physics,
) {
  return model.parts.flatMap((p) => {
    const state: Actuation | undefined =
      p.kind === "valve-52"
        ? (spools[p.id] ?? "12")
        : p.kind === "valve-32-roller" || p.kind === "valve-32-button"
          ? made[p.id]
            ? "made"
            : "freed"
          : p.kind === "air-source"
            ? "made"
            : undefined;
    if (state === undefined) return [];
    return physics
      .passages(p.kind, state)
      .map(
        ([a, b]) =>
          [a === "EXH" || a === "AIR" ? a : `${p.id}.${a}`, b === "EXH" || b === "AIR" ? b : `${p.id}.${b}`] as const,
      );
  });
}

/** Every net's pressure: a net joined to the supply is 1, to an exhaust 0, and trapped air keeps its level. */
function pressures(
  model: PneumaticModel,
  spools: Readonly<Record<string, Side>>,
  made: Readonly<Record<string, Level>>,
  previous: Readonly<Record<string, Level>>,
  physics: Physics,
): Record<string, Level> {
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    const p = parent.get(k);
    if (p === undefined) {
      parent.set(k, k);
      return k;
    }
    if (p === k) return k;
    const root = find(p);
    parent.set(k, root);
    return root;
  };
  const union = (a: string, b: string) => parent.set(find(a), find(b));
  for (const net of model.nets) for (const pin of net.pins) union(pin, net.pins[0] as string);
  for (const [a, b] of passagesOf(model, spools, made, physics)) union(a, b);
  const [air, exh] = [find("AIR"), find("EXH")];
  if (air === exh) {
    const through = [...parent.keys()].filter((k) => k !== "AIR" && k !== "EXH" && find(k) === air).sort();
    throw new ShortError(`supply and exhaust meet through ${through.join(", ")}`);
  }
  return Object.fromEntries(
    model.nets.map((net): [string, Level] => {
      const root = find(net.pins[0] as string);
      return [net.id, root === air ? 1 : root === exh ? 0 : (previous[net.id] ?? 0)];
    }),
  );
}

/** Each roller's and button's actuation from where each cylinder is and how it moves. */
function madeOf(model: PneumaticModel, s: State, physics: Physics): Record<string, Level> {
  return Object.fromEntries(
    sensors(model).map((p): [string, Level] => {
      if (p.kind === "valve-32-button") return [p.id, s.held[p.id] ? 1 : 0];
      const mark = markOf(model, p.id);
      if (!mark) return [p.id, 0];
      const travel = s.travel[mark.cylinder] ?? 0;
      const motion = s.motion[mark.cylinder] ?? 0;
      const out = mark.end === "extended";
      const atEnd = out ? travel >= STROKE_MS : travel <= 0;
      const away = motion === (out ? -1 : 1);
      const toward = motion === (out ? 1 : -1);
      return [p.id, physics.made(atEnd, away, toward) ? 1 : 0];
    }),
  );
}

const lineAt = (model: PneumaticModel, lines: Readonly<Record<string, Level>>, pin: string): Level => {
  const net = netOf(model, pin);
  return net === undefined ? 0 : (lines[net] ?? 0);
};

/** The 5/2 valves whose two pilots are pressurised together. */
const overlapping = (model: PneumaticModel, lines: Readonly<Record<string, Level>>) =>
  new Set(
    valves52(model)
      .filter((v) => lineAt(model, lines, `${v.id}.14`) && lineAt(model, lines, `${v.id}.12`))
      .map((v) => v.id),
  );

/** Settles the circuit: rounds until no roller, line, spool or drive changes. */
function settle(model: PneumaticModel, from: State, physics: Physics): { state: State; events: PneumaticEvent[] } {
  let s = from;
  const events: PneumaticEvent[] = [];
  let lastChange = "";
  for (let round = 0; round < SETTLE_ROUNDS; round++) {
    const made = madeOf(model, s, physics);
    const lines = pressures(model, s.spools, made, s.lines, physics);
    const spools: Record<string, Side> = { ...s.spools };
    const shifts: PneumaticEvent[] = [];
    for (const v of valves52(model)) {
      const next = physics.pilot(
        lineAt(model, lines, `${v.id}.14`),
        lineAt(model, lines, `${v.id}.12`),
        s.spools[v.id] ?? "12",
      );
      if (next !== spools[v.id]) shifts.push({ kind: "shift", part: v.id, to: next });
      spools[v.id] = next;
    }
    const motion: Record<string, -1 | 0 | 1> = { ...s.motion };
    const starts: PneumaticEvent[] = [];
    for (const c of cylinders(model)) {
      let drive = physics.drive(lineAt(model, lines, `${c.id}.cap`), lineAt(model, lines, `${c.id}.rod`));
      const travel = s.travel[c.id] ?? 0;
      if ((drive === 1 && travel >= STROKE_MS) || (drive === -1 && travel <= 0)) drive = 0;
      if (drive !== 0 && drive !== motion[c.id]) starts.push({ kind: "start", part: c.id, dir: drive });
      motion[c.id] = drive;
    }
    const changes: PneumaticEvent[] = [];
    for (const p of sensors(model))
      if (made[p.id] !== s.made[p.id]) changes.push({ kind: made[p.id] ? "made" : "freed", part: p.id });
    for (const n of model.nets)
      if (lines[n.id] !== s.lines[n.id]) changes.push({ kind: "line", net: n.id, level: lines[n.id] as Level });
    const before = overlapping(model, s.lines);
    for (const id of overlapping(model, lines)) if (!before.has(id)) changes.push({ kind: "overlap", part: id });
    changes.push(...shifts, ...starts);
    const moved = cylinders(model).some((c) => motion[c.id] !== s.motion[c.id]);
    if (changes.length === 0 && !moved) return { state: s, events };
    events.push(...changes);
    // The first part that changed this round, named if the circuit never settles.
    const part = shifts[0] ?? starts[0] ?? changes.find((e) => e.kind === "made" || e.kind === "freed");
    lastChange =
      part && "part" in part
        ? `${part.part} keeps ${part.kind === "shift" ? "shifting" : "changing"}`
        : "a line keeps changing";
    s = { ...s, made, lines, spools, motion };
  }
  throw new CycleError(`the circuit doesn't settle: ${lastChange}`);
}

/** The circuit at rest as the figure draws it, with every button released, and what settling it did. */
export function restState(
  model: PneumaticModel,
  physics: Physics = PHYSICS,
): { state: State; events: PneumaticEvent[] } {
  const initial: State = {
    ms: 0,
    travel: Object.fromEntries(cylinders(model).map((c) => [c.id, restEnd(c) * STROKE_MS])),
    motion: Object.fromEntries(cylinders(model).map((c) => [c.id, 0 as const])),
    spools: Object.fromEntries(valves52(model).map((v) => [v.id, v.rest === "14" ? "14" : "12"] as const)),
    held: Object.fromEntries(model.parts.filter((p) => p.kind === "valve-32-button").map((p) => [p.id, 0 as Level])),
    lines: Object.fromEntries(model.nets.map((n) => [n.id, 0 as Level])),
    made: Object.fromEntries(sensors(model).map((p) => [p.id, 0 as Level])),
  };
  return settle(model, initial, physics);
}

/** Holds or lets go of a push button, and settles. Holding it as it already is changes nothing. */
export function setHeld(
  model: PneumaticModel,
  state: State,
  part: string,
  level: Level,
  physics: Physics = PHYSICS,
): { state: State; events: PneumaticEvent[] } {
  if ((state.held[part] ?? 0) === level) return { state, events: [] };
  const s = clone(state);
  s.held[part] = level;
  const settled = settle(model, s, physics);
  return { state: settled.state, events: [{ kind: level ? "press" : "release", part }, ...settled.events] };
}

/** Moves time on by `ms`, whole ms: pistons travel, and every stroke end, in time order, clamps, is reported and settles. */
export function advance(
  model: PneumaticModel,
  state: State,
  ms: number,
  physics: Physics = PHYSICS,
): { state: State; events: PneumaticEvent[] } {
  let s = state;
  const events: PneumaticEvent[] = [];
  let left = Math.max(0, Math.round(ms));
  for (let guard = 0; left > 0 && guard < 10_000; guard++) {
    const moving = cylinders(model).filter((c) => s.motion[c.id] !== 0);
    if (moving.length === 0) {
      s = { ...clone(s), ms: s.ms + left };
      break;
    }
    const toEnd = (id: string) => (s.motion[id] === 1 ? STROKE_MS - (s.travel[id] ?? 0) : (s.travel[id] ?? 0));
    const dt = Math.min(left, ...moving.map((c) => toEnd(c.id)));
    const next = clone(s);
    next.ms += dt;
    left -= dt;
    const ended: PneumaticEvent[] = [];
    for (const c of moving) {
      const travel = (s.travel[c.id] ?? 0) + (s.motion[c.id] ?? 0) * dt;
      next.travel[c.id] = travel;
      if (travel <= 0 || travel >= STROKE_MS) {
        next.travel[c.id] = travel <= 0 ? 0 : STROKE_MS;
        next.motion[c.id] = 0;
        ended.push({ kind: "end", part: c.id, at: travel <= 0 ? "retracted" : "extended" });
      }
    }
    s = next;
    if (ended.length > 0) {
      const settled = settle(model, s, physics);
      s = settled.state;
      events.push(...ended, ...settled.events);
    }
  }
  return { state: s, events };
}

export const isStill = (s: State) => Object.values(s.motion).every((m) => m === 0);

/** Time on to the earliest stroke end, exactly. A state with nothing moving is returned as it is. */
export function toNextStep(
  model: PneumaticModel,
  state: State,
  physics: Physics = PHYSICS,
): { state: State; events: PneumaticEvent[] } {
  const moving = cylinders(model).filter((c) => state.motion[c.id] !== 0);
  if (moving.length === 0) return { state, events: [] };
  const dt = Math.min(
    ...moving.map((c) =>
      state.motion[c.id] === 1 ? STROKE_MS - (state.travel[c.id] ?? 0) : (state.travel[c.id] ?? 0),
    ),
  );
  return advance(model, state, dt, physics);
}

/** Whether every cylinder sits at its rest end and every 5/2 valve on its rest side. */
export function atRest(model: PneumaticModel, s: State): boolean {
  return (
    cylinders(model).every((c) => s.travel[c.id] === restEnd(c) * STROKE_MS) &&
    valves52(model).every((v) => s.spools[v.id] === (v.rest === "14" ? "14" : "12"))
  );
}

/**
 * Whether a cycle has just come home: a stroke ended and every cylinder is back at its rest end. A
 * circuit that stops there is `atRest`; one a held button starts again by itself (its valves
 * already shifted for the next cycle) has come home all the same.
 */
export function cycleDone(model: PneumaticModel, s: State, events: readonly PneumaticEvent[]): boolean {
  return (
    events.some((e) => e.kind === "end") &&
    cylinders(model).every((c) => s.travel[c.id] === restEnd(c) * STROKE_MS) &&
    (!isStill(s) || atRest(model, s))
  );
}

/** The circuit at a step line: every cylinder at an end, with what drives it on. */
export interface StepState {
  cylinders: Record<string, Level>;
  motion: Record<string, -1 | 0 | 1>;
  spools: Record<string, Side>;
  lines: Record<string, Level>;
  made: Record<string, Level>;
}

/** The state at a step line; a cylinder mid-stroke has no level there. */
export function stepStateOf(model: PneumaticModel, s: State): StepState {
  return {
    cylinders: Object.fromEntries(
      cylinders(model).map((c): [string, Level] => {
        const travel = s.travel[c.id] ?? 0;
        if (travel === 0) return [c.id, 0];
        if (travel === STROKE_MS) return [c.id, 1];
        throw new CycleError(`cylinder ${c.id} is mid-stroke at a step line`);
      }),
    ),
    motion: { ...s.motion },
    spools: { ...s.spools },
    lines: { ...s.lines },
    made: { ...s.made },
  };
}

export interface Cycle {
  rest: StepState;
  restEvents: PneumaticEvent[];
  /** The state at each step line, from the press until the cycle is back at rest. */
  steps: StepState[];
  /** What happened to reach each step line. */
  events: PneumaticEvent[][];
  /** The movements the circuit started, in order (`A+`). */
  movements: string[];
  end: "rest" | "unstable" | "stall" | "runaway";
  /** Whether nothing moves any more at the end. */
  still: boolean;
  why?: string;
}

const movementName = (e: { part: string; dir: 1 | -1 }) => `${e.part}${e.dir === 1 ? "+" : "-"}`;
const startsOf = (events: readonly PneumaticEvent[]) =>
  events.flatMap((e) => (e.kind === "start" ? [movementName(e)] : []));

/** Presses the example's buttons at rest and follows the circuit, a stroke at a time, until it is back at rest. */
export function runCycle(
  model: PneumaticModel,
  held: Readonly<Record<string, number>> = {},
  physics: Physics = PHYSICS,
): Cycle {
  const start = restState(model, physics);
  const rest = stepStateOf(model, start.state);
  const moved = start.events.filter((e) => e.kind === "shift" || e.kind === "start");
  if (moved.length > 0)
    return {
      rest,
      restEvents: start.events,
      steps: [],
      events: [],
      movements: [],
      end: "unstable",
      still: isStill(start.state),
      why: stepCaption(model, moved),
    };
  let state = start.state;
  const first: PneumaticEvent[] = [];
  for (const [part, level] of Object.entries(held)) {
    if (level !== 1) continue;
    const r = setHeld(model, state, part, 1, physics);
    state = r.state;
    first.push(...r.events);
  }
  for (const part of model.press) {
    if ((state.held[part] ?? 0) === 1) continue;
    for (const level of [1, 0] as const) {
      const r = setHeld(model, state, part, level, physics);
      state = r.state;
      first.push(...r.events);
    }
  }
  const steps = [stepStateOf(model, state)];
  const events = [first];
  const movements = startsOf(first);
  const result = (end: Cycle["end"], why?: string): Cycle => ({
    rest,
    restEvents: start.events,
    steps,
    events,
    movements,
    end,
    still: isStill(state),
    ...(why === undefined ? {} : { why }),
  });
  for (;;) {
    const last = events.at(-1) ?? [];
    if (movements.length > 0 && cycleDone(model, state, last)) return result("rest");
    if (isStill(state)) {
      const overlap = last.findLast((e) => e.kind === "overlap");
      return result(
        "stall",
        overlap && "part" in overlap
          ? `${overlap.part} has both pilots pressurised (a signal overlap), so it can't shift`
          : "nothing moves any cylinder on",
      );
    }
    if (steps.length >= MAX_STEPS) return result("runaway");
    const next = toNextStep(model, state, physics);
    state = next.state;
    steps.push(stepStateOf(model, state));
    events.push(next.events);
    movements.push(...startsOf(next.events));
  }
}

/** Each cylinder in model order, then each signal net the model lists. */
export function timingRows(model: PneumaticModel): TimingRow[] {
  return [
    ...cylinders(model).map((c): TimingRow => ({ id: c.id, label: c.label ?? c.id, kind: "travel", at: "lines" })),
    ...model.signals.map((id): TimingRow => ({ id, label: `line ${id}`, kind: "signal", at: "intervals" })),
  ];
}

/**
 * The displacement-step diagram's quantities: each cylinder at every step line (`A[k]`), each signal
 * line during every movement (`I[k]`, the lines that drive movement k: the state just after step
 * line k's settle), so the diagram has one fewer interval than lines.
 */
export function stepDiagram(model: PneumaticModel, cycle: Cycle): Record<string, number> {
  const out: Record<string, number> = {};
  cycle.steps.forEach((step, i) => {
    for (const c of cylinders(model)) out[quantityOf(c.id, i + 1)] = step.cylinders[c.id] ?? 0;
    if (i < cycle.steps.length - 1) for (const id of model.signals) out[quantityOf(id, i + 1)] = step.lines[id] ?? 0;
  });
  return out;
}

/** The diagram drawn so far: the recorded step lines, and the movement under way. */
export function liveDiagram(
  model: PneumaticModel,
  recorded: readonly StepState[],
  s: State,
): { levels: Record<string, number>; now?: Now } {
  const levels: Record<string, number> = {};
  const m = recorded.length;
  const moving = !isStill(s);
  recorded.forEach((step, i) => {
    for (const c of cylinders(model)) levels[quantityOf(c.id, i + 1)] = step.cylinders[c.id] ?? 0;
    const interval = i + 1 < m || moving;
    if (interval) {
      const lines = i + 1 < m ? step.lines : s.lines;
      for (const id of model.signals) levels[quantityOf(id, i + 1)] = lines[id] ?? 0;
    }
  });
  if (!moving || m === 0) return { levels };
  const movingCylinders = cylinders(model).filter((c) => s.motion[c.id] !== 0);
  const progress = (id: string) => (s.motion[id] === 1 ? (s.travel[id] ?? 0) : STROKE_MS - (s.travel[id] ?? 0));
  return {
    levels,
    now: {
      line: m,
      fraction: Math.max(...movingCylinders.map((c) => progress(c.id))) / STROKE_MS,
      travel: Object.fromEntries(cylinders(model).map((c) => [c.id, (s.travel[c.id] ?? 0) / STROKE_MS])),
    },
  };
}

/** The diagram's quantities for the push buttons held; a circuit that doesn't run its cycle has none to give. */
export function quantities(model: PneumaticModel, held: Readonly<Record<string, number>>): Record<string, number> {
  const cycle = runCycle(model, held);
  if (cycle.end === "rest") return stepDiagram(model, cycle);
  throw new CycleError(
    cycle.end === "stall"
      ? `the cycle stalls: ${cycle.why}`
      : cycle.end === "unstable"
        ? `the circuit doesn't stay as drawn at rest: ${cycle.why}`
        : `the circuit doesn't come back to rest within ${MAX_STEPS} steps`,
  );
}
