// What a ladder (LAD) or function block diagram (FBD) sim holds: the Professor's networks as a
// netlist of PLC symbols, each element with the operand it reads or writes, and what students set
// and watch. The same model is drawn by the layout core (`schematicOf`), run by the engine on the S7
// core, and compiled to STL for awlsim, the build oracle. Every element reads left to right: power
// enters a contact's `in` and leaves its `out`, a net is the OR of everything that drives it (a
// ladder's parallel branches), and a coil or a box acts on the power reaching it.

import { splitPin, type ModelNet, type SchematicModel } from "../layout/drawing.ts";
import type { SymbolKind } from "../layout/symbols.ts";
import { parseAddress, parseCounterPreset, parseS5Time, parseTime, type Address } from "../s7/core.ts";

/** The PLC pack's symbols an element may be drawn with. */
export const PLC_KINDS = [
  "power-rail",
  "no",
  "nc",
  "coil",
  "coil-s",
  "coil-r",
  "coil-sp",
  "coil-se",
  "coil-sd",
  "coil-ss",
  "coil-sf",
  "coil-cu",
  "coil-cd",
  "coil-sc",
  "s-pulse",
  "s-pext",
  "s-odt",
  "s-odts",
  "s-offdt",
  "s-cu",
  "s-cd",
  "s-cud",
  "ton",
  "fbd-in",
  "fbd-and",
  "fbd-or",
  "fbd-not",
  "fbd-assign",
  "fbd-s",
  "fbd-r",
] as const satisfies readonly SymbolKind[];
export type PlcKind = (typeof PLC_KINDS)[number];

/** The kinds only a ladder draws, and the ones only an FBD draws; the boxes and coils of timers are shared. */
const LAD_ONLY = new Set<PlcKind>(["power-rail", "no", "nc", "coil", "coil-s", "coil-r"]);
const FBD_ONLY = new Set<PlcKind>(["fbd-in", "fbd-and", "fbd-or", "fbd-not", "fbd-assign", "fbd-s", "fbd-r"]);
export const LANGUAGES = ["LAD", "FBD"] as const;
export type Language = (typeof LANGUAGES)[number];

/** What an operand names: a bit, a word or double word, an S5 timer or counter, or a TON's instance DB. */
export type Operand =
  | { kind: "bit"; address: Address }
  | { kind: "word"; address: Address }
  | { kind: "dword"; address: Address }
  | { kind: "timer"; number: number }
  | { kind: "counter"; number: number }
  | { kind: "db"; number: number };

/** `I 0.0`, `MW 10`, `MD 20`, `T 1`, `C 1`, `DB 1` (spaces optional), or `undefined`. */
export function parseOperand(text: string): Operand | undefined {
  const numbered = /^(T|C|DB)\s*(\d+)$/i.exec(text.trim());
  if (numbered) {
    const number = Number(numbered[2]);
    const kind = { T: "timer", C: "counter", DB: "db" }[(numbered[1] ?? "").toUpperCase()] as
      "timer" | "counter" | "db";
    return number >= 1 && number <= 255 ? { kind, number } : undefined;
  }
  const address = parseAddress(text);
  if (!address || address.peripheral) return undefined;
  if (address.width === "bit") return { kind: "bit", address };
  if (address.width === "word") return { kind: "word", address };
  if (address.width === "dword") return { kind: "dword", address };
  return undefined;
}

/** The role each kind plays in a network, and what it needs. */
interface Element {
  /** Pins power or a signal enters by. */
  inputs: readonly string[];
  /** The pin it drives, if any. */
  output?: string;
  /** What its operand must be: none, a bit it reads, a bit it writes, a timer, a counter, a TON's DB. */
  operand: "none" | "read" | "write" | "timer" | "counter" | "db";
  /** Its values, each a constant or an operand, by slot: `true` when the element can't run without it. */
  params: Readonly<Record<string, { value: "s5time" | "time" | "count" | "word" | "dword"; required: boolean }>>;
  /** Whether it acts (writes, runs a timer or counter): it runs in the network's order. */
  acts: boolean;
}

const contact: Element = { inputs: ["in"], output: "out", operand: "read", params: {}, acts: false };
const writes = (pin: string): Element => ({ inputs: [pin], operand: "write", params: {}, acts: true });
const timerCoil: Element = {
  inputs: ["in"],
  operand: "timer",
  params: { preset: { value: "s5time", required: true } },
  acts: true,
};
const counterCoil = (preset: boolean): Element => ({
  inputs: ["in"],
  operand: "counter",
  params: preset ? { preset: { value: "count", required: true } } : {},
  acts: true,
});
const timerBox: Element = {
  inputs: ["S", "R"],
  output: "Q",
  operand: "timer",
  params: {
    TV: { value: "s5time", required: true },
    BI: { value: "word", required: false },
    BCD: { value: "word", required: false },
  },
  acts: true,
};
const counterBox = (pins: readonly string[]): Element => ({
  inputs: [...pins, "S", "R"],
  output: "Q",
  operand: "counter",
  params: {
    PV: { value: "count", required: false },
    CV: { value: "word", required: false },
    CV_BCD: { value: "word", required: false },
  },
  acts: true,
});

export const ELEMENTS: Readonly<Record<PlcKind, Element>> = {
  "power-rail": { inputs: [], output: "t", operand: "none", params: {}, acts: false },
  no: contact,
  nc: contact,
  coil: writes("in"),
  "coil-s": writes("in"),
  "coil-r": writes("in"),
  "coil-sp": timerCoil,
  "coil-se": timerCoil,
  "coil-sd": timerCoil,
  "coil-ss": timerCoil,
  "coil-sf": timerCoil,
  "coil-cu": counterCoil(false),
  "coil-cd": counterCoil(false),
  "coil-sc": counterCoil(true),
  "s-pulse": timerBox,
  "s-pext": timerBox,
  "s-odt": timerBox,
  "s-odts": timerBox,
  "s-offdt": timerBox,
  "s-cu": counterBox(["CU"]),
  "s-cd": counterBox(["CD"]),
  "s-cud": counterBox(["CU", "CD"]),
  ton: {
    inputs: ["IN"],
    output: "Q",
    operand: "db",
    params: { PT: { value: "time", required: true }, ET: { value: "dword", required: false } },
    acts: true,
  },
  "fbd-in": { inputs: [], output: "t", operand: "read", params: {}, acts: false },
  "fbd-and": { inputs: ["in1", "in2"], output: "out", operand: "none", params: {}, acts: false },
  "fbd-or": { inputs: ["in1", "in2"], output: "out", operand: "none", params: {}, acts: false },
  "fbd-not": { inputs: ["in"], output: "out", operand: "none", params: {}, acts: false },
  "fbd-assign": writes("in"),
  "fbd-s": writes("in"),
  "fbd-r": writes("in"),
};

export interface LadderPart {
  /** The builder's name for the element (unique in the model); the figure never prints it. */
  id: string;
  kind: PlcKind;
  /** The network it sits in, as the figure numbers them. */
  network: number;
  /** What it reads or writes: `I 0.0`, `Q 4.0`, `T 1`, `C 1`, `DB 1`. */
  operand?: string | undefined;
  /** What the figure prints above it, when not the operand itself (a symbolic name). */
  label?: string | undefined;
  /** Its values by slot: a timer's TV or PT, a counter's PV, the words BI, BCD, CV, ET go to. */
  params?: Readonly<Record<string, string>> | undefined;
}

/** The types a watched operand is shown as. A TIME is a DINT of milliseconds. */
export const WATCH_TYPES = ["BOOL", "INT", "WORD", "DINT", "TIME"] as const;
export type WatchType = (typeof WATCH_TYPES)[number];

export interface LadderModel {
  language: Language;
  parts: readonly LadderPart[];
  nets: readonly ModelNet[];
  /** The input bits students (and the gate's cases) set, in the order the controls show them. */
  inputs: readonly string[];
  /** The operands shown after each scan, with their types. */
  watch: Readonly<Record<string, WatchType>>;
}

/** A Blind reader's key for a part of an editor screenshot: `N1 no I 0.0`, ` #2` on a repeat in its network. */
export function screenshotKeys(model: Pick<LadderModel, "parts">): Map<string, string> {
  const keys = new Map<string, string>();
  const seen = new Map<string, number>();
  for (const part of model.parts) {
    if (part.kind === "power-rail") continue;
    const printed = part.label ?? part.operand;
    if (printed === undefined) continue;
    const base = `N${part.network} ${part.kind} ${printed}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    keys.set(part.id, n === 1 ? base : `${base} #${n}`);
  }
  return keys;
}

/** The model as the layout core draws it: each part's printed label, its values in its slots, and its key. */
export function schematicOf(model: Pick<LadderModel, "parts" | "nets">): SchematicModel {
  const keys = screenshotKeys(model);
  return {
    parts: model.parts.map((p) => ({
      id: p.id,
      kind: p.kind,
      ...(p.kind === "power-rail" ? {} : { label: p.label ?? p.operand }),
      ...(p.params && Object.keys(p.params).length > 0 ? { notes: p.params } : {}),
      ...(keys.has(p.id) ? { key: keys.get(p.id) } : {}),
    })),
    nets: model.nets,
  };
}

/** The net a pin is on. */
export const netOf = (model: Pick<LadderModel, "nets">, pin: string) => model.nets.find((n) => n.pins.includes(pin));

/** The pins that drive a net: element outputs. */
export function driversOf(model: Pick<LadderModel, "parts">, net: ModelNet): string[] {
  const kinds = new Map(model.parts.map((p) => [p.id, p.kind]));
  return net.pins.filter((pin) => {
    const [id, name] = splitPin(pin);
    const kind = kinds.get(id);
    return kind !== undefined && ELEMENTS[kind].output === name;
  });
}

/** The networks in order, each with its parts in the model's order. */
export function networksOf(model: Pick<LadderModel, "parts">): { network: number; parts: LadderPart[] }[] {
  const numbers = [...new Set(model.parts.map((p) => p.network))].sort((a, b) => a - b);
  return numbers.map((network) => ({ network, parts: model.parts.filter((p) => p.network === network) }));
}

/** A param's value checked against what it must be, or why it isn't one. */
function paramProblem(value: string, want: Element["params"][string]["value"]): string | undefined {
  try {
    switch (want) {
      case "s5time":
        parseS5Time(value);
        return undefined;
      case "time":
        return parseTime(value) > 0 ? undefined : "a TON's PT is above 0";
      case "count":
        parseCounterPreset(value);
        return undefined;
      case "word":
      case "dword": {
        const o = parseOperand(value);
        return o?.kind === want ? undefined : `isn't a ${want} operand like ${want === "word" ? "MW 10" : "MD 20"}`;
      }
    }
  } catch (error) {
    return (error as Error).message;
  }
}

/** What breaks the model as a PLC program, one line each: the engine can't run it until none do. */
export function ladderProblems(model: LadderModel): string[] {
  const out: string[] = [];
  const byId = new Map(model.parts.map((p) => [p.id, p]));
  for (const part of model.parts) {
    const at = `${part.id} (${part.kind}, network ${part.network})`;
    if (model.language === "LAD" && FBD_ONLY.has(part.kind)) out.push(`${at} is an FBD element in a LAD sim`);
    if (model.language === "FBD" && LAD_ONLY.has(part.kind)) out.push(`${at} is a LAD element in an FBD sim`);
    const element = ELEMENTS[part.kind];
    const operand = part.operand === undefined ? undefined : parseOperand(part.operand);
    if (element.operand === "none") {
      if (part.operand !== undefined) out.push(`${at} takes no operand, but names ${part.operand}`);
    } else if (part.operand === undefined) out.push(`${at} needs an operand`);
    else if (!operand) out.push(`${at}: "${part.operand}" isn't an operand like I 0.0, Q 4.0, T 1, C 1 or DB 1`);
    else {
      const fits =
        element.operand === "read"
          ? operand.kind === "bit" || operand.kind === "timer" || operand.kind === "counter"
          : element.operand === "write"
            ? operand.kind === "bit" && operand.address.area !== "I"
            : operand.kind === { timer: "timer", counter: "counter", db: "db" }[element.operand];
      if (!fits)
        out.push(
          `${at}: ${part.operand} can't be its operand (it ${
            element.operand === "read"
              ? "reads a bit, a timer or a counter"
              : element.operand === "write"
                ? "writes an output or memory bit"
                : `needs ${element.operand === "db" ? "an instance DB" : `a ${element.operand}`}`
          })`,
        );
    }
    for (const [slot, value] of Object.entries(part.params ?? {})) {
      const want = element.params[slot];
      if (!want) {
        out.push(`${at} has no ${slot}`);
        continue;
      }
      const problem = paramProblem(value, want.value);
      if (problem)
        out.push(`${at}: ${slot} "${value}" ${problem.startsWith("isn't") ? problem : `isn't one: ${problem}`}`);
    }
    for (const [slot, want] of Object.entries(element.params))
      if (want.required && part.params?.[slot] === undefined) out.push(`${at} needs its ${slot}`);
    if (part.kind.startsWith("s-c") && part.params?.PV === undefined) {
      const s = netOf(model, `${part.id}.S`);
      if (s && s.pins.length > 1) out.push(`${at} sets its count from S, so it needs its PV`);
    }
  }

  // Each net: one driver at most in an FBD (a ladder's parallel branches OR together), and every
  // input an element needs is driven by something.
  for (const net of model.nets) {
    const drivers = driversOf(model, net);
    if (model.language === "FBD" && drivers.length > 1)
      out.push(`net ${net.id} has ${drivers.length} drivers (${drivers.join(", ")}): an FBD line has one source`);
    const inputs = net.pins.filter((pin) => {
      const [id, name] = splitPin(pin);
      const part = byId.get(id);
      return part !== undefined && ELEMENTS[part.kind].inputs.includes(name);
    });
    if (drivers.length === 0 && inputs.length > 0) {
      const needed = inputs.filter((pin) => !OPTIONAL_INPUTS.has(splitPin(pin)[1]));
      if (needed.length > 0) out.push(`net ${net.id} feeds ${needed.join(", ")} but nothing drives it`);
    }
    const networks = new Set(net.pins.map((pin) => byId.get(splitPin(pin)[0])?.network));
    const rails = net.pins.some((pin) => byId.get(splitPin(pin)[0])?.kind === "power-rail");
    if (networks.size > 1 && !rails) out.push(`net ${net.id} joins networks ${[...networks].join(" and ")}`);
  }

  for (const id of model.inputs) {
    const o = parseOperand(id);
    if (o?.kind !== "bit" || o.address.area !== "I") out.push(`input ${id} isn't an input bit like I 0.0`);
  }
  for (const [operand, type] of Object.entries(model.watch)) {
    const o = parseOperand(operand);
    const width = { BOOL: "bit", INT: "word", WORD: "word", DINT: "dword", TIME: "dword" }[type];
    if (!o || o.kind !== width) out.push(`watched ${operand} can't be shown as a ${type}`);
  }

  if (out.length === 0) out.push(...orderProblems(model));
  return out;
}

/** Inputs a box may leave open: an unwired R never resets, an unwired S never sets. */
const OPTIONAL_INPUTS = new Set(["R", "S", "CU", "CD"]);

/**
 * The networks must settle in one pass, as STEP 7's compiled networks do: no element's input
 * depends on its own output, and a box's output is read only by elements after it in the model.
 */
function orderProblems(model: LadderModel): string[] {
  const out: string[] = [];
  for (const { network, parts } of networksOf(model)) {
    const order = new Map(parts.map((p, i) => [p.id, i]));
    // Every part an element's inputs reach back to, through the drivers of each net.
    const upstream = (start: LadderPart): Set<string> => {
      const seen = new Set<string>();
      const stack = [start];
      while (stack.length > 0) {
        const part = stack.pop() as LadderPart;
        for (const pin of ELEMENTS[part.kind].inputs) {
          const net = netOf(model, `${part.id}.${pin}`);
          if (!net) continue;
          for (const driver of driversOf(model, net)) {
            const [id] = splitPin(driver);
            if (seen.has(id)) continue;
            seen.add(id);
            const next = parts.find((p) => p.id === id);
            if (next) stack.push(next);
          }
        }
      }
      return seen;
    };
    for (const part of parts) {
      const up = upstream(part);
      if (up.has(part.id)) {
        out.push(`network ${network}: ${part.id} feeds itself round a loop; a network settles in one pass`);
        continue;
      }
      if (!ELEMENTS[part.kind].acts) continue;
      for (const id of up) {
        const other = parts.find((p) => p.id === id);
        if (other && ELEMENTS[other.kind].acts && (order.get(id) ?? 0) > (order.get(part.id) ?? 0))
          out.push(`network ${network}: ${part.id} reads ${id}'s output, so ${id} comes before it in the model`);
      }
    }
  }
  return out;
}
