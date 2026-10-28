// The state-diagram symbol pack for the layout core: the Professor's state diagram (a Moore
// machine's circles, the accepting state's double circle) and GRAFCET/SFC (IEC 60848: a step's
// square, the initial step's double square). Local px, y down, origin at the symbol's centre.
//
// There are no pins: an edge meets a state anywhere on its outline, and the curve drawer
// (`curves.ts`) finds where. The state's name prints inside its body, a step's actions in a box
// beside it (the `action` slot). Self-contained: the core's kit takes the pack in one spread.
import type { SymbolDef } from "./symbols.ts";

export const FSM_KINDS = ["state", "state-accepting"] as const;
export const GRAFCET_KINDS = ["step", "step-initial"] as const;
export const STATE_DIAGRAM_KINDS = [...FSM_KINDS, ...GRAFCET_KINDS] as const;
export type StateDiagramKind = (typeof STATE_DIAGRAM_KINDS)[number];

/** A state's circle. */
export const STATE_R = 30;
/** An accepting state's inner circle. */
export const ACCEPTING_R = 25;
/** A step's square is twice this on a side. */
export const STEP_HALF = 20;

/** The line an edge meets: a state's circle, a step's square. */
export type Outline = { shape: "circle"; r: number } | { shape: "square"; half: number };

export function outlineOf(kind: StateDiagramKind): Outline {
  return kind === "state" || kind === "state-accepting"
    ? { shape: "circle", r: STATE_R }
    : { shape: "square", half: STEP_HALF };
}

const STEP_BODY = "M-20 -20H20V20H-20Z";
const STEP_BOX = [-STEP_HALF, -STEP_HALF, STEP_HALF, STEP_HALF] as const;
const STATE_BOX = [-STATE_R, -STATE_R, STATE_R, STATE_R] as const;

export const STATE_DIAGRAM_SYMBOLS = {
  /** A state: a circle, its name and output printed inside. */
  state: {
    pins: {},
    box: STATE_BOX,
    orientation: { by: "any" },
    labelInside: true,
    leads: "",
    body: "",
    circles: [[0, 0, STATE_R]],
  },
  /** An accepting state: the double circle. */
  "state-accepting": {
    pins: {},
    box: STATE_BOX,
    orientation: { by: "any" },
    labelInside: true,
    leads: "",
    body: "",
    circles: [
      [0, 0, STATE_R],
      [0, 0, ACCEPTING_R],
    ],
  },
  /** A GRAFCET step: a square, its number inside, its actions in the box beside it. */
  step: {
    pins: {},
    box: STEP_BOX,
    orientation: { by: "any" },
    labelInside: true,
    leads: "",
    body: STEP_BODY,
    slots: { action: { at: [48, 5], anchor: "start" } },
  },
  /** An initial step: the double square. */
  "step-initial": {
    pins: {},
    box: STEP_BOX,
    orientation: { by: "any" },
    labelInside: true,
    leads: "",
    body: `${STEP_BODY}M-16 -16H16V16H-16Z`,
    slots: { action: { at: [48, 5], anchor: "start" } },
  },
} as const satisfies Record<StateDiagramKind, SymbolDef>;
