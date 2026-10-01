// The question figure, plotted on the sheet: pencil axes and mono ticks on the pad's grid,
// graphite marks drawn in as the steps add them, red-pen rings last. It is laid out in screen
// pixels for the width it is given, never scaled, so its text keeps its size on a phone (before
// the island has measured its box, a box narrower than the drawing scrolls it). A plot doesn't
// mirror: it always reads left to right.
import { motion } from "motion/react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { AxisData, ElementData, FigureData, LabelSide } from "../../worked/sheet.ts";
import { decimalsOf } from "../../sims/print.ts";
import type { Shown } from "../../worked/stepping.ts";
import { PenRing } from "./pen.tsx";
import { FIGURE_STAGGER, figureRingsDelay, LABEL_AFTER, LABEL_FADE, LINE_DRAW, MARK_FADE } from "./timing.ts";

/** Room around the plot area: tick labels start and below, axis names above and below. */
const PAD = { start: 46, end: 16, above: 34, below: 48 };
const MIN_WIDTH = 240;
/** Laid out for a phone's column until the island measures the box it sits in. */
const FIRST_WIDTH = 358;

/** Tick values from `min` to `max`, counted (not summed) so no float drift creeps in. */
function ticks({ min, max, step }: AxisData, per = 1): number[] {
  const count = Math.round(((max - min) / step) * per);
  return Array.from({ length: count + 1 }, (_, i) => min + (i * step) / per);
}

/** A tick's printed value: the step's decimals, a true minus sign, and never "−0.00". */
const tickLabel = (v: number, step: number) =>
  (Math.abs(v) < step / 1e6 ? 0 : v).toFixed(decimalsOf(step)).replace(/^-/, "−");

interface Placed {
  x: number;
  y: number;
  side: LabelSide;
}

/** Where an element's label and ring sit: beside a point, at a line's middle vertex, atop a guide. */
function anchor(e: ElementData, sx: (x: number) => number, sy: (y: number) => number, plotTop: number): Placed {
  if (e.kind === "point") return { x: sx(e.at[0]), y: sy(e.at[1]), side: e.side };
  if (e.kind === "guide") return { x: sx(e.x), y: plotTop, side: "above" };
  const [x, y] = e.through[Math.floor(e.through.length / 2)] ?? [0, 0];
  return { x: sx(x), y: sy(y), side: "end" };
}

const LABEL_GAP = 12;
/** Tick labels closer than this skip every other one (or more), so they never touch. */
const MIN_TICK_SPACING = 44;
const labelShift: Record<Placed["side"], string> = {
  end: "translate(0, -50%)",
  start: "translate(-100%, -50%)",
  above: "translate(-50%, -100%)",
  below: "translate(-50%, 0)",
};

function labelStyle({ x, y, side }: Placed) {
  const dx = side === "end" ? LABEL_GAP : side === "start" ? -LABEL_GAP : 0;
  const dy = side === "below" ? LABEL_GAP : side === "above" ? -LABEL_GAP : 0;
  return { insetInlineStart: x + dx, insetBlockStart: y + dy, transform: labelShift[side] };
}

export function PlotFigure({ figure, shown, captionId }: { figure: FigureData; shown: Shown; captionId: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(FIRST_WIDTH);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(MIN_WIDTH, Math.round(entry.contentRect.width)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { state, hidden, animate, epoch } = shown;
  const height = Math.round(width * 0.8);
  const x0 = PAD.start;
  const x1 = width - PAD.end;
  const y0 = PAD.above;
  const y1 = height - PAD.below;
  const sx = (x: number) => x0 + ((x - figure.x.min) / (figure.x.max - figure.x.min)) * (x1 - x0);
  const sy = (y: number) => y1 - ((y - figure.y.min) / (figure.y.max - figure.y.min)) * (y1 - y0);

  const added = hidden ? [] : state.added;
  const drawn = figure.elements.filter((e) => state.drawn.has(e.id) && !(hidden && state.added.includes(e.id)));
  const rings = hidden ? [] : state.rings;
  const drawIn = (id: string) => animate && added.includes(id);
  const delayOf = (id: string) => Math.max(added.indexOf(id), 0) * FIGURE_STAGGER;
  const fine = (axis: AxisData) => ticks(axis, 2);
  const xTicks = ticks(figure.x);
  const labelEvery = Math.max(1, Math.ceil(MIN_TICK_SPACING / ((x1 - x0) / Math.max(xTicks.length - 1, 1))));

  return (
    <figure className="min-w-0">
      <div ref={box} className="overflow-x-auto">
        <div dir="ltr" className="relative overflow-hidden" style={{ inlineSize: width, blockSize: height }}>
          <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={captionId}>
            <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill="var(--color-sheet)" data-backdrop />
            {fine(figure.x).map((v, i) => (
              <line
                key={`fx${i}`}
                x1={sx(v)}
                x2={sx(v)}
                y1={y0}
                y2={y1}
                className="plot-grid"
                data-backdrop
                data-major={i % 2 === 0}
              />
            ))}
            {fine(figure.y).map((v, i) => (
              <line
                key={`fy${i}`}
                x1={x0}
                x2={x1}
                y1={sy(v)}
                y2={sy(v)}
                className="plot-grid"
                data-backdrop
                data-major={i % 2 === 0}
              />
            ))}
            <path d={`M ${x0} ${y0 - 4} V ${y1} H ${x1 + 4}`} className="plot-axis" />
            {xTicks.map((v, i) => (
              <g key={`tx${v}`}>
                <line x1={sx(v)} x2={sx(v)} y1={y1} y2={y1 + 5} className="plot-axis" />
                {i % labelEvery === 0 && (
                  <text x={sx(v)} y={y1 + 19} textAnchor="middle" className="plot-tick">
                    {tickLabel(v, figure.x.step)}
                  </text>
                )}
              </g>
            ))}
            {ticks(figure.y).map((v) => (
              <g key={`ty${v}`}>
                <line x1={x0 - 5} x2={x0} y1={sy(v)} y2={sy(v)} className="plot-axis" />
                <text x={x0 - 8} y={sy(v) + 4} textAnchor="end" className="plot-tick">
                  {tickLabel(v, figure.y.step)}
                </text>
              </g>
            ))}
            {drawn.map((e) => (
              <Mark
                key={`${e.id}:${epoch}`}
                element={e}
                sx={sx}
                sy={sy}
                y0={y0}
                y1={y1}
                draw={drawIn(e.id)}
                delay={delayOf(e.id)}
              />
            ))}
          </svg>
          <AxisName axis={figure.y} style={{ insetInlineStart: 4, insetBlockStart: 0 }} />
          <AxisName axis={figure.x} style={{ insetInlineEnd: PAD.end, insetBlockEnd: 4 }} />
          {drawn.map((e) => {
            if (!e.labelHtml) return null;
            const at = anchor(e, sx, sy, y0);
            return (
              <motion.span
                key={`${e.id}:${epoch}`}
                className="plot-label"
                style={labelStyle(at)}
                initial={drawIn(e.id) ? { opacity: 0 } : false}
                animate={{ opacity: 1 }}
                transition={{ duration: LABEL_FADE, delay: delayOf(e.id) + LABEL_AFTER }}
                dangerouslySetInnerHTML={{ __html: e.labelHtml }}
              />
            );
          })}
          {rings.map((id) => {
            const e = figure.elements.find((el) => el.id === id);
            if (!e) return null;
            const at = anchor(e, sx, sy, y0);
            return (
              <PenRing
                key={`${id}:${state.index}:${epoch}`}
                draw={animate}
                delay={figureRingsDelay(added.length)}
                className="absolute size-[22px] -translate-x-1/2 -translate-y-1/2"
                style={{ insetInlineStart: at.x, insetBlockStart: at.y }}
              />
            );
          })}
        </div>
      </div>
      <figcaption id={captionId} className="flex gap-2 pbs-2 text-body-small text-muted">
        <span className="field-label pbs-[3px]">Fig.</span>
        <span dangerouslySetInnerHTML={{ __html: state.captionHtml ?? figure.captionHtml }} />
      </figcaption>
    </figure>
  );
}

function AxisName({ axis, style }: { axis: AxisData; style: CSSProperties }) {
  return (
    <span className="plot-label" style={style}>
      <span dangerouslySetInnerHTML={{ __html: axis.labelHtml }} />
      {axis.unitHtml && (
        <span className="text-pencil">
          {" ("}
          <span dangerouslySetInnerHTML={{ __html: axis.unitHtml }} />)
        </span>
      )}
    </span>
  );
}

interface MarkProps {
  element: ElementData;
  sx: (x: number) => number;
  sy: (y: number) => number;
  y0: number;
  y1: number;
  draw: boolean;
  delay: number;
}

/** One element in graphite (a guide in pencil), drawn in when a step adds it. */
function Mark({ element: e, sx, sy, y0, y1, draw, delay }: MarkProps) {
  const pen = { initial: draw ? { pathLength: 0 } : false, animate: { pathLength: 1 } } as const;
  if (e.kind === "guide") {
    // Dashed, so it fades in: drawing the stroke would take over its dash pattern.
    return (
      <motion.path
        d={`M ${sx(e.x)} ${y1} V ${y0}`}
        className="plot-guide"
        initial={draw ? { opacity: 0 } : false}
        animate={{ opacity: 1 }}
        transition={{ duration: MARK_FADE, ease: "easeOut", delay }}
      />
    );
  }
  if (e.kind === "line") {
    const d = e.through.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${sx(x)} ${sy(y)}`).join(" ");
    return (
      <motion.path
        d={d}
        className="plot-line"
        {...pen}
        transition={{ duration: LINE_DRAW, ease: "easeInOut", delay }}
      />
    );
  }
  return (
    <motion.circle
      cx={sx(e.at[0])}
      cy={sy(e.at[1])}
      r={4}
      className="plot-point"
      initial={draw ? { opacity: 0, scale: 0.4 } : false}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: MARK_FADE, ease: "easeOut", delay }}
    />
  );
}
