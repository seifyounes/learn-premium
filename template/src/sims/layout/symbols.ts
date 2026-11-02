// The symbol kit every schematic sim is drawn with: each kind's pins, the side each pin's wire
// leaves from, its body (the box no wire or label may cross) and its strokes. Local px, y down,
// origin at the symbol's centre. Every pin sits on the pad's 20px grid, so a part placed on the
// grid puts all its pins there too.
//
// A placed part's transform: `flip` mirrors local x first, then `turn` turns it clockwise on
// screen by 0, 90, 180 or 270. So a resistor at turn 90 is vertical with pin 1 on top, and a gate
// at turn 0 has its inputs on the left and its output on the right.
import { BLOCK_DIAGRAM_SYMBOLS } from "./block-diagram.ts";
import { PNEUMATIC_SYMBOLS } from "./pneumatic.ts";
import { STATE_DIAGRAM_SYMBOLS } from "./state-diagram.ts";

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
  /**
   * A pin the figure may leave off altogether (a coil's `out`, which only a hard-wired rung
   * carries on to the right rail): in no net, it isn't drawn, has no lead, and is no pin of the
   * drawing at all, so a ladder that never uses it draws exactly as before.
   */
  optional?: boolean;
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
  /** Pins whose wires may swap among themselves without changing the circuit (a resistor's ends, a gate's or box's inputs). */
  swappable?: readonly string[];
  /** Joins every other symbol with the same key without a wire (grounds, same-named rails). */
  implicit?: (label: string | undefined) => string;
  /** Its strokes, as SVG path data: leads, then the body. `fill` paths are filled with the ink. */
  leads: string;
  /**
   * Leads that belong to one pin each, drawn before `leads` (`strokesOf`): left out while the pin is
   * open (an optional pin in no net), stopped at a negation circle on the body's edge while the part
   * negates it.
   */
  pinLeads?: Readonly<Record<string, string>>;
  /** Input pins a part may negate, each drawn with a small circle where its lead meets the body (FBD's boxes). */
  negatable?: readonly string[];
  body: string;
  fill?: string;
  /** A small circle on the body (a gate's inverting bubble, a terminal), [cx, cy, r]. */
  circles?: readonly (readonly [number, number, number])[];
  /** The figure prints the part's label inside its body (a block's transfer function), never beside it. */
  labelInside?: boolean;
  /** How a Blind reader keys a part of this kind the figure doesn't label (a summing junction: SUM). */
  figureKey?: string;
  /** Fixed text inside the body (a box's title and pin names, a coil's mark), 12px: [x, y baseline, text, anchor]. */
  text?: readonly SymbolText[];
  /**
   * Where a part's own values print beside it (a timer's preset, the word its value goes to), each
   * by the slot's name: the layout core sets them there, outside the body, and the Drawing gate
   * holds them to the same legibility as labels.
   */
  slots?: Readonly<Record<string, Slot>>;
}

export type Anchor = "start" | "middle" | "end";
export type SymbolText = readonly [x: number, y: number, text: string, anchor: Anchor];
/** A value's baseline point, local px, and which end of the text sits there. */
export interface Slot {
  at: Point;
  anchor: Anchor;
}

const pin = (at: Point, faces: Pin["faces"], lead = true, optional = false): Pin => ({
  at,
  faces,
  lead,
  ...(optional ? { optional } : {}),
});
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

// ---- the PLC pack: ladder (LAD) and function block diagram (FBD), as STEP 7 draws them ----------
// Every element reads left to right at turn 0: power enters on the left, leaves on the right.

/** A contact, -| |-: power passes `in` → `out` when its operand allows. */
const contact = (slash: boolean): SymbolDef => ({
  pins: { in: pin([-40, 0], W), out: pin([40, 0], E) },
  box: slash ? [-14, -16, 14, 16] : [-10, -16, 10, 16],
  orientation: { by: "pin", pin: "out" },
  leads: "M-40 0H-8M8 0H40",
  body: `M-8 -14V14M8 -14V14${slash ? "M-12 14L12 -14" : ""}`,
});

/**
 * A coil, -( )-, ending its rung; `mark` is its letters (S, R, SD, CU…), a timer or counter coil its
 * preset below. The plain coil also has an optional `out`: a hard-wired rung carries on from it,
 * through the overload contact, to the right rail.
 */
const coil = (mark: string, preset = false, out = false): SymbolDef => ({
  pins: { in: pin([-40, 0], W), ...(out ? { out: pin([40, 0], E, true, true) } : {}) },
  box: [-16, -16, 16, 16],
  orientation: { by: "pin", pin: "in" },
  leads: "M-40 0H-14",
  ...(out ? { pinLeads: { out: "M14 0H40" } } : {}),
  body: "M-8 -14A18 18 0 0 0 -8 14M8 -14A18 18 0 0 1 8 14",
  ...(mark ? { text: [[0, 4, mark, "middle"]] as const } : {}),
  ...(preset ? { slots: { preset: { at: [0, 34], anchor: "middle" } } } : {}),
});

/** A box, as STEP 7 draws S_ODT or TON: inputs on the left, outputs on the right, its name on top. */
function box(
  title: string,
  foot: number,
  inputs: readonly (readonly [name: string, y: number])[],
  outputs: readonly (readonly [name: string, y: number])[],
  slots: readonly (readonly [name: string, side: "in" | "out", y: number])[],
): SymbolDef {
  const names: SymbolText[] = [
    [0, -48, title, "middle"],
    ...inputs.map(([name, y]): SymbolText => [-36, y + 4, name, "start"]),
    ...outputs.map(([name, y]): SymbolText => [36, y + 4, name, "end"]),
    ...slots.map(([name, side, y]): SymbolText =>
      side === "in" ? [-36, y + 4, name, "start"] : [36, y + 4, name, "end"],
    ),
  ];
  const lead = (side: "in" | "out", y: number) => (side === "in" ? `M-60 ${y}H-40` : `M40 ${y}H60`);
  return {
    pins: Object.fromEntries([
      ...inputs.map(([name, y]) => [name, pin([-60, y], W)]),
      ...outputs.map(([name, y]) => [name, pin([60, y], E)]),
    ]),
    box: [-40, -60, 40, foot],
    orientation: { by: "full" },
    leads: [
      ...inputs.map(([, y]) => lead("in", y)),
      ...outputs.map(([, y]) => lead("out", y)),
      ...slots.map(([, side, y]) => lead(side, y)),
    ].join(""),
    body: `M-40 -60H40V${foot}H-40Z`,
    text: names,
    slots: Object.fromEntries(
      slots.map(([name, side, y]) => [
        name,
        { at: side === "in" ? [-64, y + 4] : [64, y + 4], anchor: side === "in" ? "end" : "start" } as Slot,
      ]),
    ),
  };
}

/** An S5 timer box: S starts it, R resets it, Q its output; TV its preset, BI and BCD the time left. */
const s5TimerBox = (title: string) =>
  box(
    title,
    60,
    [
      ["S", -40],
      ["R", 40],
    ],
    [["Q", -40]],
    [
      ["TV", "in", 0],
      ["BI", "out", 0],
      ["BCD", "out", 40],
    ],
  );

/** An S5 counter box: CU and CD count, S sets PV, R resets; Q while above 0, CV and CV_BCD the count. */
const s5CounterBox = (title: string, up: boolean, down: boolean) =>
  box(
    title,
    60,
    [...(up ? [["CU", -40] as const] : []), ...(down ? [["CD", up ? -20 : -40] as const] : []), ["S", 0], ["R", 40]],
    [["Q", -40]],
    [
      ["PV", "in", 20],
      ["CV", "out", 0],
      ["CV_BCD", "out", 20],
    ],
  );

/**
 * An FBD box: its function's sign on top, inputs on the left (`in` alone, or `in1`… top to bottom,
 * 40px apart), the result on the right. Every input may be negated: a circle on the box's edge.
 */
function fbdBox(sign: string, inputs: number): SymbolDef {
  if (inputs === 1)
    return {
      pins: { in: pin([-40, 0], W) },
      box: [-20, -16, 20, 16],
      orientation: { by: "pin", pin: "in" },
      leads: "",
      pinLeads: { in: "M-40 0H-20" },
      negatable: ["in"],
      body: "M-20 -16H20V16H-20Z",
      text: [[0, 5, sign, "middle"]],
    };
  const names = Array.from({ length: inputs }, (_, i) => `in${i + 1}`);
  const ys = names.map((_, i) => 40 * i - 20 * (inputs - 1));
  const half = 20 * (inputs - 1) + 10;
  return {
    pins: { ...Object.fromEntries(names.map((name, i) => [name, pin([-40, ys[i] ?? 0], W)])), out: pin([40, 0], E) },
    box: [-20, -half, 20, half],
    orientation: { by: "pin", pin: "out" },
    swappable: names,
    leads: "M20 0H40",
    pinLeads: Object.fromEntries(names.map((name, i) => [name, `M-40 ${ys[i] ?? 0}H-20`])),
    negatable: names,
    body: `M-20 -${half}H20V${half}H-20Z`,
    text: [[0, 18 - half, sign, "middle"]],
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
  /** A ladder network's left power rail; every rail is the one rail, so they join without a wire. */
  "power-rail": {
    pins: { t: pin([20, 0], E) },
    // Nearly a whole row tall, so a network's rails, one a row, read as one line.
    box: [-2, -48, 2, 48],
    orientation: { by: "any" },
    implicit: () => "power rail",
    leads: "M2 0H20",
    body: "M0 -48V48",
  },
  /**
   * A hard-wired rung's right power rail (L2, the return): a coil and the contacts after it end on
   * it. Every right rail is the one rail, as every left one is.
   */
  "power-rail-right": {
    pins: { t: pin([-20, 0], W) },
    box: [-2, -48, 2, 48],
    orientation: { by: "any" },
    implicit: () => "right power rail",
    leads: "M-20 0H-2",
    body: "M0 -48V48",
  },
  /** A normally open contact, -| |-. */
  no: contact(false),
  /** A normally closed contact, -|/|-. */
  nc: contact(true),
  /** An output coil, -( )-: the operand takes the power reaching it (on through to the right rail, in a hard-wired rung). */
  coil: coil("", false, true),
  /** A set coil, -(S)-, and a reset coil, -(R)-. */
  "coil-s": coil("S"),
  "coil-r": coil("R"),
  /** The S5 timer coils: pulse, extended pulse, on-delay, retentive on-delay, off-delay. */
  "coil-sp": coil("SP", true),
  "coil-se": coil("SE", true),
  "coil-sd": coil("SD", true),
  "coil-ss": coil("SS", true),
  "coil-sf": coil("SF", true),
  /** The S5 counter coils: count up, count down, set the count (its preset below). */
  "coil-cu": coil("CU"),
  "coil-cd": coil("CD"),
  "coil-sc": coil("SC", true),
  /** The S5 timer boxes. */
  "s-pulse": s5TimerBox("S_PULSE"),
  "s-pext": s5TimerBox("S_PEXT"),
  "s-odt": s5TimerBox("S_ODT"),
  "s-odts": s5TimerBox("S_ODTS"),
  "s-offdt": s5TimerBox("S_OFFDT"),
  /** The S5 counter boxes. */
  "s-cu": s5CounterBox("S_CU", true, false),
  "s-cd": s5CounterBox("S_CD", false, true),
  "s-cud": s5CounterBox("S_CUD", true, true),
  /** The IEC on-delay, SFB 4: IN starts it, Q once PT has run; ET the time so far. */
  ton: box(
    "TON",
    20,
    [["IN", -40]],
    [["Q", -40]],
    [
      ["PT", "in", 0],
      ["ET", "out", 0],
    ],
  ),
  /** An FBD operand: a bit read where its wire starts (its address printed beside it). */
  "fbd-in": {
    pins: { t: pin([0, 0], "away-from-label", false) },
    box: [-2, -2, 2, 2],
    orientation: { by: "any" },
    leads: "",
    body: "",
  },
  /** FBD's AND (&) and OR (>=1) boxes, with two, three or four inputs. */
  "fbd-and": fbdBox("&", 2),
  "fbd-and3": fbdBox("&", 3),
  "fbd-and4": fbdBox("&", 4),
  "fbd-or": fbdBox(">=1", 2),
  "fbd-or3": fbdBox(">=1", 3),
  "fbd-or4": fbdBox(">=1", 4),
  /** FBD's negation: the small circle on a line. */
  "fbd-not": {
    pins: { in: pin([-20, 0], W), out: pin([20, 0], E) },
    box: [-6, -6, 6, 6],
    orientation: { by: "pin", pin: "out" },
    leads: "M-20 0H-5M5 0H20",
    body: "",
    circles: [[0, 0, 5]],
  },
  /** FBD's assignment (=), set (S) and reset (R) boxes, their operand above. */
  "fbd-assign": fbdBox("=", 1),
  "fbd-s": fbdBox("S", 1),
  "fbd-r": fbdBox("R", 1),
  ...PNEUMATIC_SYMBOLS,
  ...STATE_DIAGRAM_SYMBOLS,
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
  /** Optional pins the figure leaves off (in no net): not drawn, and no pin of the drawing. */
  open?: readonly string[] | undefined;
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

/** Every pin of the part, in drawing px, by name: an optional pin left open isn't one. */
export function pinsOf(part: Placement): Record<string, Point> {
  return Object.fromEntries(
    Object.entries(symbolOf(part.kind).pins)
      .filter(([name]) => !part.open?.includes(name))
      .map(([name, p]) => [name, toDrawing(part, p.at)]),
  );
}

/** A negation circle's radius: it sits on the body's edge, its lead stopping short of it. */
export const NEGATION_R = 5;

/**
 * A placed part's leads and circles, in local px: each pin's own lead left out while the pin is
 * open, and a negated input's lead stopped at a circle on the body's edge.
 */
export function strokesOf(part: Pick<Placement, "kind" | "open"> & { negated?: readonly string[] | undefined }): {
  leads: string;
  circles: readonly (readonly [number, number, number])[];
} {
  const def: SymbolDef = symbolOf(part.kind);
  const own: string[] = [];
  const circles: (readonly [number, number, number])[] = [...(def.circles ?? [])];
  const edge = def.box[0];
  for (const [name, lead] of Object.entries(def.pinLeads ?? {})) {
    if (part.open?.includes(name)) continue;
    const at = def.pins[name]?.at;
    if (at && part.negated?.includes(name)) {
      own.push(`M${at[0]} ${at[1]}H${edge - 2 * NEGATION_R}`);
      circles.push([edge - NEGATION_R, at[1], NEGATION_R]);
    } else own.push(lead);
  }
  return { leads: own.join("") + def.leads, circles };
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
