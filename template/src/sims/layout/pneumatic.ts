// The pneumatic symbol pack for the layout core: ISO 1219 symbols as a Professor draws a
// pneumatic circuit: a double-acting cylinder, a 5/2 double-pilot valve, 3/2 normally closed roller
// and push-button valves, and an air source. Local px, y down, origin at the symbol's centre, every
// pin on the pad's 20px grid (see `symbols.ts`). Every symbol is drawn for turn 0: its port numbers
// are 12px text, which a turned part would turn with it.
//
// Each `SymbolDef` holds only what never moves: stubs, ports and exhausts. The moving parts (a
// valve's boxes and actuators, a cylinder's piston and rod) are drawn by the pure functions below,
// which the island lays over the drawing, so what a valve draws in each state is a function the
// engine's own passages are tested against. Self-contained: the core's kit takes the pack in one
// spread.
import type { Point, SymbolDef } from "./symbols.ts";

const W = [-1, 0] as const;
const E = [1, 0] as const;
const N = [0, -1] as const;
const S = [0, 1] as const;
const pin = (at: readonly [number, number], faces: readonly [number, number]) => ({ at, faces, lead: true });

export const PNEUMATIC_KINDS = ["cylinder", "valve-52", "valve-32-roller", "valve-32-button", "air-source"] as const;
export type PneumaticKind = (typeof PNEUMATIC_KINDS)[number];

export const PNEUMATIC_SYMBOLS = {
  /** A double-acting, single-rod cylinder, rod to the right: `cap` extends it, `rod` retracts it. */
  cylinder: {
    pins: { cap: pin([-40, 40], S), rod: pin([40, 40], S) },
    box: [-62, -30, 142, 16],
    orientation: { by: "full" },
    leads: "M-40 14V40M40 14V40",
    // The barrel, and the two stroke-end ticks the rod's tip lands on.
    body: "M-60 -14H60V14H-60ZM80 -30V-18M140 -30V-18",
    // The roller valve at each end prints its label over its tick, as the figure does.
    slots: { retracted: { at: [80, -34], anchor: "middle" }, extended: { at: [140, -34], anchor: "middle" } },
  },
  /** A 5/2 valve, air-piloted at both ends: it keeps the side its last pilot set (a memory valve). */
  "valve-52": {
    pins: {
      "4": pin([-20, -40], N),
      "2": pin([20, -40], N),
      "1": pin([0, 40], S),
      "14": pin([-120, 0], W),
      "12": pin([120, 0], E),
    },
    box: [-104, -20, 104, 32],
    orientation: { by: "full" },
    // Port stubs, then the exhaust stubs.
    leads: "M-20 -40V-20M20 -40V-20M0 20V40M-20 20V24M20 20V24",
    body: "M-20 24L-25 32H-15ZM20 24L15 32H25Z",
    text: [
      [-26, -26, "4", "end"],
      [26, -26, "2", "start"],
      [-5, 36, "1", "end"],
      [-112, -8, "14", "middle"],
      [112, -8, "12", "middle"],
    ],
  },
  /** A 3/2 valve, normally closed, roller-operated, spring return. */
  "valve-32-roller": valve32(),
  /** A 3/2 valve, normally closed, push-button-operated, spring return. */
  "valve-32-button": valve32(),
  /** The supply. Every source joins every other without a wire; a figure reading keys it AIR.t. */
  "air-source": {
    pins: { t: pin([0, 0], N) },
    box: [-11, 5, 11, 27],
    orientation: { by: "any" },
    implicit: () => "air supply",
    figureKey: "AIR",
    leads: "M0 0V6",
    body: "",
    circles: [[0, 16, 10]],
    fill: "M0 9L-6 20H6Z",
  },
} as const satisfies Record<PneumaticKind, SymbolDef>;

function valve32() {
  return {
    pins: { "2": pin([0, -40], N), "1": pin([0, 40], S) },
    box: [-76, -20, 76, 32],
    orientation: { by: "full" },
    leads: "M0 -40V-20M0 20V40M12 20V24",
    body: "M12 24L7 32H17Z",
    text: [
      [6, -26, "2", "start"],
      [-5, 36, "1", "end"],
    ],
  } as const satisfies SymbolDef;
}

/** A cylinder's rod travel on the drawing, retracted to extended. */
export const STROKE_PX = 60;

/** The state a valve's boxes are shifted into: a 5/2 valve's pilot side, a 3/2 valve made or freed. */
export type Actuation = "12" | "14" | "made" | "freed";
type Valve = "valve-52" | "valve-32-roller" | "valve-32-button";

/** One passage a valve box draws: an arrow from one port to another; `EXH` is an exhaust. */
export interface Flow {
  from: Point;
  to: Point;
  pins: readonly [string, string];
}
/** One box of a valve's pair, as drawn in the pair frame (the pair unshifted, origin at the valve). */
export interface ValveBox {
  state: Actuation;
  /** The box's centre along x; the box is `valveOffset` away from the stubs when it is the state. */
  centre: number;
  flows: readonly Flow[];
  /** The ports this box draws closed, a T at the port (a 3/2 valve's port 1 while released). */
  blocked: readonly string[];
}

/** The boxes of a valve's pair, in the pair frame, in the order the symbol lists them. */
export function valveBoxes(kind: Valve): readonly ValveBox[] {
  if (kind === "valve-52") {
    const [a, b] = [-30, 30];
    return [
      {
        state: "14",
        centre: a,
        flows: [
          { from: [a, 20], to: [a - 20, -20], pins: ["1", "4"] },
          { from: [a + 20, -20], to: [a + 20, 20], pins: ["2", "EXH"] },
        ],
        blocked: [],
      },
      {
        state: "12",
        centre: b,
        flows: [
          { from: [b, 20], to: [b + 20, -20], pins: ["1", "2"] },
          { from: [b - 20, -20], to: [b - 20, 20], pins: ["4", "EXH"] },
        ],
        blocked: [],
      },
    ];
  }
  const [made, freed] = [-20, 20];
  return [
    { state: "made", centre: made, flows: [{ from: [made, 20], to: [made, -20], pins: ["1", "2"] }], blocked: [] },
    {
      state: "freed",
      centre: freed,
      flows: [{ from: [freed, -20], to: [freed + 12, 20], pins: ["2", "EXH"] }],
      blocked: ["1"],
    },
  ];
}

/** How far the pair slides along x to bring a state's box over the stubs. */
export function valveOffset(kind: Valve, state: Actuation): number {
  if (kind === "valve-52") return state === "14" ? 30 : -30;
  return state === "made" ? 20 : -20;
}

const round = (v: number) => Math.round(v * 10) / 10;
const round3 = (v: number) => Math.round(v * 1000) / 1000;
/** A filled arrowhead at `to`, pointing along from → to. */
function arrow(from: Point, to: Point): string {
  const [dx, dy] = [to[0] - from[0], to[1] - from[1]];
  const len = Math.hypot(dx, dy);
  const [ux, uy] = [dx / len, dy / len];
  const [bx, by] = [to[0] - 6 * ux, to[1] - 6 * uy];
  const [px, py] = [-uy * 3, ux * 3];
  return `M${round(to[0])} ${round(to[1])}L${round(bx + px)} ${round(by + py)}L${round(bx - px)} ${round(by - py)}Z`;
}

/** The pair's strokes, `d`, and its filled marks, `fill`: both boxes, their flows, the actuators. Pair frame. */
export function pairPath(kind: Valve): { d: string; fill: string } {
  const boxes = valveBoxes(kind);
  const half = kind === "valve-52" ? 30 : 20;
  let d = "";
  let fill = "";
  for (const box of boxes) {
    d += `M${box.centre - half} -20H${box.centre + half}V20H${box.centre - half}Z`;
    for (const f of box.flows) {
      d += `M${f.from[0]} ${f.from[1]}L${f.to[0]} ${f.to[1]}`;
      fill += arrow(f.from, f.to);
    }
    // A closed port: a T on the box's foot.
    if (box.blocked.length > 0) d += `M${box.centre} 20V12M${box.centre - 5} 12H${box.centre + 5}`;
  }
  if (kind === "valve-52") {
    // Air-pilot actuators: a 12 x 16 box with a filled triangle pointing in.
    d += "M-72 -8H-60V8H-72ZM60 -8H72V8H60Z";
    fill += "M-70 -5L-62 0L-70 5ZM70 -5L62 0L70 5Z";
  } else {
    d += kind === "valve-32-roller" ? "M-40 0H-46M-46 0A5 5 0 1 1 -56 0A5 5 0 1 1 -46 0Z" : "M-40 0H-50M-50 -8V8";
    // The return spring on the freed side.
    d += "M40 0L43 -6L47 6L51 -6L54 6L56 0";
  }
  return { d, fill };
}

/** A 5/2 valve's pilot leads, from each port number to its actuator as the pair has slid by `offset`. */
export function pilotLeads(offset: number): string {
  return `M-120 0H${-72 + offset}M120 0H${72 + offset}`;
}

/** The piston and the rod of a cylinder at `fraction` (0 retracted … 1 extended): local px. */
export function cylinderMoving(fraction: number): { d: string; fill: string } {
  const x = round3(-40 + STROKE_PX * fraction);
  const tip = round3(80 + STROKE_PX * fraction);
  return {
    // The rod, from the piston to its tip.
    d: `M${x + 3} -4H${tip}V4H${x + 3}`,
    // The piston, a 6px bar across the bore.
    fill: `M${x - 3} -12H${x + 3}V12H${x - 3}Z`,
  };
}
