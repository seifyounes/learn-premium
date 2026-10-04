// What the layout core reads and writes: a schematic model (parts and nets, as the figure has
// them), the Layout hints a sim builder reads off the figure, and the finished drawing the engine
// makes from the two. Builders write the first two; only the engine writes a drawing.
import type { Placement, Point, Side, SymbolKind, Turn } from "./symbols.ts";

export interface ModelPart {
  /** The figure's own label when it labels the part (R1, G4); else a kind prefix and a number (GND1). */
  id: string;
  kind: SymbolKind;
  /** The text the figure prints beside the part; absent for an unlabelled symbol. */
  label?: string | undefined;
}

export interface ModelNet {
  id: string;
  /** Pins as `part.pin`, e.g. `G1.in2`. */
  pins: readonly string[];
}

/** The figure as a netlist: every pin of every part in exactly one net. */
export interface SchematicModel {
  parts: readonly ModelPart[];
  nets: readonly ModelNet[];
}

/** What the builder reads off the figure for one part: never a coordinate. */
export interface PartHint {
  /** The part's cell on the figure's coarse grid, [column, row]: one step is about one two-terminal part's length. */
  at: readonly [number, number];
  turn?: Turn | undefined;
  flip?: boolean | undefined;
  /** The side the figure prints its label on. */
  label?: Side | undefined;
}

export interface LayoutHints {
  parts: Readonly<Record<string, PartHint>>;
  /** The nets whose joints the figure dots. Every other net's joints are drawn undotted, as the figure draws them. */
  dots?: readonly string[] | undefined;
}

/** Text anchored at its baseline start: `x` its left edge, `y` its baseline. */
export interface Text {
  text: string;
  x: number;
  y: number;
}

export interface PlacedPart extends Placement {
  id: string;
  label?: Text | undefined;
}

/** An orthogonal polyline: no ids and no net names, so connectivity is read from geometry alone. */
export interface Wire {
  points: readonly Point[];
}

export interface Drawing {
  width: number;
  height: number;
  parts: readonly PlacedPart[];
  wires: readonly Wire[];
  /** Junction dots, where the figure dots its joints. A dot joins nothing: wires meet by their ends. */
  dots: readonly Point[];
  /** Pins the router couldn't reach, each as `part.pin`: the gate blocks on any. */
  unrouted: readonly string[];
}

/** Labels are set at this size: 13px Atkinson Hyperlegible Mono, over the 12px floor at any width. */
export const LABEL_PX = 13;
/** A mono glyph's advance at that size, rounded up, so a label never draws wider than its box. */
const CHAR_PX = 8;

/** A label's box, [x0, y0, x1, y1], ascent and descent included. */
export const textBox = (t: Text): [number, number, number, number] => [
  t.x,
  t.y - LABEL_PX + 2,
  t.x + CHAR_PX * t.text.length,
  t.y + 3,
];

/** A label's width in px. */
export const textWidth = (text: string) => CHAR_PX * text.length;

/** `G1.in2` → `["G1", "in2"]`. */
export function splitPin(key: string): [string, string] {
  const dot = key.indexOf(".");
  return dot < 0 ? [key, ""] : [key.slice(0, dot), key.slice(dot + 1)];
}
