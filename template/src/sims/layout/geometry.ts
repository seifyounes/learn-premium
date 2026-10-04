// Connectivity read from a drawing's geometry alone: no wire ids, no net names. A wire meets a pin
// only where one of its points lands exactly on it, and meets another wire only where an end of
// one lands on the other (a T, or end to end). A plain crossing never connects, and a junction dot
// joins nothing: it only marks a joint, as the figure does. Grounds join every ground, and rails
// join rails of the same name, without a wire.
import type { Drawing, PlacedPart, Wire } from "./drawing.ts";
import { pinsOf, symbolOf, type Point } from "./symbols.ts";

export const samePoint = (a: Point, b: Point) => a[0] === b[0] && a[1] === b[1];
export const segmentsOf = (w: Wire): [Point, Point][] =>
  w.points.slice(1).map((p, i) => [w.points[i] as Point, p] as [Point, Point]);
export const endsOf = (w: Wire): Point[] => {
  const first = w.points[0];
  const last = w.points.at(-1);
  return first && last ? [first, last] : [];
};

/** Whether `p` lies on segment a–b (ends included). Orthogonal segments only; a diagonal holds nothing. */
export function onSegment(p: Point, [a, b]: [Point, Point]): boolean {
  if (a[0] === b[0]) return p[0] === a[0] && p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1]);
  if (a[1] === b[1]) return p[1] === a[1] && p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0]);
  return false;
}
export const onWire = (p: Point, w: Wire) => segmentsOf(w).some((s) => onSegment(p, s));

export interface DrawnPin {
  key: string;
  at: Point;
  part: PlacedPart;
  /** A lead joins the pin to its body: one arm where wires meet there. */
  lead: boolean;
}

export const drawnPins = (d: Drawing): DrawnPin[] =>
  d.parts.flatMap((part) =>
    Object.entries(pinsOf(part)).map(([name, at]) => ({
      key: `${part.id}.${name}`,
      at,
      part,
      lead: symbolOf(part.kind).pins[name]?.lead ?? false,
    })),
  );

/** A point where wires meet: a T, a wire's end on a corner, or two wires at a pin. */
export interface Joint {
  at: Point;
  /** The pins its conductor reaches. */
  net: string[];
}

export interface Connectivity {
  /** Every pin, grouped by the conductor it is on. A pin no wire reaches is alone. */
  nets: string[][];
  /** Pins some wire reaches. */
  reached: Set<string>;
  /** Each wire's conductor, as the pins it reaches. */
  wireNets: string[][];
  joints: Joint[];
}

function unionFind() {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x);
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root) as string;
    for (let at = x; at !== root;) {
      const next = parent.get(at) as string;
      parent.set(at, root);
      at = next;
    }
    return root;
  };
  return { find, union: (a: string, b: string) => void parent.set(find(a), find(b)) };
}

export function connectivity(d: Drawing): Connectivity {
  const u = unionFind();
  const pins = drawnPins(d);
  const reached = new Set<string>();
  d.wires.forEach((w, i) => {
    u.find(`w${i}`);
    for (const pin of pins) {
      if (w.points.some((q) => samePoint(q, pin.at))) {
        u.union(`w${i}`, `p:${pin.key}`);
        reached.add(pin.key);
      }
    }
  });
  d.wires.forEach((w, i) =>
    d.wires.forEach((v, j) => {
      if (i !== j && endsOf(w).some((end) => onWire(end, v))) u.union(`w${i}`, `w${j}`);
    }),
  );
  const implicit = new Map<string, string>();
  for (const pin of pins) {
    const join = symbolOf(pin.part.kind).implicit;
    if (!join) continue;
    const k = join(pin.part.label?.text);
    const first = implicit.get(k);
    if (first) u.union(`p:${pin.key}`, `p:${first}`);
    else implicit.set(k, pin.key);
  }
  const groups = new Map<string, string[]>();
  for (const pin of pins) {
    const root = u.find(`p:${pin.key}`);
    groups.set(root, [...(groups.get(root) ?? []), pin.key]);
  }
  const netOf = (node: string) => groups.get(u.find(node)) ?? [];
  return {
    nets: [...groups.values()],
    reached,
    wireNets: d.wires.map((_, i) => netOf(`w${i}`)),
    joints: joints(d, pins).map((j) => ({ at: j.at, net: netOf(`w${j.wire}`) })),
  };
}

/**
 * Where wires meet: a point some wire ends on, or a pin, where at least three arms meet (a wire's
 * end is one arm, a point inside a wire two, a pin's lead one). A crossing has no end in it, so it
 * is never a joint.
 */
function joints(d: Drawing, pins: DrawnPin[]): { at: Point; wire: number }[] {
  const candidates = new Map<string, Point>();
  const add = (p: Point) => candidates.set(`${p[0]},${p[1]}`, p);
  d.wires.forEach((w) => endsOf(w).forEach(add));
  const found: { at: Point; wire: number }[] = [];
  for (const at of candidates.values()) {
    let arms = 0;
    let wire = -1;
    d.wires.forEach((w, i) => {
      if (endsOf(w).some((e) => samePoint(e, at))) arms += 1;
      else if (onWire(at, w)) arms += 2;
      else return;
      wire = i;
    });
    const pin = pins.find((p) => samePoint(p.at, at));
    if (pin?.lead) arms += 1;
    if (arms >= 3 && wire >= 0) found.push({ at, wire });
  }
  return found;
}

/** A model net's pin keys with every implicit join applied, as the drawing should connect them. */
export function modelNets(
  model: { parts: readonly { id: string; kind: Parameters<typeof symbolOf>[0]; label?: string | undefined }[] },
  nets: readonly { pins: readonly string[] }[],
): string[][] {
  const u = unionFind();
  const all = model.parts.flatMap((p) => Object.keys(symbolOf(p.kind).pins).map((name) => `${p.id}.${name}`));
  all.forEach((k) => u.find(k));
  for (const net of nets) net.pins.forEach((k) => u.union(k, net.pins[0] as string));
  const implicit = new Map<string, string>();
  for (const p of model.parts) {
    const join = symbolOf(p.kind).implicit;
    if (!join) continue;
    for (const name of Object.keys(symbolOf(p.kind).pins)) {
      const k = join(p.label);
      const first = implicit.get(k);
      if (first) u.union(`${p.id}.${name}`, first);
      else implicit.set(k, `${p.id}.${name}`);
    }
  }
  const groups = new Map<string, string[]>();
  for (const k of all) groups.set(u.find(k), [...(groups.get(u.find(k)) ?? []), k]);
  return [...groups.values()];
}

/**
 * The model net each wire and each dot is on, read from geometry, never from the router: what the
 * page inks when that net is high. The Drawing gate proves geometry and model agree.
 */
export function inkNets(
  d: Drawing,
  nets: readonly { id: string; pins: readonly string[] }[],
): { wires: (string | undefined)[]; dots: (string | undefined)[] } {
  const conn = connectivity(d);
  const netFor = (pins: readonly string[]) => nets.find((n) => n.pins.some((k) => pins.includes(k)))?.id;
  return {
    wires: conn.wireNets.map(netFor),
    dots: d.dots.map((dot) => {
      const joint = conn.joints.find((j) => samePoint(j.at, dot));
      return joint ? netFor(joint.net) : undefined;
    }),
  };
}
