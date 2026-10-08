// The block-diagram symbol pack for the layout core: a control loop's transfer-function block and
// summing junction, drawn with the signal's arrowheads where it enters each. Local px, y down,
// origin at the symbol's centre, every pin on the pad's 20px grid (see `symbols.ts`). The figure's
// terminals (R(s), Y(s)) are the core's `port`; a take-off point is a dotted joint on the net.
// Self-contained: the core's kit takes the whole pack in one spread.
import type { SymbolDef } from "./symbols.ts";

const pin = (at: readonly [number, number], faces: readonly [number, number]) => ({ at, faces, lead: true });

export const BLOCK_DIAGRAM_SYMBOLS = {
  /**
   * A transfer-function block: the signal enters on the left, by an arrowhead on the box, and
   * leaves on the right. The figure prints its transfer function (K, G(s)) inside the box.
   */
  block: {
    pins: { in: pin([-60, 0], [-1, 0]), out: pin([60, 0], [1, 0]) },
    box: [-40, -20, 40, 20],
    orientation: { by: "pin", pin: "out" },
    labelInside: true,
    leads: "M-60 0H-48M40 0H60",
    body: "M-40 -20H40V20H-40Z",
    fill: "M-40 0L-48 -4V4Z",
  },
  /**
   * A summing junction: the reference enters on the left with its plus, the fed-back signal from
   * below with its minus, and the error leaves on the right. The figure never labels it, so a
   * Blind reader keys it as SUM.
   */
  sum: {
    // The minus input three grid steps down, so a terminal on the forward path is never pulled into
    // line with it.
    pins: { in1: pin([-40, 0], [-1, 0]), in2: pin([0, 60], [0, 1]), out: pin([40, 0], [1, 0]) },
    box: [-32, -16, 16, 28],
    orientation: { by: "pin", pin: "out" },
    figureKey: "SUM",
    leads: "M-40 0H-24M0 60V24M16 0H40",
    body: "M16 0A16 16 0 1 1 -16 0A16 16 0 1 1 16 0ZM-31 -9H-23M-27 -13V-5M5 27H13",
    fill: "M-16 0L-24 -4V4ZM0 16L-4 24H4Z",
  },
} as const satisfies Record<string, SymbolDef>;

/** The kinds a block diagram is drawn with: its blocks and junctions, and the figure's terminals. */
export const BLOCK_DIAGRAM_KINDS = ["port", "sum", "block"] as const;
