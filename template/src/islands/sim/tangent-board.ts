// The tangent sim's JSXGraph board, drawn in the pad's inks (`board.ts`): the Professor's curve,
// the tangent at P in the pad's print, and the secants from P to Q and to the points a tenth and a
// hundredth of the run along, in pencil, closing on it. P and Q slide along the curve: they are the
// only things a student drags, and a swipe anywhere else on the board scrolls the page.
import type JXGModule from "jsxgraph";
import { valueAt, type Model, type Secant, type Tangent } from "../../sims/tangent/engine.ts";
import type { Range } from "../../sims/tuning.ts";
import { asBackdrop, makeBoard, pointLabel, type Board, type Box, type Inks, type JXG } from "./board.ts";

type Point = JXGModule.Point;

export interface TangentBoard {
  board: Board;
  /** Draws the tangent at a and the secants, and moves P and Q to them. */
  draw(a: number, tangent: Tangent, secants: readonly Secant[]): void;
}

/** The secants' strokes: the one a student drags in full, the shorter runs fainter. */
const SECANT_OPACITY = [0.9, 0.6, 0.4];

/**
 * The plane of x and f(x). Its box spans every point a student can put P and Q at, so neither
 * leaves it, and the curve's height over that span.
 */
export function tangentBoard(
  JXG: JXG,
  el: HTMLElement,
  {
    model,
    tune,
    inks,
    pLabelHtml,
    qLabelHtml,
    onDragP,
    onDragQ,
  }: {
    model: Model;
    tune: { a: Range; h: Range };
    inks: Inks;
    pLabelHtml: string;
    qLabelHtml: string;
    onDragP(x: number): void;
    onDragQ(x: number): void;
  },
): TangentBoard {
  const from = tune.a.min;
  const to = tune.a.max + tune.h.max;
  const xPad = (to - from) * 0.08;
  const heights = Array.from({ length: 161 }, (_, i) => valueAt(model, from + ((to - from) * i) / 160));
  const low = Math.min(...heights);
  const high = Math.max(...heights);
  const yPad = (high - low || 1) * 0.14;
  const box: Box = [from - xPad, high + yPad, to + xPad, low - yPad];
  const board = makeBoard(JXG, el, box, inks);

  board.suspendUpdate();
  const curve = board.create("functiongraph", [(x: number) => valueAt(model, x), box[0], box[2]], {
    strokeColor: inks.graphite,
    strokeWidth: 2,
    highlight: false,
    fixed: true,
  });
  let tangent = { value: 0, slope: 0, at: 0, run: 0 };
  // The lines are drawn as the Professor rules them: segments a little past P and Q, not edge to
  // edge, so they stay clear of the axes' labels.
  const reach = (box[2] - box[0]) * 0.12;
  const lineFrom = () => tangent.at - reach;
  const lineTo = () => tangent.at + tangent.run + reach;
  board.create("functiongraph", [(x: number) => tangent.value + tangent.slope * (x - tangent.at), lineFrom, lineTo], {
    strokeColor: inks.print,
    strokeWidth: 2,
    highlight: false,
    fixed: true,
  });
  const secantSlopes = SECANT_OPACITY.map(() => 0);
  SECANT_OPACITY.forEach((opacity, k) => {
    const line = board.create(
      "functiongraph",
      [(x: number) => tangent.value + (secantSlopes[k] ?? 0) * (x - tangent.at), lineFrom, lineTo],
      {
        strokeColor: inks.pencil,
        strokeWidth: k === 0 ? 1.5 : 1,
        strokeOpacity: opacity,
        dash: k === 0 ? 0 : 2,
        highlight: false,
        fixed: true,
      },
    );
    // The shorter secants lie almost on the tangent: they are the plot's field, which a label may cross.
    if (k > 0) asBackdrop(line);
  });
  // Where the shorter runs end, a tenth and a hundredth of the way to Q.
  const ends: Point[] = SECANT_OPACITY.slice(1).map(() =>
    board.create("point", [0, 0], {
      size: 2,
      strokeColor: inks.pencil,
      fillColor: inks.pencil,
      fixed: true,
      highlight: false,
      withLabel: false,
      showInfobox: false,
    }),
  );
  // JSXGraph's types don't know a glider is a point.
  const handle = (html: string, colour: string, place: Parameters<typeof pointLabel>[2]): Point =>
    board.create("glider", [0, 0, curve], {
      size: 8,
      strokeColor: colour,
      strokeWidth: 2,
      fillColor: inks.sheet,
      highlight: false,
      showInfobox: false,
      cssClass: "sim-handle",
      highlightCssClass: "sim-handle",
      ...pointLabel(html, colour, place),
    }) as unknown as Point;
  // Both names above and left of their points: the lines through P and Q leave them up and right
  // and down and left, and the curve climbs away to the right.
  const upLeft = { offset: [-12, 12] as [number, number], anchorX: "right" as const, anchorY: "bottom" as const };
  const p: Point = handle(pLabelHtml, inks.graphite, upLeft);
  const q: Point = handle(qLabelHtml, inks.pencil, upLeft);
  const place = (point: Point, x: number) => {
    if (point.X() !== x) point.setPosition(JXG.COORDS_BY_USER, [x, valueAt(model, x)]);
  };
  p.on("drag", () => onDragP(p.X()));
  q.on("drag", () => onDragQ(q.X()));
  // A drag the sliders snap back (to the same step, or into range) draws nothing new: on letting
  // go, each handle returns to where the lines were last drawn.
  p.on("up", () => place(p, tangent.at));
  q.on("up", () => place(q, tangent.at + tangent.run));
  board.unsuspendUpdate();
  return {
    board,
    draw(a, { value, slope }, secants) {
      board.suspendUpdate();
      tangent = { value, slope, at: a, run: secants[0]?.run ?? 0 };
      secants.forEach((s, k) => (secantSlopes[k] = s.slope));
      place(p, a);
      place(q, a + (secants[0]?.run ?? 0));
      secants.slice(1).forEach((s, k) => ends[k]?.setPosition(JXG.COORDS_BY_USER, [a + s.run, s.value]));
      board.unsuspendUpdate();
    },
  };
}
