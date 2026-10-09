// The control sim's JSXGraph boards, drawn in the pad's inks (`board.ts`): the root locus with the
// closed-loop poles a student drags along it, the step response with its overshoot and settling
// time marked in red pen (strokes, never a fill), the open loop's Bode plot on a log frequency axis,
// and its Nyquist plot round the critical point. Only the poles take a drag; a swipe anywhere else
// on a board scrolls the page.
import type JXGModule from "jsxgraph";
import {
  closedLoop,
  rootsOf,
  frequency,
  locus,
  margins,
  stepCurve,
  stepInfo,
  type Definitions,
  type Margins,
  type Model,
  type StepInfo,
} from "../../sims/control/engine.ts";
import type { Complex } from "../../sims/control/linear.ts";
import { snap, type Range } from "../../sims/tuning.ts";
import {
  asBackdrop,
  LABELS_LEFT,
  makeBoard,
  readInks,
  tickSpacing,
  type Board,
  type Box,
  type Inks,
  type JXG,
} from "./board.ts";

type Curve = JXGModule.Curve;
type Point = JXGModule.Point;

/** The pad's inks, and the red pen that marks the step response. */
export interface ControlInks extends Inks {
  redPen: string;
}

export function readControlInks(el: Element): ControlInks {
  return { ...readInks(el), redPen: getComputedStyle(el).getPropertyValue("--color-red-pen").trim() };
}

/** Gains a board samples the slider at, at most: a fine slider must not freeze a phone. */
const MOST_GAINS = 400;

/**
 * The gains a student can set, min to max by the slider's step, snapped as the slider snaps them
 * (a range its step doesn't divide ends on its max). A slider with more steps than `MOST_GAINS` is
 * sampled evenly instead, its ends kept: the boards size and snap drags by these.
 */
export function gainsOf(range: Range): number[] {
  const n = Math.ceil((range.max - range.min) / range.step - 1e-9);
  const count = Math.min(n, MOST_GAINS);
  return [
    ...new Set(
      Array.from({ length: count + 1 }, (_, i) => snap(range.min + ((range.max - range.min) * i) / count, range)),
    ),
  ];
}

const fixedLine = { highlight: false, fixed: true } as const;

/** A box round `points`, padded, never thinner than `least` either way. */
function boxRound(xs: number[], ys: number[], pad = 0.12, least = 1): Box {
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const w = Math.max(x1 - x0, least);
  const h = Math.max(y1 - y0, least);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  return [
    cx - (w / 2) * (1 + 2 * pad),
    cy + (h / 2) * (1 + 2 * pad),
    cx + (w / 2) * (1 + 2 * pad),
    cy - (h / 2) * (1 + 2 * pad),
  ];
}

/**
 * Axes along the box's lower and inline-start edges, each on a tick, with room left outside them
 * for their labels (the vertical axis's printed to its left): a curve that runs to the box's edge
 * then never crosses a label. `inside` is where a curve may be drawn, clear of both axes.
 */
function edgeAxes(
  box: Box,
  room: { start?: number; below?: number } = {},
  spacing: [number, number] = [tickSpacing(box[2] - box[0]), tickSpacing(box[1] - box[3])],
) {
  const w = box[2] - box[0];
  const h = box[1] - box[3];
  // On the box's edge when it falls on a tick, else on the tick past it: never through the plot.
  // Where that tick lies far past the edge, the ticks step finer (5, 2, 1…) to bring it closer.
  const onTick = (v: number, s: number) => Math.floor(v / s + 1e-9) * s;
  const finer = (s: number) => (String(s).startsWith("5") ? s / 2.5 : s / 2);
  const settle = (v: number, s: number, span: number) => {
    let step = s;
    while (v - onTick(v, step) > 0.12 * span && step > span / 6) step = finer(step);
    return step;
  };
  spacing = [settle(box[0], spacing[0], w), settle(box[3], spacing[1], h)];
  const cross: [number, number] = [onTick(box[0], spacing[0]), onTick(box[3], spacing[1])];
  const framed: Box = [
    Math.min(box[0], cross[0] - (room.start ?? 0.12) * w),
    box[1],
    box[2],
    Math.min(box[3], cross[1] - (room.below ?? 0.12) * h),
  ];
  return {
    box: framed,
    axes: { cross, spacing },
    inside: ([x, y]: readonly [number, number]) =>
      x > cross[0] + 0.02 * w && y > cross[1] + 0.03 * h && x < box[2] && y < box[1],
  };
}

/** A pencil guide the labels may cross: an axis drawn where it passes through the plot. */
function guideLine(board: Board, inks: Inks, from: [number, number], to: [number, number], dash = 0) {
  const s = stroke(board, { strokeColor: inks.pencil, strokeWidth: 1, dash });
  s.set([from, to]);
  asBackdrop(s.curve);
  return s;
}

/**
 * A board sized by the sim alone (`fitOnResize`), never by JSXGraph's own observer: that one keeps
 * the size it saw when a tab showed the board and applies it after a timer, so on a busy page it
 * can land after a later resize and stretch the board past its box.
 */
function ownSized(board: Board): Board {
  board.stopResizeObserver();
  return board;
}

/**
 * The points a curve keeps inside its frame, broken (by a NaN point, which JSXGraph doesn't join
 * across) wherever it leaves and comes back, so no straight chord is drawn over the plane.
 */
export function within(
  points: readonly (readonly [number, number])[],
  inside: (p: readonly [number, number]) => boolean,
): (readonly [number, number])[] {
  const out: (readonly [number, number])[] = [];
  for (const p of points) {
    if (inside(p)) out.push(p);
    else if (out.length > 0 && !Number.isNaN(out.at(-1)?.[0])) out.push([NaN, NaN]);
  }
  return Number.isNaN(out.at(-1)?.[0]) ? out.slice(0, -1) : out;
}

/** A two-point stroke, moved by `set`. */
function stroke(board: Board, attributes: Record<string, unknown>) {
  const curve: Curve = board.create("curve", [[], []], { ...fixedLine, ...attributes });
  return {
    curve,
    set(points: readonly (readonly [number, number])[]) {
      curve.dataX = points.map((p) => p[0]);
      curve.dataY = points.map((p) => p[1]);
    },
  };
}

// ---------- root locus ----------

export interface LocusBoard {
  board: Board;
  /** Moves the closed-loop poles' handles to the poles at the gain set. */
  draw(poles: readonly Complex[]): void;
}

/**
 * The s-plane: every branch of the locus over the gains a student can reach, the open-loop poles
 * as crosses and zeros as rings, and a handle on each closed-loop pole. Dragging a handle sets the
 * gain whose pole lies nearest it.
 */
export function locusBoard(
  JXG: JXG,
  el: HTMLElement,
  { model, tune, inks, onDrag }: { model: Model; tune: Range; inks: Inks; onDrag(K: number): void },
): LocusBoard {
  // From K = 0 (the open-loop poles) past the slider's top, densest near 0 where branches move fastest.
  const gains = [0, ...Array.from({ length: 240 }, (_, i) => tune.max * 1.25 * ((i + 1) / 240) ** 2)];
  const branches = locus(model, gains);
  // The open-loop zeros are on the plane too, however far the reachable gains leave them.
  const all = [...branches.flat(), ...rootsOf(model.plant.zeros)];
  const frame = edgeAxes(
    boxRound(
      all.map((p) => p[0]),
      all.map((p) => p[1]),
      0.15,
      2,
    ),
  );
  const { box } = frame;
  const board = ownSized(makeBoard(JXG, el, box, inks, frame.axes, { y: LABELS_LEFT }));
  board.suspendUpdate();
  // The real and imaginary axes, where they cross the plane drawn.
  if (box[3] < 0 && box[1] > 0) guideLine(board, inks, [box[0], 0], [box[2], 0]);
  if (box[0] < 0 && box[2] > 0) guideLine(board, inks, [0, box[3]], [0, box[1]]);
  for (const branch of branches) {
    // Each branch stops short of the axes' labels: it runs outward as K grows.
    const kept = branch.filter(frame.inside);
    board.create("curve", [kept.map((p) => p[0]), kept.map((p) => p[1])], {
      ...fixedLine,
      strokeColor: inks.pencil,
      strokeWidth: 1.5,
    });
  }
  const mark = (at: Complex, face: "x" | "o") =>
    board.create("point", [at[0], at[1]], {
      ...fixedLine,
      face,
      size: 5,
      strokeColor: inks.graphite,
      strokeWidth: 2,
      fillColor: inks.sheet,
      withLabel: false,
      showInfobox: false,
    });
  branches
    .map((b) => b[0])
    .filter((p): p is Complex => p !== undefined)
    .forEach((p) => mark(p, "x"));
  const zeros = model.plant.zeros.flatMap((z): Complex[] =>
    typeof z === "number"
      ? [[z, 0]]
      : [
          [z[0], z[1]],
          [z[0], -z[1]],
        ],
  );
  zeros.forEach((z) => mark(z, "o"));

  // The poles at every gain the slider can take: a drag snaps to the nearest of them.
  const reachable = gainsOf(tune).map((K) => ({ K, poles: closedLoop(model, K).poles }));
  const nearestGain = (x: number, y: number) => {
    let best = reachable[0];
    let gap = Infinity;
    for (const r of reachable) {
      for (const [re, im] of r.poles) {
        const d = Math.hypot(re - x, im - y);
        if (d < gap) [gap, best] = [d, r];
      }
    }
    return best?.K ?? tune.min;
  };
  let current: readonly Complex[] = [];
  const handles: Point[] = branches.map(() =>
    board.create("point", [0, 0], {
      size: 8,
      strokeColor: inks.graphite,
      strokeWidth: 2,
      fillColor: inks.sheet,
      highlight: false,
      showInfobox: false,
      withLabel: false,
      cssClass: "sim-handle",
      highlightCssClass: "sim-handle",
    }),
  );
  const place = () =>
    handles.forEach((h, i) => {
      const p = current[i];
      if (p && (h.X() !== p[0] || h.Y() !== p[1])) h.setPosition(JXG.COORDS_BY_USER, [p[0], p[1]]);
    });
  for (const h of handles) {
    h.on("drag", () => onDrag(nearestGain(h.X(), h.Y())));
    // Let go anywhere and the handle returns onto the locus, at the gain it set.
    h.on("up", () => {
      board.suspendUpdate();
      place();
      board.unsuspendUpdate();
    });
  }
  board.unsuspendUpdate();
  return {
    board,
    draw(poles) {
      current = poles;
      board.suspendUpdate();
      place();
      board.unsuspendUpdate();
    },
  };
}

// ---------- step response ----------

/**
 * Points the step response is drawn with: 300, or 16 a swing of its fastest oscillating pole when
 * that is more, so a lightly damped response is drawn swing by swing, never aliased (capped for a
 * phone's sake).
 */
/** Points the step board may compute, all gains together, to size its height. */
const EXTENT_POINTS = 60_000;

function plotSamples(model: Model, K: number, until: number): number {
  const fastest = Math.max(0, ...closedLoop(model, K).poles.map(([, im]) => Math.abs(im)));
  return Math.min(Math.max(300, Math.ceil((until * fastest * 16) / (2 * Math.PI))), 20_000);
}

export interface StepBoard {
  board: Board;
  draw(K: number, info: StepInfo | undefined): void;
}

/**
 * The step response over twice the example's settling time, so the example's response fills the
 * board; a slower one runs off its edge. Its height holds the highest peak a student can reach.
 */
export function stepBoard(
  JXG: JXG,
  el: HTMLElement,
  {
    model,
    start,
    tune,
    definitions,
    inks,
  }: { model: Model; start: number; tune: Range; definitions: Definitions; inks: ControlInks },
): StepBoard {
  const until = Math.max(1, stepInfo(model, start, definitions)?.Ts ?? 0) * 2;
  // Its height holds every stable response a student can reach, either side of 0 (a negative gain
  // settles below it).
  // Read sample by sample: a fine slider over a long span holds more values than a spread can pass.
  // The whole board shares one budget of points, split across the gains it samples, so opening the
  // tab never holds a phone however wide the slider or long the span.
  let [hi, lo] = [0, 0];
  const gains = [start, ...gainsOf(tune)];
  const each = Math.max(50, Math.floor(EXTENT_POINTS / gains.length));
  for (const K of gains) {
    const loop = closedLoop(model, K);
    if (!loop.stable) continue;
    const final = (loop.numerator.at(-1) ?? 0) / (loop.denominator.at(-1) ?? 1);
    [hi, lo] = [Math.max(hi, final), Math.min(lo, final)];
    for (const [, y] of stepCurve(model, K, until, Math.min(plotSamples(model, K, until), each))) {
      if (y > hi) hi = y;
      if (y < lo) lo = y;
    }
  }
  const span = hi - lo || 1;
  // The value axis's labels sit left of it, clear of the response that climbs from it.
  const box: Box = [-until * 0.12, hi + span * 0.12, until * 1.04, lo - span * 0.12];
  const spacing: [number, number] = [tickSpacing(until), tickSpacing(span)];
  const board = ownSized(makeBoard(JXG, el, box, inks, { cross: [0, 0], spacing }, { y: LABELS_LEFT }));
  const band = definitions.settlingTime.band;

  board.suspendUpdate();
  const dashed = (dash: number, opacity = 1) => {
    const s = stroke(board, { strokeColor: inks.pencil, strokeWidth: 1, strokeOpacity: opacity, dash });
    asBackdrop(s.curve);
    return s;
  };
  const finalLine = dashed(2);
  const bandLines = [dashed(1, 0.6), dashed(1, 0.6)];
  const response = stroke(board, { strokeColor: inks.graphite, strokeWidth: 2 });
  // The red pen's marks: the overshoot as a bracket from the final value up to the peak, and the
  // settling time as a stroke down to the time axis.
  const pen = { strokeColor: inks.redPen, strokeWidth: 2 };
  const overshoot = stroke(board, pen);
  const settling = stroke(board, pen);
  board.unsuspendUpdate();

  return {
    board,
    draw(K, info) {
      board.suspendUpdate();
      response.set(stepCurve(model, K, until, plotSamples(model, K, until)));
      const final = info?.final ?? 0;
      finalLine.set([
        [0, final],
        [until, final],
      ]);
      bandLines[0]?.set([
        [0, final * (1 + band)],
        [until, final * (1 + band)],
      ]);
      bandLines[1]?.set([
        [0, final * (1 - band)],
        [until, final * (1 - band)],
      ]);
      const tick = until * 0.015;
      overshoot.set(
        info?.Tp !== undefined && info.peak !== undefined
          ? [
              [info.Tp - tick, final],
              [info.Tp, final],
              [info.Tp, info.peak],
              [info.Tp - tick, info.peak],
            ]
          : [],
      );
      settling.set(
        info
          ? [
              [info.Ts, final * (1 - band)],
              [info.Ts, 0],
            ]
          : [],
      );
      board.unsuspendUpdate();
    },
  };
}

// ---------- Bode ----------

export interface BodeBoards {
  boards: [Board, Board];
  draw(K: number, at: Margins): void;
}

/** The decades a Bode plot spans: one either side of the plant's corners and the crossovers. */
export function bodeDecades(model: Model, tune: Range): [number, number] {
  const corners = [...model.plant.zeros, ...model.plant.poles]
    .map((r) => (typeof r === "number" ? Math.abs(r) : Math.hypot(r[0], r[1])))
    .filter((r) => r > 0);
  // The crossovers at both ends of the gain's range: the plant's own gain can put them decades away.
  const crossovers = [tune.min, tune.max].flatMap((K) => {
    const m = margins(model, K);
    return [m.wc, m.wpc].filter((w): w is number => w !== undefined && w > 0);
  });
  const lo = Math.min(...corners, ...crossovers, 1);
  const hi = Math.max(...corners, ...crossovers, 1);
  return [Math.floor(Math.log10(lo)) - 1, Math.ceil(Math.log10(hi)) + 1];
}

/** A power of ten printed as the axis writes it: 0.01, 0.1, 1, 10, 100. */
export const decade = (u: number) => String(Number((10 ** Math.round(u)).toPrecision(1)));

export function bodeBoards(
  JXG: JXG,
  magnitudeEl: HTMLElement,
  phaseEl: HTMLElement,
  { model, tune, inks }: { model: Model; tune: Range; inks: Inks },
): BodeBoards {
  const [u0, u1] = bodeDecades(model, tune);
  const us = Array.from({ length: 241 }, (_, i) => u0 + ((u1 - u0) * i) / 240);
  const dbAt = (K: number, u: number) => 20 * Math.log10(frequency(model, K, 10 ** u).magnitude);
  // Bounds from finite samples only: a grid point on a zero or pole of the imaginary axis is ±∞ dB.
  const dbs = [tune.min, tune.max].flatMap((K) => us.map((u) => dbAt(K, u))).filter(Number.isFinite);
  const phases = us.map((u) => frequency(model, 1, 10 ** u).phase).filter(Number.isFinite);
  // A flat curve (1/s² holds −180° at every frequency) still gets a frame: 20 dB and 90° at least.
  const [dbLo, phLo] = [Math.min(...dbs), Math.min(...phases, -180)];
  const [dbHi, phHi] = [Math.max(...dbs, dbLo + 20), Math.max(...phases, phLo + 90)];
  // Decades along the bottom, values left of the frequency axis's start: both clear of the curves.
  // Each plot's floor on its own tick (−180° for the phase), its top a little over its highest
  // value; the last decade's label needs room past the box's end.
  const [dbStep, phStep] = [tickSpacing(dbHi - dbLo), phHi - phLo > 270 ? 90 : 45];
  const floorOf = (v: number, s: number) => Math.floor(v / s + 1e-9) * s;
  const end = u1 + (u1 - u0) * 0.05;
  const magnitudeFrame = edgeAxes(
    [u0, dbHi + (dbHi - dbLo) * 0.06, end, floorOf(dbLo, dbStep)],
    { start: 0.12, below: 0.14 },
    [1, dbStep],
  );
  const phaseFrame = edgeAxes(
    [u0, phHi + (phHi - phLo) * 0.08, end, floorOf(phLo, phStep)],
    { start: 0.12, below: 0.14 },
    [1, phStep],
  );
  const magnitudeBox = magnitudeFrame.box;
  const phaseBox = phaseFrame.box;
  // ω = 1 is the decade at 0, labelled like any other: the axes cross at the first decade.
  const ticks = { x: { text: decade, zero: true }, y: { ...LABELS_LEFT, zero: true } };
  const magnitude = ownSized(makeBoard(JXG, magnitudeEl, magnitudeBox, inks, magnitudeFrame.axes, ticks));
  const phase = ownSized(makeBoard(JXG, phaseEl, phaseBox, inks, phaseFrame.axes, ticks));
  // A curve is drawn only inside its frame, clear of the axes' labels.
  const inFrame = (frame: typeof magnitudeFrame, points: [number, number][]) => within(points, frame.inside);

  for (const b of [magnitude, phase]) b.suspendUpdate();
  guideLine(magnitude, inks, [u0, 0], [u1, 0], 2);
  guideLine(phase, inks, [u0, -180], [u1, -180], 2);
  const magCurve = stroke(magnitude, { strokeColor: inks.graphite, strokeWidth: 2 });
  const phaseCurve = stroke(phase, { strokeColor: inks.graphite, strokeWidth: 2 });
  phaseCurve.set(
    inFrame(
      phaseFrame,
      us.map((u) => [u, frequency(model, 1, 10 ** u).phase]),
    ),
  );
  // The gain crossover on both plots, and the phase margin above −180° there.
  const crossMag = stroke(magnitude, { strokeColor: inks.pencil, strokeWidth: 1, dash: 1 });
  const crossPhase = stroke(phase, { strokeColor: inks.pencil, strokeWidth: 1, dash: 1 });
  asBackdrop(crossMag.curve);
  asBackdrop(crossPhase.curve);
  const pm = stroke(phase, { strokeColor: inks.graphite, strokeWidth: 3 });
  for (const b of [magnitude, phase]) b.unsuspendUpdate();

  return {
    boards: [magnitude, phase],
    draw(K, at) {
      for (const b of [magnitude, phase]) b.suspendUpdate();
      magCurve.set(
        inFrame(
          magnitudeFrame,
          us.map((u) => [u, dbAt(K, u)]),
        ),
      );
      if (at.wc !== undefined && at.PM !== undefined) {
        const u = Math.log10(at.wc);
        // On the phase curve as drawn, which runs on past −360° for a high-order plant: the margin
        // is measured up from the odd multiple of 180° just below it there.
        const phase = frequency(model, K, at.wc).phase;
        crossMag.set([
          [u, magnitudeFrame.axes.cross[1]],
          [u, 0],
        ]);
        crossPhase.set([
          [u, phaseBox[1]],
          [u, phase],
        ]);
        pm.set([
          [u, phase - at.PM],
          [u, phase],
        ]);
      } else [crossMag, crossPhase, pm].forEach((s) => s.set([]));
      for (const b of [magnitude, phase]) b.unsuspendUpdate();
    },
  };
}

// ---------- Nyquist ----------

export interface NyquistBoard {
  board: Board;
  draw(K: number): void;
}

/**
 * The open loop's polar plot round the critical point −1: positive frequencies in graphite, their
 * mirror (negative frequencies) dashed in pencil, over a box that holds it at every gain a student
 * can set. A branch running off to infinity (a pole at the origin) stops at the frame, clear of
 * the axes' labels along its edges; the real and imaginary axes are drawn through the plane.
 */
export function nyquistBoard(
  JXG: JXG,
  el: HTMLElement,
  { model, tune, inks }: { model: Model; tune: Range; inks: Inks },
): NyquistBoard {
  const [u0, u1] = bodeDecades(model, tune);
  const us = Array.from({ length: 400 }, (_, i) => u0 - 2 + ((u1 + 2 - (u0 - 2)) * i) / 399);
  // Either side of the imaginary axis, as far as the curve reaches at any gain a student can set
  // (a branch running off to infinity counts while it is still near the plane's middle).
  const reals = [tune.min, tune.max].flatMap((K) =>
    us.map((u) => frequency(model, K, 10 ** u)).flatMap((f) => (Math.hypot(f.re, f.im) < 50 ? [f.re] : [])),
  );
  const [reLo, reHi] = [Math.min(0, ...reals), Math.max(0, ...reals)];
  const margin = (reHi - reLo) * 0.15;
  const xMin = Math.min(-1.5, reLo - margin);
  const xMax = Math.max(0.6, reHi + margin);
  const half = (xMax - xMin) * 0.38;
  const frame = edgeAxes([xMin, half, xMax, -half]);
  const { box } = frame;
  const board = ownSized(makeBoard(JXG, el, box, inks, frame.axes, { y: LABELS_LEFT }));
  board.suspendUpdate();
  guideLine(board, inks, [box[0], 0], [box[2], 0]);
  guideLine(board, inks, [0, box[3]], [0, box[1]]);
  board.create("point", [-1, 0], {
    ...fixedLine,
    face: "+",
    size: 6,
    strokeColor: inks.graphite,
    strokeWidth: 2,
    withLabel: false,
    showInfobox: false,
  });
  const mirror = stroke(board, { strokeColor: inks.pencil, strokeWidth: 1.2, dash: 2 });
  const plot = stroke(board, { strokeColor: inks.graphite, strokeWidth: 2 });
  board.unsuspendUpdate();
  return {
    board,
    draw(K) {
      board.suspendUpdate();
      const points = us.map((u) => frequency(model, K, 10 ** u)).map((f) => [f.re, f.im] as const);
      plot.set(within(points, frame.inside));
      mirror.set(
        within(
          points.map(([re, im]) => [re, -im] as const),
          frame.inside,
        ),
      );
      board.unsuspendUpdate();
    },
  };
}
