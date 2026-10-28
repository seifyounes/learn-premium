// A pneumatic circuit as the engine reads it: the parts and nets of the figure (a netlist of the
// pneumatic pack), the movements the Materials state, the push buttons the example presses and the
// group lines its timing diagram draws. The content contract's output is assignable to these types
// as written; this file imports nothing from the contract.
import { splitPin } from "../layout/drawing.ts";
import type { PneumaticKind } from "../layout/pneumatic.ts";

export type Level = 0 | 1;
/** The side a 5/2 valve's spool is shifted to, by the pilot port that put it there. */
export type Side = "12" | "14";
export type StrokeEnd = "retracted" | "extended";

export interface PneumaticPart {
  id: string;
  kind: PneumaticKind;
  label?: string | undefined;
  /** A cylinder's marks: keys `retracted` / `extended`, each the roller valve the figure prints at that end. */
  notes?: Readonly<Record<string, string>> | undefined;
  /** Where the figure draws it at rest: a cylinder's end, a 5/2 valve's pilot side. */
  rest?: StrokeEnd | Side | undefined;
}

export interface PneumaticModel {
  parts: readonly PneumaticPart[];
  nets: readonly { id: string; pins: readonly string[] }[];
  /** The movements the Materials state, in order: `A+` extends cylinder A, `A-` retracts it. */
  sequence: readonly string[];
  /** The push buttons the example presses once, at rest, to run the cycle. */
  press: readonly string[];
  /** The nets the timing diagram draws as signal rows, beside every cylinder. */
  signals: readonly string[];
}

const ENDS = ["retracted", "extended"] as const;

interface Index {
  net: Map<string, string>;
  cylinders: PneumaticPart[];
  valves52: PneumaticPart[];
  sensors: PneumaticPart[];
  airs: PneumaticPart[];
  marks: Map<string, { cylinder: string; end: StrokeEnd }>;
}

const indexes = new WeakMap<PneumaticModel, Index>();

function indexOf(model: PneumaticModel): Index {
  const cached = indexes.get(model);
  if (cached) return cached;
  const net = new Map<string, string>();
  for (const n of model.nets) for (const pin of n.pins) net.set(pin, n.id);
  const marks = new Map<string, { cylinder: string; end: StrokeEnd }>();
  const rollers = model.parts.filter((p) => p.kind === "valve-32-roller");
  for (const c of model.parts.filter((p) => p.kind === "cylinder"))
    for (const end of ENDS) {
      const label = c.notes?.[end];
      const roller = label === undefined ? undefined : rollers.find((r) => r.label === label);
      if (roller && !marks.has(roller.id)) marks.set(roller.id, { cylinder: c.id, end });
    }
  const index: Index = {
    net,
    cylinders: model.parts.filter((p) => p.kind === "cylinder"),
    valves52: model.parts.filter((p) => p.kind === "valve-52"),
    sensors: model.parts.filter((p) => p.kind === "valve-32-roller" || p.kind === "valve-32-button"),
    airs: model.parts.filter((p) => p.kind === "air-source"),
    marks,
  };
  indexes.set(model, index);
  return index;
}

/** The net a pin (`VA.14`) is in. */
export const netOf = (model: PneumaticModel, pin: string): string | undefined => indexOf(model).net.get(pin);
export const cylinders = (model: PneumaticModel) => indexOf(model).cylinders;
export const valves52 = (model: PneumaticModel) => indexOf(model).valves52;
/** The 3/2 valves, roller and push button, in model order. */
export const sensors = (model: PneumaticModel) => indexOf(model).sensors;
export const airSources = (model: PneumaticModel) => indexOf(model).airs;

/** Each roller valve's cylinder and end, read off the cylinders' marks: the roller whose label a cylinder prints at an end. */
export const markOf = (model: PneumaticModel, roller: string) => indexOf(model).marks.get(roller);

/** A cylinder's rest end as a position: 0 retracted, 1 extended. */
export const restEnd = (part: PneumaticPart): Level => (part.rest === "extended" ? 1 : 0);

/** A movement as the model writes it: `A+` → cylinder A, extending. */
export function movementOf(movement: string): { cylinder: string; dir: 1 | -1 } {
  return { cylinder: movement.slice(0, -1), dir: movement.endsWith("+") ? 1 : -1 };
}

/** Control lines, drawn dashed: every net with no cylinder port and no air source on it. */
export function controlNets(model: PneumaticModel): Set<string> {
  const working = new Set<string>();
  for (const n of model.nets)
    for (const pin of n.pins) {
      const part = model.parts.find((p) => p.id === splitPin(pin)[0]);
      if (part?.kind === "cylinder" || part?.kind === "air-source") working.add(n.id);
    }
  return new Set(model.nets.map((n) => n.id).filter((id) => !working.has(id)));
}

export function pneumaticProblems(model: PneumaticModel): string[] {
  const out: string[] = [];
  const add = (message: string) => {
    if (!out.includes(message)) out.push(message);
  };
  const rests = "only a cylinder (retracted, extended) or a 5/2 valve (12, 14) has a rest";
  for (const p of model.parts) {
    if (p.kind === "cylinder" && p.rest === undefined)
      add(`cylinder ${p.id} states no rest end: the figure draws it retracted or extended`);
  }
  for (const p of model.parts) {
    if (p.kind === "valve-52" && p.rest === undefined)
      add(`5/2 valve ${p.id} states no rest side: the figure draws it on its 12 or 14 side`);
  }
  for (const p of model.parts) {
    if (p.rest === undefined) continue;
    const fits =
      p.kind === "cylinder"
        ? p.rest === "retracted" || p.rest === "extended"
        : p.kind === "valve-52" && (p.rest === "12" || p.rest === "14");
    if (!fits) add(`${p.id} is a ${p.kind}: ${rests}`);
  }
  for (const p of model.parts)
    if (p.kind !== "cylinder" && Object.keys(p.notes ?? {}).length > 0)
      add(`${p.id} prints marks, but only a cylinder prints stroke-end marks`);
  for (const p of model.parts)
    for (const key of Object.keys(p.kind === "cylinder" ? (p.notes ?? {}) : {}))
      if (!(ENDS as readonly string[]).includes(key))
        add(`cylinder ${p.id} marks ${key}, which is no stroke end: its marks are retracted and extended`);
  const rollers = model.parts.filter((p) => p.kind === "valve-32-roller");
  const markedAt = (label: string) =>
    cylinders(model).flatMap((c) => ENDS.filter((end) => c.notes?.[end] === label).map((end) => `${c.id}.${end}`));
  for (const r of rollers) {
    if (r.label === undefined)
      add(`roller valve ${r.id} has no label: its label is how the figure ties it to a stroke end`);
    else {
      const at = markedAt(r.label);
      if (at.length === 0)
        add(`roller valve ${r.id} is marked at no cylinder's stroke end: the figure shows where each roller sits`);
    }
  }
  for (const r of rollers)
    if (r.label !== undefined && markedAt(r.label).length > 1) add(`roller valve ${r.id} is marked at two stroke ends`);
  for (const c of cylinders(model))
    for (const end of ENDS) {
      const mark = c.notes?.[end];
      if (mark !== undefined && !rollers.some((r) => r.label === mark))
        add(`cylinder ${c.id}'s mark ${mark} names no roller valve`);
    }
  const ids = new Set(cylinders(model).map((c) => c.id));
  const moves = model.sequence.map(movementOf);
  for (const m of model.sequence) if (!ids.has(movementOf(m).cylinder)) add(`the sequence's ${m} names no cylinder`);
  for (const c of cylinders(model)) {
    if (!moves.some((m) => m.cylinder === c.id && m.dir === -1))
      add(`cylinder ${c.id} never retracts in the sequence: a cycle brings every cylinder back`);
    if (!moves.some((m) => m.cylinder === c.id && m.dir === 1))
      add(`cylinder ${c.id} never extends in the sequence: a cycle brings every cylinder back`);
  }
  for (const id of model.press)
    if (model.parts.find((p) => p.id === id)?.kind !== "valve-32-button")
      add(`press names ${id}, which isn't a push-button valve`);
  const netIds = new Set(model.nets.map((n) => n.id));
  for (const id of model.signals) if (!netIds.has(id)) add(`signals names net ${id}, which the model doesn't have`);
  for (const id of model.signals)
    if (ids.has(id)) add(`signal ${id} shares its name with a cylinder: the timing diagram names its rows by them`);
  if (airSources(model).length === 0) add("the circuit has no air source");
  return out;
}
