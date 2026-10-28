// The kinematics engine's own models: what it needs to know of a four-bar and of a gear pair. The
// content contract's `mechanism` model (`src/content/contract.ts`) must be assignable to these.
// Lengths are in mm and angles in degrees; the sheet frame has x along the ground line and y up.

/** A point in the sheet frame, in mm. */
export type Point = readonly [x: number, y: number];

export interface FourBar {
  type: "four-bar";
  /** O2O4, O2A, AB, O4B as the figure gives them: ground, crank (the driver), coupler, rocker. */
  ground: number;
  crank: number;
  coupler: number;
  rocker: number;
  /** `open`: B lies to the left of the line from A to O4; `crossed`: to its right. */
  assembly: "open" | "crossed";
  /** A point on the coupler whose path the drawing traces: `along` AB from A, `off` to its left. */
  couplerPoint?: { along: number; off: number } | undefined;
  /** The figure's letters for O2, A, B, O4, P, when it prints others. */
  labels?: Record<string, string> | undefined;
}

export interface GearPair {
  type: "gear-pair";
  /** Standard full-depth involute spur gears: addendum m, dedendum 1.25 m, no backlash, no profile shift. */
  module: number;
  /** The driver's teeth first. */
  teeth: readonly [number, number];
  pressureAngle: number;
  faceWidth: number;
  /** As the figure states it; m(N1 + N2)/2 when it states none. */
  centreDistance?: number | undefined;
  /** The figure's letters for O1, O2, when it prints others. */
  labels?: Record<string, string> | undefined;
}

export type Model = FourBar | GearPair;

export type LinkId = "ground" | "crank" | "coupler" | "rocker" | "driver" | "driven";

/** The links that move with the driver, and so have an angle to check. */
export const MOVING_LINKS = {
  "four-bar": ["crank", "coupler", "rocker"],
  "gear-pair": ["driver", "driven"],
} as const satisfies Record<Model["type"], readonly LinkId[]>;

/** The pins off the ground whose paths the trace keeps. */
export const TRACED_PINS = {
  "four-bar": ["A", "B", "P"],
  "gear-pair": ["H", "T"],
} as const satisfies Record<Model["type"], readonly string[]>;
