// The ladder/FBD sim's engine: the Professor's networks run on the S7 core, scan after scan at the
// scan's time. Each network runs its acting elements (coils, timers, counters, boxes) in the
// model's order; the power reaching each one is read off the network at that moment, as power flow
// through its contacts and boxes from the rail (a net is the OR of what drives it). Every contact
// reads memory when its element runs, as the compiled STL reads it. A pure function of the model
// and the inputs over time: the same code in Node for the build gate and in the page.

import { splitPin } from "../layout/drawing.ts";
import {
  fromPattern,
  IecTon,
  parseCounterPreset,
  parseS5Time,
  parseTime,
  S5Counter,
  S5Timer,
  S7Memory,
  type S5TimerKind,
  type S7Type,
} from "../s7/core.ts";
import {
  driversOf,
  ELEMENTS,
  ladderProblems,
  netOf,
  networksOf,
  parseOperand,
  type LadderModel,
  type LadderPart,
  type Operand,
  type WatchType,
} from "./model.ts";

export type Bit = 0 | 1;
/** Input bits by operand, as a student or a gate case sets them. */
export type Inputs = Readonly<Record<string, number>>;

/** The S5 timer each coil and box kind runs. */
export const TIMER_KIND: Readonly<Partial<Record<string, S5TimerKind>>> = {
  "coil-sp": "SP",
  "coil-se": "SE",
  "coil-sd": "SD",
  "coil-ss": "SS",
  "coil-sf": "SF",
  "s-pulse": "SP",
  "s-pext": "SE",
  "s-odt": "SD",
  "s-odts": "SS",
  "s-offdt": "SF",
};

/**
 * How the engine runs each element. Only a negative control (`mutants.ts`) swaps one out, to prove
 * the gate sees the defect it plants.
 */
export interface Semantics {
  /** A contact or FBD element's output from its inputs and its operand's bit. */
  logic(kind: string, inputs: Bit[], operand: Bit): Bit;
  /** A net's level from what drives it. */
  join(levels: Bit[]): Bit;
  /** One S5 timer instruction. */
  timer(timer: S5Timer, kind: S5TimerKind, rlo: Bit, s5t: number, now: number): void;
  /** One TON call at the scan's time (ms). */
  ton(ton: IecTon, ms: number): void;
  countUp(counter: S5Counter, rlo: Bit): void;
}

export const SEMANTICS: Semantics = {
  logic(kind, inputs, operand) {
    const [a = 0, b = 0] = inputs;
    switch (kind) {
      case "no":
        return (a & operand) as Bit;
      case "nc":
        return (a & (operand ^ 1)) as Bit;
      case "fbd-and":
        return (a & b) as Bit;
      case "fbd-or":
        return (a | b) as Bit;
      case "fbd-not":
        return (a ^ 1) as Bit;
      default:
        return operand;
    }
  },
  join: (levels) => (levels.some((b) => b === 1) ? 1 : 0),
  timer: (timer, kind, rlo, s5t, now) => timer.run(kind, rlo, s5t, now),
  ton: (ton, ms) => ton.run(ms),
  countUp: (counter, rlo) => counter.countUp(rlo),
};

/** One scan as it ran: the time, every net's level as its element last read it, and memory after. */
export interface ScanState {
  ms: number;
  levels: Record<string, Bit>;
}

/** The state a timer, counter or TON is left in after a scan, as the gate compares it with awlsim's. */
export interface Timers {
  timers: Record<number, { status: Bit; running: boolean; remaining: number }>;
  counters: Record<number, number>;
  tons: Record<number, { IN: Bit; PT: number; Q: Bit; ET: number; STATE: number; STIME: number; ATIME: number }>;
}

/** The networks running scan after scan: memory, timers and counters persist. */
export class LadderRun {
  readonly model: LadderModel;
  readonly mem = new S7Memory();
  readonly timers = new Map<number, S5Timer>();
  readonly counters = new Map<number, S5Counter>();
  readonly tons = new Map<number, IecTon>();
  readonly semantics: Semantics;
  /** The last scan's time (ms), and the levels its elements read. */
  last: ScanState | undefined;

  constructor(model: LadderModel, semantics: Semantics = SEMANTICS) {
    const problems = ladderProblems(model);
    if (problems.length > 0) throw new Error(problems.join("; "));
    this.model = model;
    this.semantics = semantics;
  }

  private timer(n: number) {
    let t = this.timers.get(n);
    if (!t) this.timers.set(n, (t = new S5Timer()));
    return t;
  }

  private counter(n: number) {
    let c = this.counters.get(n);
    if (!c) this.counters.set(n, (c = new S5Counter()));
    return c;
  }

  private ton(n: number) {
    let t = this.tons.get(n);
    if (!t) this.tons.set(n, (t = new IecTon()));
    return t;
  }

  /** One scan at `ms` since the run began: the inputs are copied in, then each network runs. */
  scan(inputs: Inputs, ms: number): ScanState {
    for (const operand of this.model.inputs) {
      const value = inputs[operand];
      const o = parseOperand(operand);
      if (value === undefined || o?.kind !== "bit") continue;
      this.mem.write(o.address, value ? 1 : 0);
    }
    const now = ms / 1000.0;
    const levels: Record<string, Bit> = {};
    for (const { parts } of networksOf(this.model)) {
      /** Box outputs already run this scan, by part id. */
      const ran = new Set<string>();
      /**
       * Reading for the drawing only (an output no element reads, a dangling branch): a timer is
       * peeked, never settled, since the compiled STL reads nothing there and awlsim's state stays put.
       */
      let peeking = false;
      const timerBit = (n: number): Bit => (peeking ? this.timer(n).peek(now) : this.timer(n).get(now));
      const read = (o: Operand): Bit => {
        switch (o.kind) {
          case "bit":
            return this.mem.read(o.address) as Bit;
          case "timer":
            return timerBit(o.number);
          case "counter":
            return this.counter(o.number).get();
          default:
            return 0;
        }
      };
      /** A net's level now: the OR of its drivers, each worked out from the rail as power flow. */
      const level = (netId: string): Bit => {
        const net = this.model.nets.find((n) => n.id === netId);
        if (!net) return 0;
        const values = driversOf(this.model, net).map((pin) => output(splitPin(pin)[0]));
        const value = this.semantics.join(values);
        levels[netId] = value;
        return value;
      };
      const inputLevel = (part: LadderPart, pin: string): Bit | undefined => {
        const net = netOf(this.model, `${part.id}.${pin}`);
        if (!net || driversOf(this.model, net).length === 0) return undefined;
        return level(net.id);
      };
      const output = (id: string): Bit => {
        const part = this.model.parts.find((p) => p.id === id) as LadderPart;
        const operand = part.operand === undefined ? undefined : parseOperand(part.operand);
        switch (part.kind) {
          case "power-rail":
            return 1;
          case "s-pulse":
          case "s-pext":
          case "s-odt":
          case "s-odts":
          case "s-offdt":
            if (!ran.has(id)) throw new Error(`${id}'s Q is read before it runs`);
            return timerBit(numberOf(operand));
          case "s-cu":
          case "s-cd":
          case "s-cud":
            if (!ran.has(id)) throw new Error(`${id}'s Q is read before it runs`);
            return this.counter(numberOf(operand)).get();
          case "ton":
            if (!ran.has(id)) throw new Error(`${id}'s Q is read before it runs`);
            return this.ton(numberOf(operand)).Q;
          default: {
            const ins = ELEMENTS[part.kind].inputs.map((pin) => inputLevel(part, pin) ?? 0);
            return this.semantics.logic(part.kind, ins, operand ? read(operand) : 0);
          }
        }
      };
      /** The nets box outputs drive, inked from all their drivers once the network has run. */
      const boxOutputs = new Set<string>();
      for (const part of parts) {
        if (!ELEMENTS[part.kind].acts) continue;
        this.act(part, (pin) => inputLevel(part, pin), now, ms);
        ran.add(part.id);
        // Its output's net, as it now reads: what the inked drawing shows.
        const out = ELEMENTS[part.kind].output;
        const net = out && netOf(this.model, `${part.id}.${out}`);
        if (net) boxOutputs.add(net.id);
      }
      // A box's output line, and any net of this network no element read (a dangling branch), shows
      // as it reads at the network's end: the OR of all its drivers, every box among them run.
      const own = new Set(parts.map((p) => p.id));
      peeking = true;
      for (const net of this.model.nets)
        if (
          (!(net.id in levels) || boxOutputs.has(net.id)) &&
          net.pins.some((pin) => own.has(splitPin(pin)[0])) &&
          driversOf(this.model, net).length > 0
        )
          level(net.id);
      peeking = false;
    }
    for (const net of this.model.nets) if (!(net.id in levels)) levels[net.id] = 0;
    this.last = { ms, levels };
    return this.last;
  }

  /** An acting element: writes its operand, or runs its timer or counter, with the power reaching each input. */
  private act(part: LadderPart, power: (pin: string) => Bit | undefined, now: number, ms: number) {
    const operand = parseOperand(part.operand ?? "") as Operand;
    const params = part.params ?? {};
    const store = (slot: string, value: number) => {
      const target = params[slot] === undefined ? undefined : parseOperand(params[slot]);
      if (target && (target.kind === "word" || target.kind === "dword")) this.mem.write(target.address, value >>> 0);
    };
    const kind = part.kind;
    const timerKind = TIMER_KIND[kind];
    if (kind === "coil" || kind === "fbd-assign") {
      if (operand.kind === "bit") this.mem.write(operand.address, power("in") ?? 0);
    } else if (kind === "coil-s" || kind === "fbd-s" || kind === "coil-r" || kind === "fbd-r") {
      if (operand.kind === "bit" && power("in") === 1)
        this.mem.write(operand.address, kind === "coil-s" || kind === "fbd-s" ? 1 : 0);
    } else if (timerKind && kind.startsWith("coil")) {
      this.semantics.timer(
        this.timer(numberOf(operand)),
        timerKind,
        power("in") ?? 0,
        parseS5Time(params.preset ?? ""),
        now,
      );
    } else if (timerKind) {
      const timer = this.timer(numberOf(operand));
      this.semantics.timer(timer, timerKind, power("S") ?? 0, parseS5Time(params.TV ?? ""), now);
      const r = power("R");
      if (r === 1) timer.reset();
      if (params.BI !== undefined) store("BI", timer.valueBin(now));
      if (params.BCD !== undefined) store("BCD", timer.valueBcd(now));
    } else if (kind === "coil-cu") this.semantics.countUp(this.counter(numberOf(operand)), power("in") ?? 0);
    else if (kind === "coil-cd") this.counter(numberOf(operand)).countDown(power("in") ?? 0);
    else if (kind === "coil-sc")
      this.counter(numberOf(operand)).set(power("in") ?? 0, parseCounterPreset(params.preset ?? ""));
    else if (kind === "s-cu" || kind === "s-cd" || kind === "s-cud") {
      // Each input is read just before its instruction runs, in STEP 7's order: CU, CD, S, R.
      const counter = this.counter(numberOf(operand));
      const cu = power("CU");
      if (cu !== undefined) this.semantics.countUp(counter, cu);
      const cd = power("CD");
      if (cd !== undefined) counter.countDown(cd);
      const s = params.PV === undefined ? undefined : power("S");
      if (s !== undefined && params.PV !== undefined) counter.set(s, parseCounterPreset(params.PV));
      if (power("R") === 1) counter.reset();
      if (params.CV !== undefined) store("CV", counter.valueBin());
      if (params.CV_BCD !== undefined) store("CV_BCD", counter.valueBcd());
    } else if (kind === "ton") {
      const ton = this.ton(numberOf(operand));
      ton.IN = power("IN") ?? 0;
      ton.PT = parseTime(params.PT ?? "");
      this.semantics.ton(ton, ms);
      if (params.ET !== undefined) store("ET", ton.ET);
    }
  }

  /** Every timer, counter and TON the run has touched, as awlsim keeps them. */
  state(): Timers {
    const sorted = <T>(m: Map<number, T>) => [...m].sort(([a], [b]) => a - b);
    return {
      timers: Object.fromEntries(
        sorted(this.timers).map(([n, t]) => [n, { status: t.status, running: t.running, remaining: t.remaining }]),
      ),
      counters: Object.fromEntries(sorted(this.counters).map(([n, c]) => [n, c.value])),
      tons: Object.fromEntries(
        sorted(this.tons).map(([n, t]) => [
          n,
          { IN: t.IN, PT: t.PT, Q: t.Q, ET: t.ET, STATE: t.STATE, STIME: t.STIME, ATIME: t.ATIME },
        ]),
      ),
    };
  }

  /** The watch table now, by operand. */
  watch(): Record<string, number> {
    return watchValues(this.mem, this.model);
  }
}

const numberOf = (o: Operand | undefined) => (o && "number" in o ? o.number : 0);

const S7_TYPE: Record<WatchType, S7Type> = { BOOL: "BOOL", INT: "INT", WORD: "WORD", DINT: "DINT", TIME: "DINT" };

/** The watch table's values in memory, by operand. */
export function watchValues(mem: S7Memory, model: Pick<LadderModel, "watch">): Record<string, number> {
  return Object.fromEntries(
    Object.entries(model.watch).map(([operand, type]) => {
      const o = parseOperand(operand);
      const address = o && "address" in o ? o.address : undefined;
      return [operand, address ? fromPattern(S7_TYPE[type], mem.read(address)) : 0];
    }),
  );
}

/** A timeline: inputs as they start, then each change at its time, scanned every `cycle` ms up to `until`. */
export interface Timeline {
  until: number;
  events: readonly { at: number; set: Inputs }[];
}

/** The inputs before each scan of a timeline, with each scan's time. */
export function scansOf(start: Inputs, timeline: Timeline, cycle: number): { ms: number; inputs: Inputs }[] {
  const scans: { ms: number; inputs: Inputs }[] = [];
  let held: Inputs = start;
  for (let ms = 0; ms <= timeline.until; ms += cycle) {
    for (const event of timeline.events) if (event.at === ms) held = { ...held, ...event.set };
    scans.push({ ms, inputs: held });
  }
  return scans;
}

/** A gate case: a timeline from a fresh CPU. */
export interface GateCase {
  name: string;
  scans: { ms: number; inputs: Inputs }[];
}

/** One scan of a case as the engine ran it: memory, timers and counters after it. */
export interface ScanResult {
  ms: number;
  levels: Record<string, Bit>;
  memory: Record<"I" | "Q" | "M", Uint8Array>;
  state: Timers;
}

/** Runs a case on a fresh CPU. */
export function runCase(model: LadderModel, c: GateCase, semantics: Semantics = SEMANTICS): ScanResult[] {
  const run = new LadderRun(model, semantics);
  return c.scans.map(({ ms, inputs }) => {
    const { levels } = run.scan(inputs, ms);
    const m = run.mem.areas;
    return { ms, levels, memory: { I: m.I.slice(), Q: m.Q.slice(), M: m.M.slice() }, state: run.state() };
  });
}

/** The name the sheet and the logs give a watched value at a time: `Q 4.1@6000`. */
export const quantityName = (operand: string, ms: number) => `${operand}@${ms}`;

/** Every watched value after every scan of the example's timeline. */
export function quantities(
  model: LadderModel,
  start: Inputs,
  timeline: Timeline,
  cycle: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  const run = new LadderRun(model);
  for (const { ms, inputs } of scansOf(start, timeline, cycle)) {
    run.scan(inputs, ms);
    for (const [operand, value] of Object.entries(run.watch())) out[quantityName(operand, ms)] = value;
  }
  return out;
}

/** A range a student tunes an input over (a bit: 0 to 1). */
export interface TuneRange {
  min: number;
  max: number;
  step: number;
}

/**
 * The cases the build runs through the engine and awlsim: the example's timeline, the same with
 * each tuned input held at its min and its max from the start, and the timelines the builder wrote.
 */
export function gateCases(
  start: Inputs,
  tune: Readonly<Record<string, TuneRange>>,
  example: Timeline,
  written: readonly ({ name: string } & Timeline)[],
  cycle: number,
): GateCase[] {
  const cases: GateCase[] = [{ name: "the example's timeline", scans: scansOf(start, example, cycle) }];
  for (const [operand, range] of Object.entries(tune)) {
    for (const [end, value] of [
      ["min", range.min],
      ["max", range.max],
    ] as const) {
      // Only an input the example already holds at this value all along is the example itself.
      const changes = example.events.some((e) => operand in e.set && e.set[operand] !== start[operand]);
      if (value === start[operand] && !changes) continue;
      // The input held at the end all along: the example's other changes still happen.
      const events = example.events.map((e) => ({ ...e, set: { ...e.set, [operand]: value } }));
      cases.push({
        name: `${operand} held at ${value} (its ${end})`,
        scans: scansOf({ ...start, [operand]: value }, { until: example.until, events }, cycle),
      });
    }
  }
  for (const c of written) cases.push({ name: c.name, scans: scansOf(start, c, cycle) });
  return cases;
}
