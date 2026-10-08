// Placement: the hints' coarse cells snapped onto the pad's grid, grounds seated under the pin they
// serve, near-aligned pins straightened, and each label set on the side the figure prints it.
import { splitPin, textWidth, type LayoutHints, type PlacedPart, type SchematicModel } from "./drawing.ts";
import { boxOf, GRID, pinsOf, symbolOf, type Point, type Side, type SymbolKind } from "./symbols.ts";

/** One coarse step of the hints, in px: about one two-terminal part's length. */
export const PITCH = 100;
/** How far apart two pins may be across a wire and still be pulled into a straight line. */
const STRAIGHTEN_PX = 40;
/** How far sideways a ground may move to sit under its pin. */
const SEAT_PX = 60;

/** `v` on the nearest line of the pad's grid. */
export const toGrid = (v: number) => Math.round(v / GRID) * GRID;

/** Kinds a few px can move without changing the drawing's arrangement: small parts and terminals. */
const MOVABLE = new Set<SymbolKind>(["resistor", "capacitor", "inductor", "switch", "diode", "port", "ground", "rail"]);

export function place(model: SchematicModel, hints: LayoutHints): PlacedPart[] {
  const parts: PlacedPart[] = model.parts.map((m) => {
    const h = hints.parts[m.id];
    const [col, row] = h?.at ?? [0, 0];
    return {
      id: m.id,
      kind: m.kind,
      x: toGrid(col * PITCH),
      y: toGrid(row * PITCH),
      turn: h?.turn ?? 0,
      flip: h?.flip ?? false,
    };
  });
  seatGrounds(parts, model);
  straighten(parts, model);
  for (const part of parts) {
    const label = model.parts.find((m) => m.id === part.id)?.label;
    if (label !== undefined) part.label = labelFor(part, label, hints.parts[part.id]?.label ?? "right");
  }
  return parts;
}

const pinAt = (byId: Map<string, PlacedPart>, key: string): Point | undefined => {
  const [id, name] = splitPin(key);
  const part = byId.get(id);
  return part && pinsOf(part)[name];
};

/** A ground sits directly under the nearest pin it serves, at least one grid step below it. */
function seatGrounds(parts: PlacedPart[], model: SchematicModel) {
  const byId = new Map(parts.map((p) => [p.id, p]));
  for (const ground of parts.filter((p) => p.kind === "ground")) {
    const net = model.nets.find((n) => n.pins.includes(`${ground.id}.g`));
    const served = (net?.pins ?? [])
      .filter((key) => {
        const part = byId.get(splitPin(key)[0]);
        return part !== undefined && symbolOf(part.kind).implicit === undefined;
      })
      .map((key) => pinAt(byId, key))
      .filter((p): p is Point => p !== undefined);
    const distance = (p: Point) => Math.abs(p[0] - ground.x) + Math.abs(p[1] - ground.y);
    const nearest = served.reduce<Point | undefined>((a, p) => (!a || distance(p) < distance(a) ? p : a), undefined);
    if (!nearest) continue;
    if (Math.abs(nearest[0] - ground.x) <= SEAT_PX) ground.x = nearest[0];
    ground.y = Math.max(ground.y, nearest[1] + GRID);
  }
}

/**
 * Two pins of one net that a wire joins along one axis, but that sit a little apart across it,
 * are pulled into line by moving the more movable part: hints are never pixel-exact, and the
 * figure's wire is straight. A part moves at most once per axis, so the passes settle.
 */
function straighten(parts: PlacedPart[], model: SchematicModel, passes = 4) {
  const byId = new Map(parts.map((p) => [p.id, p]));
  const moved = { x: new Set<string>(), y: new Set<string>() };
  for (let pass = 0; pass < passes; pass++) {
    for (const net of model.nets) {
      net.pins.forEach((a, i) => {
        for (const b of net.pins.slice(i + 1)) {
          const [idA] = splitPin(a);
          const [idB] = splitPin(b);
          if (idA === idB) continue;
          for (const axis of ["x", "y"] as const) {
            const pa = pinAt(byId, a);
            const pb = pinAt(byId, b);
            if (!pa || !pb) continue;
            const across = axis === "x" ? pb[0] - pa[0] : pb[1] - pa[1];
            const along = axis === "x" ? pb[1] - pa[1] : pb[0] - pa[0];
            if (across === 0 || Math.abs(across) > STRAIGHTEN_PX || Math.abs(along) < STRAIGHTEN_PX) continue;
            // The later part moves first; a part already moved on this axis stays put.
            const mover = [idB, idA].find((id) => {
              const part = byId.get(id);
              return part !== undefined && MOVABLE.has(part.kind) && !moved[axis].has(id);
            });
            const part = mover === undefined ? undefined : byId.get(mover);
            if (!part || mover === undefined) continue;
            part[axis] += mover === idB ? -across : across;
            moved[axis].add(mover);
          }
        }
      });
    }
  }
}

/** The label's baseline start, clear of the body on the figure's side. */
function labelFor(part: PlacedPart, text: string, side: Side) {
  const [x0, y0, x1, y1] = boxOf(part);
  const w = textWidth(text);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  // A block's transfer function is printed inside it, whatever side a hint names.
  if (symbolOf(part.kind).labelInside) return { text, x: Math.round(cx - w / 2), y: Math.round(cy + 5) };
  // A terminal's text sits beside its circle; a part's beside its body.
  const terminal = symbolOf(part.kind).pins.t !== undefined;
  const gap = terminal ? 10 : 8;
  // The figure's sides are its own, never mirrored: the Professor's drawing reads one way.
  const [x, y] = ((): [number, number] => {
    switch (side) {
      case "left":
        return [(terminal ? part.x : x0) - gap - w, (terminal ? part.y : cy) + 5];
      case "right":
        return [(terminal ? part.x : x1) + gap, (terminal ? part.y : cy) + 5];
      case "above":
        return [cx - w / 2, (terminal ? part.y - 6 : y0) - gap];
      case "below":
        return [cx - w / 2, (terminal ? part.y + 6 : y1) + gap + 10];
    }
  })();
  return { text, x: Math.round(x), y: Math.round(y) };
}
