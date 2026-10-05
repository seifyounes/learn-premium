// What every sim's JSXGraph board shares: the pad's inks read from the page's tokens, so a board
// wears the Course's pad and nothing here names a colour, and a board with pencil axes whose tick
// labels are set in screen pixels. A board never zooms or pans, so a swipe on it scrolls the page.
import type JXGModule from "jsxgraph";

export type JXG = typeof JXGModule;
export type Board = JXGModule.Board;

/** The fixed inks and the pad's slots a board draws with. */
export interface Inks {
  graphite: string;
  pencil: string;
  sheet: string;
  gridMajor: string;
  print: string;
}

export function readInks(el: Element): Inks {
  const style = getComputedStyle(el);
  const token = (name: string) => style.getPropertyValue(`--color-${name}`).trim();
  return {
    graphite: token("graphite"),
    pencil: token("pencil"),
    sheet: token("sheet"),
    gridMajor: token("grid-major"),
    print: token("print"),
  };
}

/** JSXGraph's bounding box, in board coordinates. */
export type Box = [xMin: number, yMax: number, xMax: number, yMin: number];

/** Tick spacing giving about five labelled ticks: 1, 2 or 5 times a power of ten. */
export function tickSpacing(span: number): number {
  const rough = span / 5;
  const power = 10 ** Math.floor(Math.log10(rough));
  return ([1, 2, 5, 10].find((m) => m * power >= rough) ?? 10) * power;
}

/** No zooming: the board shows the ranges students tune over. (JSXGraph's types lack `enabled`.) */
const NO_ZOOM = { enabled: false, wheel: false };

/** Tick labels' size in screen pixels, whatever the board's width: the 12px floor holds at 320px. */
export const TICK_PX = 12;
/** A labelled point's name, in screen pixels. */
export const LABEL_PX = 15;

/** Where an axis crosses the other: at 0 when the box shows it, else the box's lowest tick. */
const crossing = (lo: number, hi: number, spacing: number) =>
  lo <= 0 && hi >= 0 ? 0 : Math.ceil(lo / spacing) * spacing;

export interface Axes {
  /** Where the axes cross; it sits on a tick of each. */
  cross: [number, number];
  /** The distance between ticks along x and along y. */
  spacing: [number, number];
}

/** About five ticks a side, the axes crossing at the origin, or at the lowest tick when it's off the box. */
export function axesFor(box: Box): Axes {
  const spacing: [number, number] = [tickSpacing(box[2] - box[0]), tickSpacing(box[1] - box[3])];
  return {
    cross: [crossing(box[0], box[2], spacing[0]), crossing(box[3], box[1], spacing[1])],
    spacing,
  };
}

/**
 * A board with pencil axes. Ticks step from the axes' crossing, so it sits on a tick, and each
 * label prints its own coordinate.
 */
export function makeBoard(JXG: JXG, el: HTMLElement, box: Box, inks: Inks, axes: Axes = axesFor(box)): Board {
  const { cross, spacing } = axes;
  const board = JXG.JSXGraph.initBoard(el, {
    boundingBox: box,
    axis: false,
    keepAspectRatio: false,
    showCopyright: false,
    showNavigation: false,
    showInfobox: false,
    pan: { enabled: false },
    zoom: NO_ZOOM,
  });
  const axis = (to: [number, number], distance: number, coordinate: 1 | 2) =>
    board.create("axis", [cross, to], {
      strokeColor: inks.pencil,
      strokeWidth: 1.2,
      highlight: false,
      lastArrow: false,
      ticks: {
        strokeColor: inks.pencil,
        majorHeight: 6,
        minorTicks: 0,
        insertTicks: false,
        ticksDistance: distance,
        // The axes' crossing is unlabelled: both its labels would sit on each other, and under a
        // handle that starts there.
        drawZero: false,
        // A tick prints where it is, not how far it is from the crossing.
        generateLabelText(this: { formatLabelText(v: number): string }, tick: { usrCoords: number[] }) {
          return this.formatLabelText(tick.usrCoords[coordinate] ?? 0);
        },
        label: {
          cssClass: "sim-tick",
          highlightCssClass: "sim-tick",
          fontSize: TICK_PX,
          fontUnit: "px",
          strokeColor: inks.pencil,
          highlight: false,
          display: "html",
        },
      },
    });
  axis([cross[0] + 1, cross[1]], spacing[0], 1);
  axis([cross[0], cross[1] + 1], spacing[1], 2);
  return board;
}

/** Pixels inside the board's box for a point in its coordinates. */
export function screenOf(JXG: JXG, board: Board, x: number, y: number): [number, number] {
  const c = new JXG.Coords(JXG.COORDS_BY_USER, [x, y], board).scrCoords;
  return [c[1] ?? 0, c[2] ?? 0];
}

/** A labelled point's attributes: its name, set as paper math in screen pixels beside it. */
export function pointLabel(
  html: string,
  colour: string,
  place: { offset: [number, number]; anchorX?: "left" | "right"; anchorY?: "top" | "bottom" } = { offset: [9, 9] },
) {
  return {
    name: html,
    withLabel: true,
    label: {
      cssClass: "sim-board-label",
      highlightCssClass: "sim-board-label",
      fontSize: LABEL_PX,
      fontUnit: "px",
      strokeColor: colour,
      highlight: false,
      display: "html" as const,
      ...place,
    },
  };
}

/** Marks a drawn element as the plot's field, like the sheet's grid: a label may cross it. */
export function asBackdrop(element: { rendNode?: unknown }) {
  (element.rendNode as Element | undefined)?.setAttribute("data-backdrop", "");
}

/** Keeps the boards' coordinates when the column they sit in changes width; returns the disconnect. */
export function fitOnResize(pairs: readonly [Board, HTMLElement | null][], after?: () => void): () => void {
  const observer = new ResizeObserver(() => {
    // A board in a hidden tab has no size: it keeps its own until the tab shows again.
    for (const [board, el] of pairs)
      if (el && el.clientWidth > 0) board.resizeContainer(el.clientWidth, el.clientHeight, true);
    after?.();
  });
  for (const [, el] of pairs) if (el) observer.observe(el);
  return () => observer.disconnect();
}
