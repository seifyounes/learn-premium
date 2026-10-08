// The symbol kit every schematic sim is drawn with: each kind's pins, the side each pin's wire
// leaves from, its body (the box no wire or label may cross) and its strokes. Local px, y down,
// origin at the symbol's centre. Every pin sits on the pad's 20px grid, so a part placed on the
// grid puts all its pins there too.
//
// A placed part's transform: `flip` mirrors local x first, then `turn` turns it clockwise on
// screen by 0, 90, 180 or 270. So a resistor at turn 90 is vertical with pin 1 on top, and a gate
// at turn 0 has its inputs on the left and its output on the right.
import { BLOCK_DIAGRAM_SYMBOLS } from "./block-diagram.ts";

export type Point = readonly [number, number];
export type Turn = 0 | 90 | 180 | 270;
export const TURNS = [0, 90, 180, 270] as const satisfies readonly Turn[];
/** Where a label sits beside its part, as the figure prints it. */
export type Side = "left" | "right" | "above" | "below";
export const SIDES = ["left", "right", "above", "below"] as const satisfies readonly Side[];

/** The pad's grid: every pin, part centre and wire corner sits on it. */
export const GRID = 20;

const W: Point = [-1, 0];
const E: Point = [1, 0];
const N: Point = [0, -1];
const S: Point = [0, 1];

interface Pin {
  at: Point;
  /** The way its wire leaves the pin, at turn 0. A terminal's wire leaves away from its label. */
  faces: Point | "away-from-label";
  /** Whether a lead joins the pin to the body: it counts as one arm where wires meet. */
  lead: boolean;
}

/**
 * How a drawing of the part is told apart from its turned or mirrored self, for the figure check:
 * `any` (a terminal looks the same whichever way), `axis` (a non-polar two-terminal: only
 * horizontal or vertical matters), `pin` (the way one pin points: a polar part or a gate) or
 * `full` (turn and flip both matter).
 */
type Orientation = { by: "any" } | { by: "axis" } | { by: "pin"; pin: string } | { by: "full" };

export interface SymbolDef {
  pins: Record<string, Pin>;
  /** The body, [x0, y0, x1, y1]: no wire or other label may cross it. Pins and leads lie outside. */
  box: readonly [number, number, number, number];
  orientation: Orientation;
  /** Pins whose wires may swap without changing the circuit (a resistor's ends, a gate's inputs). */
  swappable?: readonly [string, string];
  /** Joins every other symbol with the same key without a wire (grounds, same-named rails). */
  implicit?: (label: string | undefined) => string;
  /** Its strokes, as SVG path data: leads, then the body. `fill` paths are filled with the ink. */
  leads: string;
  body: string;
  fill?: string;
  /** A small circle on the body (a gate's inverting bubble, a terminal), [cx, cy, r]. */
  circles?: readonly (readonly [number, number, number])[];
  /** The figure prints the part's label inside its body (a block's transfer function), never beside it. */
  labelInside?: boolean;
  /** How a Blind reader keys a part of this kind the figure doesn't label (a summing junction: SUM). */
  figureKey?: string;
}

const pin = (at: Point, faces: Pin["faces"], lead = true): Pin => ({ at, faces, lead });
const twoTerminal = (a: string, b: string) => ({ [a]: pin([-40, 0], W), [b]: pin([40, 0], E) });
const gateInputs = { in1: pin([-40, -20], W), in2: pin([-40, 20], W) };

/** Two-input gate bodies, 60px tall, inputs 40px apart so both land on the grid. */
const AND_BODY = "M-28 -30H0A30 30 0 0 1 0 30H-28Z";
const OR_BODY = "M-30 -30Q10 -30 30 0Q10 30 -30 30Q-18 0 -30 -30Z";
const XOR_BACK = "M-37 -30Q-25 0 -37 30";

function gate(body: string, inputsReach: number, inverted: boolean, extra = ""): SymbolDef {
  const outFrom = inverted ? 38 : 30;
  return {
    pins: { ...gateInputs, out: pin([40, 0], E) },
    box: [-30, -30, inverted ? 38 : 30, 30],
    orientation: { by: "pin", pin: "out" },
    swappable: ["in1", "in2"],
    leads: `M-40 -20H${inputsReach}M-40 20H${inputsReach}M${outFrom} 0H40`,
    body: body + extra,
    ...(inverted ? { circles: [[34, 0, 4]] as const } : {}),
  };
}

export const SYMBOLS = {
  ...BLOCK_DIAGRAM_SYMBOLS,
  resistor: {
    pins: twoTerminal("1", "2"),
    box: [-26, -10, 26, 10],
    orientation: { by: "axis" },
    swappable: ["1", "2"],
    leads: "M-40 0H-24M24 0H40",
    body: "M-24 0L-20 -8L-12 8L-4 -8L4 8L12 -8L20 8L24 0",
  },
  capacitor: {
    pins: twoTerminal("1", "2"),
    box: [-8, -18, 8, 18],
    orientation: { by: "axis" },
    swappable: ["1", "2"],
    leads: "M-40 0H-5M5 0H40",
    body: "M-5 -16V16M5 -16V16",
  },
  inductor: {
    pins: twoTerminal("1", "2"),
    box: [-28, -12, 28, 4],
    orientation: { by: "axis" },
    swappable: ["1", "2"],
    leads: "M-40 0H-28M28 0H40",
    body: "M-28 0a7 7 0 0 1 14 0a7 7 0 0 1 14 0a7 7 0 0 1 14 0a7 7 0 0 1 14 0",
  },
  switch: {
    pins: twoTerminal("1", "2"),
    box: [-24, -22, 24, 6],
    orientation: { by: "axis" },
    swappable: ["1", "2"],
    leads: "M-40 0H-20M20 0H40",
    body: "M-20 0L16 -18",
    circles: [
      [-20, 0, 2.5],
      [20, 0, 2.5],
    ],
  },
  /** Anode A to cathode K points right at turn 0. */
  diode: {
    pins: twoTerminal("A", "K"),
    box: [-14, -16, 14, 16],
    orientation: { by: "pin", pin: "K" },
    leads: "M-40 0H-12M12 0H40",
    body: "M12 -13V13",
    fill: "M-12 -13L12 0L-12 13Z",
  },
  /** Base left, collector up, emitter down; a flip puts the base on the right. */
  npn: {
    pins: { B: pin([-40, 0], W), C: pin([20, -40], N), E: pin([20, 40], S) },
    box: [-20, -30, 34, 30],
    orientation: { by: "full" },
    leads: "M-40 0H-6M-6 -7L20 -24V-40M-6 7L20 24V40",
    body: "M32 0A26 26 0 1 1 -20 0A26 26 0 1 1 32 0ZM-6 -16V16",
    fill: "M20 24L9 22L15 15Z",
  },
  /** A DC source, + on top at turn 0. */
  vsource: {
    pins: { "+": pin([0, -40], N), "-": pin([0, 40], S) },
    box: [-20, -20, 20, 20],
    orientation: { by: "pin", pin: "+" },
    leads: "M0 -40V-20M0 20V40",
    body: "M20 0A20 20 0 1 1 -20 0A20 20 0 1 1 20 0ZM-5 -9H5M0 -14V-4M-5 9H5",
  },
  /** A DC machine's armature, brushes left (+) and right (-). */
  motor: {
    pins: twoTerminal("+", "-"),
    box: [-30, -22, 30, 22],
    orientation: { by: "pin", pin: "+" },
    leads: "M-40 0H-28M28 0H40",
    body: "M20 0A20 20 0 1 1 -20 0A20 20 0 1 1 20 0Z",
    fill: "M-28 -4H-20V4H-28ZM20 -4H28V4H20Z",
  },
  /** Wire from above, bars below; every ground joins every other. */
  ground: {
    pins: { g: pin([0, 0], N) },
    box: [-14, 6, 14, 22],
    orientation: { by: "any" },
    implicit: () => "ground",
    leads: "M0 0V10",
    body: "M-13 10H13M-8 15H8M-3 20H3",
  },
  /** A supply terminal (VCC +12 V): its wire leaves downward; rails with one name join. */
  rail: {
    pins: { t: pin([0, 0], S) },
    box: [-5, -12, 5, -2],
    orientation: { by: "any" },
    implicit: (label) => `rail ${label ?? ""}`,
    leads: "M0 0V-3",
    body: "",
    circles: [[0, -7, 4]],
  },
  /** A signal terminal (Vin, a logic input or output): its wire leaves away from its label. */
  port: {
    pins: { t: pin([0, 0], "away-from-label", false) },
    box: [-4, -4, 4, 4],
    orientation: { by: "any" },
    leads: "",
    body: "",
    circles: [[0, 0, 4]],
  },
  and: gate(AND_BODY, -28, false),
  nand: gate(AND_BODY, -28, true),
  or: gate(OR_BODY, -26, false),
  nor: gate(OR_BODY, -26, true),
  xor: gate(OR_BODY, -26, false, XOR_BACK),
  xnor: gate(OR_BODY, -26, true, XOR_BACK),
  not: {
    pins: { in: pin([-40, 0], W), out: pin([40, 0], E) },
    box: [-26, -16, 26, 16],
    orientation: { by: "pin", pin: "out" },
    leads: "M-40 0H-24M26 0H40",
    body: "M-24 -16L18 0L-24 16Z",
    circles: [[22, 0, 4]],
  },
} as const satisfies Record<string, SymbolDef>;

export type SymbolKind = keyof typeof SYMBOLS;
export const SYMBOL_KINDS = Object.keys(SYMBOLS) as SymbolKind[];

export const symbolOf = (kind: SymbolKind): SymbolDef => SYMBOLS[kind];

/** The pin names a kind has. */
export const pinNames = (kind: SymbolKind) => Object.keys(symbolOf(kind).pins);

/** A part as placed on a drawing: where its centre sits, how it is turned and mirrored. */
export interface Placement {
  kind: SymbolKind;
  x: number;
  y: number;
  turn: Turn;
  flip: boolean;
}

/** A local vector turned and mirrored as the part is (no translation). */
export function orient(part: Pick<Placement, "turn" | "flip">, [x, y]: Point): Point {
  const mx = part.flip ? -x : x;
  switch (part.turn) {
    case 0:
      return [mx, y];
    case 90:
      return [-y, mx];
    case 180:
      return [-mx, -y];
    case 270:
      return [y, -mx];
  }
}

/** A local point on the part, in drawing px. */
export function toDrawing(part: Placement, local: Point): Point {
  const [dx, dy] = orient(part, local);
  return [part.x + dx, part.y + dy];
}

/** Every pin of the part, in drawing px, by name. */
export function pinsOf(part: Placement): Record<string, Point> {
  return Object.fromEntries(Object.entries(symbolOf(part.kind).pins).map(([name, p]) => [name, toDrawing(part, p.at)]));
}

/** The part's body box in drawing px, [x0, y0, x1, y1]. */
export function boxOf(part: Placement): [number, number, number, number] {
  const [x0, y0, x1, y1] = symbolOf(part.kind).box;
  const corners = (
    [
      [x0, y0],
      [x1, y0],
      [x0, y1],
      [x1, y1],
    ] as const
  ).map((c) => toDrawing(part, c));
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** The SVG transform that draws a symbol's local strokes where the part sits. */
export const transformOf = (part: Placement) =>
  `translate(${part.x} ${part.y}) rotate(${part.turn})${part.flip ? " scale(-1 1)" : ""}`;
