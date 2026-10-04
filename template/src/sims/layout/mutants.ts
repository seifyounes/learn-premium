// The Drawing gate's negative control, run on every drawing at every build: each mutant breaks a
// good drawing one known way, and the gate must fail it on the check named. A gate that passes a
// mutant can't see what it claims to check.
import type { CheckId } from "./check.ts";
import { textBox, type Drawing, type PlacedPart, type Text } from "./drawing.ts";
import { segmentsOf } from "./geometry.ts";
import { GRID, pinsOf, symbolOf, type Point, type Turn } from "./symbols.ts";

export type MutantId = "short" | "open" | "reversed" | "label" | "extra" | "mirrored" | "staircase" | "no-dot";

export interface Mutant {
  id: MutantId;
  what: string;
  /** The checks that must fail on it: any one catches it. */
  expect: readonly CheckId[];
  drawing: Drawing;
}

/** A mutant the drawing has nothing to plant in (no dot to remove, no polar part), and why. */
export interface Skipped {
  id: MutantId;
  why: string;
}

const clone = (d: Drawing): Drawing => structuredClone(d);
const length = ([a, b]: readonly [Point, Point]) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);

/**
 * Every mutant the drawing can carry, and why any it can't was left out (no dot to remove, no
 * part with a polarity): the gate reports both, so a control that checked nothing is visible.
 */
export function mutantsOf(
  d: Drawing,
  nets: readonly { id: string; pins: readonly string[] }[],
): {
  mutants: Mutant[];
  skipped: Skipped[];
} {
  const mutants: Mutant[] = [];
  const skipped: Skipped[] = [];
  const skip = (id: MutantId, why: string) => skipped.push({ id, why });
  const netOf = (pin: string) => nets.find((n) => n.pins.includes(pin))?.id;

  // A short: an extra wire joins the two nearest pins of different nets.
  const pins = d.parts.flatMap((p) =>
    Object.entries(pinsOf(p)).map(([name, at]) => ({ key: `${p.id}.${name}`, at, part: p.id })),
  );
  let best: { a: (typeof pins)[number]; b: (typeof pins)[number]; gap: number } | undefined;
  for (const a of pins)
    for (const b of pins) {
      if (a.key >= b.key || a.part === b.part || netOf(a.key) === netOf(b.key)) continue;
      const gap = Math.abs(a.at[0] - b.at[0]) + Math.abs(a.at[1] - b.at[1]);
      if (!best || gap < best.gap) best = { a, b, gap };
    }
  if (best) {
    const m = clone(d);
    const { a, b } = best;
    const corner: Point = [b.at[0], a.at[1]];
    const points = [a.at, corner, b.at].filter(
      (p, i, all) => i === 0 || p[0] !== all[i - 1]?.[0] || p[1] !== all[i - 1]?.[1],
    );
    m.wires = [...m.wires, { points }];
    mutants.push({
      id: "short",
      what: `an extra wire shorts ${a.key} to ${b.key}`,
      expect: ["connectivity"],
      drawing: m,
    });
  } else skip("short", "no two pins on different nets");

  // An open: the longest wire deleted.
  if (d.wires.length > 0) {
    const m = clone(d);
    const wireLength = (i: number) => segmentsOf(d.wires[i] ?? { points: [] }).reduce((s, g) => s + length(g), 0);
    const longest = d.wires.reduce((bi, _, i) => (wireLength(i) > wireLength(bi) ? i : bi), 0);
    m.wires = m.wires.filter((_, i) => i !== longest);
    mutants.push({ id: "open", what: `wire ${longest} deleted`, expect: ["connectivity"], drawing: m });
  } else skip("open", "no wire");

  // A part with a polarity turned round, its wires left where they were.
  const polar = d.parts.findIndex((p) => {
    const o = symbolOf(p.kind).orientation.by;
    return o === "pin" || o === "full";
  });
  if (polar >= 0) {
    const m = clone(d);
    const part = m.parts[polar] as PlacedPart;
    (m.parts as PlacedPart[])[polar] = { ...part, turn: ((part.turn + 180) % 360) as Turn };
    mutants.push({ id: "reversed", what: `${part.id} turned 180°`, expect: ["connectivity", "turn"], drawing: m });
  } else skip("reversed", "no part with a polarity");

  // A label dropped.
  const labelled = d.parts.findIndex((p) => p.label);
  if (labelled >= 0) {
    const m = clone(d);
    const part: PlacedPart = { ...(m.parts[labelled] as PlacedPart) };
    delete part.label;
    (m.parts as PlacedPart[])[labelled] = part;
    mutants.push({ id: "label", what: `${part.id}'s label dropped`, expect: ["labels"], drawing: m });
  } else skip("label", "no labelled part");

  // A part the model doesn't have, drawn clear of everything.
  {
    const m = clone(d);
    const x = d.width + 60;
    // A name no part of the drawing has, so the extra part can't pass as one the model names.
    let id = "RX";
    for (let n = 1; d.parts.some((p) => p.id === id); n++) id = `RX${n}`;
    m.parts = [
      ...m.parts,
      { id, kind: "resistor", x, y: 60, turn: 0, flip: false, label: { text: id, x: x - 8, y: 40 } },
    ];
    m.width = d.width + 160;
    mutants.push({ id: "extra", what: `an extra resistor ${id} drawn`, expect: ["parts"], drawing: m });
  }

  // The whole drawing mirrored: every net intact, every pair in the wrong order.
  mutants.push({
    id: "mirrored",
    what: "the drawing mirrored left to right, nets intact",
    expect: ["arrangement"],
    drawing: mirrored(d),
  });

  // A staircase: the longest straight run stepped aside a grid step and back, twice, on the grid
  // and with no jog under 20px, as a router bug would draw it: nets intact, too many bends.
  const run = d.wires
    .flatMap((w, i) => segmentsOf(w).map((s, j) => ({ i, j, s })))
    .filter(({ s }) => length(s) >= 5 * GRID)
    .sort((a, b) => length(b.s) - length(a.s))[0];
  if (run) {
    const m = clone(d);
    const [a, b] = run.s;
    const [ux, uy] = [Math.sign(b[0] - a[0]), Math.sign(b[1] - a[1])];
    const along = (n: number): Point => [a[0] + ux * n * GRID, a[1] + uy * n * GRID];
    const aside = ([x, y]: Point): Point => [x + uy * GRID, y + ux * GRID];
    const steps = [1, 3].flatMap((n) => [along(n), aside(along(n)), aside(along(n + 1)), along(n + 1)]);
    const w = m.wires[run.i];
    if (w) {
      const points = [...w.points];
      points.splice(run.j + 1, 0, ...steps);
      (m.wires as { points: Point[] }[])[run.i] = { points };
    }
    mutants.push({ id: "staircase", what: `wire ${run.i} redrawn as a staircase`, expect: ["tidiness"], drawing: m });
  } else skip("staircase", `no straight run of ${5 * GRID}px or more`);

  // A junction dot removed.
  if (d.dots.length > 0) {
    const m = clone(d);
    m.dots = m.dots.slice(1);
    mutants.push({ id: "no-dot", what: `the dot at (${d.dots[0]?.join(", ")}) removed`, expect: ["dots"], drawing: m });
  } else skip("no-dot", "the figure dots no joint");

  return { mutants, skipped };
}

/** `d` mirrored about its middle: parts flipped and turned back, labels and wires reflected. */
function mirrored(d: Drawing): Drawing {
  const m = clone(d);
  const xs = [...d.parts.map((p) => p.x), ...d.wires.flatMap((w) => w.points.map((p) => p[0]))];
  const span = Math.min(...xs) + Math.max(...xs);
  const reflect = (t: Text | undefined) => t && { ...t, x: span - textBox(t)[2] };
  m.parts = d.parts.map((p) => {
    const label = reflect(p.label);
    return { ...p, x: span - p.x, flip: !p.flip, turn: ((360 - p.turn) % 360) as Turn, ...(label ? { label } : {}) };
  });
  m.wires = d.wires.map((w) => ({ points: w.points.map(([x, y]) => [span - x, y] as const) }));
  m.dots = d.dots.map(([x, y]) => [span - x, y] as const);
  return m;
}
