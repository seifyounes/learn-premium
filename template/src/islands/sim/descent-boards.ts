// The gradient-descent sim's two JSXGraph boards, drawn in the pad's inks: the cost's contours
// with the descent path and the draggable start, and the data with the fitted line. Every colour is
// read from the page's tokens when the board is made, so the boards wear the Course's pad and
// nothing here names a colour. A board doesn't capture the page's scroll: a swipe that starts off
// the start handle scrolls the page, and only the handle takes a drag.
import type JXGModule from "jsxgraph";
import { contour, type Iterate, type Model, type Trace } from "../../sims/gradient-descent/engine.ts";
import type { Range } from "../../sims/tuning.ts";

type JXG = typeof JXGModule;
type Board = JXGModule.Board;
type Point = JXGModule.Point;
type Curve = JXGModule.Curve;

/** The fixed inks and the pad's slots a board draws with. */
export interface Inks {
  graphite: string;
  pencil: string;
  sheet: string;
  gridMajor: string;
}

export function readInks(el: Element): Inks {
  const style = getComputedStyle(el);
  const token = (name: string) => style.getPropertyValue(`--color-${name}`).trim();
  return {
    graphite: token("graphite"),
    pencil: token("pencil"),
    sheet: token("sheet"),
    gridMajor: token("grid-major"),
  };
}

/** JSXGraph's bounding box, in board coordinates. */
type Box = [xMin: number, yMax: number, xMax: number, yMin: number];

/** Tick spacing giving about five labelled ticks: 1, 2 or 5 times a power of ten. */
function tickSpacing(span: number): number {
  const rough = span / 5;
  const power = 10 ** Math.floor(Math.log10(rough));
  return ([1, 2, 5, 10].find((m) => m * power >= rough) ?? 10) * power;
}

/** No zooming: the board shows the ranges students tune over. (JSXGraph's types lack `enabled`.) */
const NO_ZOOM = { enabled: false, wheel: false };

function makeBoard(JXG: JXG, el: HTMLElement, box: Box, inks: Inks): Board {
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
  const axis = (from: [number, number], to: [number, number], span: number) =>
    board.create("axis", [from, to], {
      strokeColor: inks.pencil,
      strokeWidth: 1.2,
      highlight: false,
      lastArrow: false,
      ticks: {
        strokeColor: inks.pencil,
        majorHeight: 6,
        minorTicks: 0,
        insertTicks: false,
        ticksDistance: tickSpacing(span),
        drawZero: true,
        label: {
          cssClass: "sim-tick",
          highlightCssClass: "sim-tick",
          strokeColor: inks.pencil,
          highlight: false,
          display: "html",
        },
      },
    });
  axis([0, 0], [1, 0], box[2] - box[0]);
  axis([0, 0], [0, 1], box[1] - box[3]);
  return board;
}

/** Pixels inside the board's box for a point in its coordinates. */
export function screenOf(JXG: JXG, board: Board, x: number, y: number): [number, number] {
  const c = new JXG.Coords(JXG.COORDS_BY_USER, [x, y], board).scrCoords;
  return [c[1] ?? 0, c[2] ?? 0];
}

export interface ContourBoard {
  board: Board;
  draw(trace: Trace): void;
  /** Moves the start handle (a slider moved it, or a drag snapped it). */
  moveStart(theta0: number, theta1: number): void;
}

/**
 * The plane of θ0 and θ1: the cost's contours about the minimum, the descent path and its iterates,
 * and the start, the one thing a student drags. Its box spans the ranges students tune the start
 * over, so the start never leaves it.
 */
export function contourBoard(
  JXG: JXG,
  el: HTMLElement,
  {
    model,
    minimum,
    tune,
    levelsFrom,
    inks,
    startLabelHtml,
    minimumLabelHtml,
    onDrag,
  }: {
    model: Model;
    minimum: Trace["minimum"];
    tune: { theta0: Range; theta1: Range };
    /** The cost the example starts at: the contours step down from it. */
    levelsFrom: number;
    inks: Inks;
    startLabelHtml: string;
    minimumLabelHtml: string;
    onDrag(theta0: number, theta1: number): void;
  },
): ContourBoard {
  const pad = (r: Range) => (r.max - r.min) * 0.06;
  const box: Box = [
    tune.theta0.min - pad(tune.theta0),
    tune.theta1.max + pad(tune.theta1),
    tune.theta0.max + pad(tune.theta0),
    tune.theta1.min - pad(tune.theta1),
  ];
  const board = makeBoard(JXG, el, box, inks);
  const label = (html: string, colour: string) => ({
    name: html,
    withLabel: true,
    label: {
      cssClass: "sim-board-label",
      highlightCssClass: "sim-board-label",
      strokeColor: colour,
      highlight: false,
      display: "html" as const,
      offset: [9, 9],
    },
  });

  board.suspendUpdate();
  // The contours: the start's level, one above it, and levels closing in on the minimum.
  for (const share of [1.8, 1, 0.55, 0.28, 0.12, 0.04]) {
    const ellipse = contour(model, minimum.J + (levelsFrom - minimum.J) * share);
    if (!ellipse) continue;
    board.create("curve", [(t: number) => ellipse.at(t)[0], (t: number) => ellipse.at(t)[1], 0, 2 * Math.PI], {
      strokeColor: inks.pencil,
      strokeWidth: 1,
      strokeOpacity: 0.55,
      highlight: false,
      fixed: true,
    });
  }
  board.create("point", [minimum.theta0, minimum.theta1], {
    face: "x",
    size: 4,
    strokeColor: inks.pencil,
    fillColor: inks.pencil,
    strokeWidth: 1.5,
    fixed: true,
    highlight: false,
    showInfobox: false,
    ...label(minimumLabelHtml, inks.pencil),
  });

  const path: Curve = board.create("curve", [[], []], {
    strokeColor: inks.graphite,
    strokeWidth: 2,
    highlight: false,
    fixed: true,
  });
  const dots: Point[] = [];
  const dot = (i: number) => {
    while (dots.length <= i) {
      dots.push(
        board.create("point", [0, 0], {
          size: 2.5,
          strokeColor: inks.graphite,
          fillColor: inks.graphite,
          fixed: true,
          highlight: false,
          withLabel: false,
          showInfobox: false,
          visible: false,
        }),
      );
    }
    return dots[i] as Point;
  };

  const handle: Point = board.create("point", [0, 0], {
    size: 8,
    strokeColor: inks.graphite,
    strokeWidth: 2,
    fillColor: inks.sheet,
    highlight: false,
    showInfobox: false,
    cssClass: "sim-handle",
    highlightCssClass: "sim-handle",
    ...label(startLabelHtml, inks.graphite),
  });
  handle.on("drag", () => onDrag(handle.X(), handle.Y()));
  board.unsuspendUpdate();

  return {
    board,
    draw(trace) {
      board.suspendUpdate();
      path.dataX = trace.iterates.map((r) => r.theta0);
      path.dataY = trace.iterates.map((r) => r.theta1);
      trace.iterates.forEach((r: Iterate, i) => {
        if (i === 0) return; // the start is the handle
        dot(i).setPosition(JXG.COORDS_BY_USER, [r.theta0, r.theta1]);
        dot(i).setAttribute({ visible: true });
      });
      dots.slice(Math.max(trace.iterates.length, 1)).forEach((p) => p.setAttribute({ visible: false }));
      board.unsuspendUpdate();
    },
    moveStart(theta0, theta1) {
      if (handle.X() === theta0 && handle.Y() === theta1) return;
      handle.setPosition(JXG.COORDS_BY_USER, [theta0, theta1]);
      board.update();
    },
  };
}

export interface FitBoard {
  board: Board;
  draw(theta0: number, theta1: number): void;
}

/** The Professor's data, fixed, and the line h(x) = θ0 + θ1·x at the latest step. */
export function fitBoard(JXG: JXG, el: HTMLElement, { model, inks }: { model: Model; inks: Inks }): FitBoard {
  const xs = model.data.map(([x]) => x);
  const ys = model.data.map(([, y]) => y);
  const span = (values: number[]) => Math.max(...values) - Math.min(...values) || 1;
  const box: Box = [
    Math.min(0, ...xs) - span(xs) * 0.15,
    Math.max(0, ...ys) + span(ys) * 0.25,
    Math.max(...xs) + span(xs) * 0.25,
    Math.min(0, ...ys) - span(ys) * 0.15,
  ];
  const board = makeBoard(JXG, el, box, inks);
  let line = { theta0: 0, theta1: 0 };
  board.suspendUpdate();
  board.create("functiongraph", [(x: number) => line.theta0 + line.theta1 * x], {
    strokeColor: inks.graphite,
    strokeWidth: 2,
    highlight: false,
    fixed: true,
  });
  for (const [x, y] of model.data) {
    board.create("point", [x, y], {
      size: 3.5,
      strokeColor: inks.graphite,
      fillColor: inks.graphite,
      fixed: true,
      highlight: false,
      withLabel: false,
      showInfobox: false,
    });
  }
  board.unsuspendUpdate();
  return {
    board,
    draw(theta0, theta1) {
      line = { theta0, theta1 };
      board.update();
    },
  };
}
