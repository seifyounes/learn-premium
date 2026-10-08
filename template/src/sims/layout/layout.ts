// The layout core: a schematic model and the Layout hints read off its figure in, a finished
// drawing out. The builder never writes a coordinate and there is no hand-placed override: the
// engine snaps every part to the pad's 20px grid, seats grounds, straightens near-aligned pins,
// sets labels on the figure's side and routes every wire. Pure and deterministic, so the Drawing
// gate checks exactly the drawing the page shows.
import { textBox, type Drawing, type LayoutHints, type PlacedPart, type SchematicModel, type Wire } from "./drawing.ts";
import { place } from "./place.ts";
import { route } from "./route.ts";
import { boxOf, GRID, pinsOf, type Point } from "./symbols.ts";

/** The clear sheet left round the drawing, in grid steps. */
const MARGIN = 1;

export function layOut(model: SchematicModel, hints: LayoutHints): Drawing {
  const parts = place(model, hints);
  const sides = Object.fromEntries(Object.entries(hints.parts).map(([id, h]) => [id, h.label]));
  const { wires, dots, unrouted } = route(parts, model.nets, { sides, dotted: new Set(hints.dots ?? []) });
  return framed({ width: 0, height: 0, parts, wires, dots, unrouted });
}

/** The drawing moved by whole grid steps so its ink starts one step in, and sized to hold it. */
function framed(d: Drawing): Drawing {
  const xs: number[] = [];
  const ys: number[] = [];
  const add = ([x, y]: Point) => (xs.push(x), ys.push(y));
  for (const part of d.parts) {
    const [x0, y0, x1, y1] = boxOf(part);
    add([x0, y0]);
    add([x1, y1]);
    Object.values(pinsOf(part)).forEach(add);
    for (const text of [...(part.label ? [part.label] : []), ...(part.notes ?? [])]) {
      const [tx0, ty0, tx1, ty1] = textBox(text);
      add([tx0, ty0]);
      add([tx1, ty1]);
    }
  }
  d.wires.forEach((w) => w.points.forEach(add));
  if (xs.length === 0) return d;
  const dx = MARGIN * GRID - Math.floor(Math.min(...xs) / GRID) * GRID;
  const dy = MARGIN * GRID - Math.floor(Math.min(...ys) / GRID) * GRID;
  const move = ([x, y]: Point): Point => [x + dx, y + dy];
  const parts: PlacedPart[] = d.parts.map((p) => ({
    ...p,
    x: p.x + dx,
    y: p.y + dy,
    ...(p.label ? { label: { ...p.label, x: p.label.x + dx, y: p.label.y + dy } } : {}),
    ...(p.notes ? { notes: p.notes.map((n) => ({ ...n, x: n.x + dx, y: n.y + dy })) } : {}),
  }));
  const wires: Wire[] = d.wires.map((w) => ({ points: w.points.map(move) }));
  return {
    width: Math.ceil((Math.max(...xs) + dx) / GRID) * GRID + MARGIN * GRID,
    height: Math.ceil((Math.max(...ys) + dy) / GRID) * GRID + MARGIN * GRID,
    parts,
    wires,
    dots: d.dots.map(move),
    unrouted: d.unrouted,
  };
}
