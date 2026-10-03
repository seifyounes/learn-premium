// The gradient-descent sim (an Agent-built sim): the Professor's table filling step by step in hand
// order, the red pen ringing each new θ, the descent path on the contours of J with a draggable
// start, and the data with the fitted line. Students tune the start, α and the number of steps,
// never the data. It opens on the Worked example's values, and the engine is the one the build's
// number gate replays.
import { MotionConfig, motion, useReducedMotion } from "motion/react";
import { useEffect, useId, useMemo, useReducer, useRef, useState } from "react";
import { descend, type Model } from "../sims/gradient-descent/engine.ts";
import { decimalsOf, printAt } from "../sims/print.ts";
import { startTuning, tuning, type Range, type TuningAction } from "../sims/tuning.ts";
import { contourBoard, fitBoard, readInks, screenOf, type ContourBoard, type FitBoard } from "./sim/descent-boards.ts";
import { PenRing } from "./worked/pen.tsx";
import { MARK_PAUSE, MARK_STAGGER, VALUE_LAND, valueStagger } from "./worked/timing.ts";

type Input = "theta0" | "theta1" | "alpha" | "iterations";

interface Props {
  model: Model;
  /** The Worked example's values: the sim opens on them. */
  start: Record<Input, number>;
  tune: Record<Input, Range>;
  /** Decimals every computed value prints with: the sheet's. */
  decimals: number;
  /** Paper-math labels, rendered at build. */
  mathHtml: Record<"k" | "theta0" | "theta1" | "J" | "alpha" | "start" | "x" | "y", string>;
  /** What the sim is, for assistive tech. */
  label: string;
}

const COLUMNS = ["theta0", "theta1", "J"] as const;

export default function GradientDescentSim({ model, start, tune, decimals, mathHtml, label }: Props) {
  const reduced = useReducedMotion() ?? false;
  const [ready, setReady] = useState(false);
  const [t, dispatch] = useReducer(
    (current: ReturnType<typeof startTuning>, action: TuningAction) => tuning(tune, current, action),
    start,
    startTuning,
  );
  const inputs = t.inputs as Record<Input, number>;
  const trace = useMemo(() => descend(model, inputs), [model, inputs]);
  const last = trace.iterates.at(-1);
  const stopped = trace.iterates.length - 1 < inputs.iterations;

  const contourEl = useRef<HTMLDivElement>(null);
  const fitEl = useRef<HTMLDivElement>(null);
  const tableBox = useRef<HTMLDivElement>(null);
  const [boards, setBoards] = useState<{ contours: ContourBoard; fit: FitBoard; JXG: typeof import("jsxgraph") }>();
  const [size, setSize] = useState(0);
  const [ring, setRing] = useState<[number, number]>();
  const captionId = useId();

  useEffect(() => setReady(true), []);
  // JSXGraph loads when the sim is on screen, never with the page.
  useEffect(() => {
    let cancelled = false;
    let made: { contours: ContourBoard; fit: FitBoard; JXG: typeof import("jsxgraph") } | undefined;
    void import("jsxgraph").then(({ default: JXG }) => {
      const contoursAt = contourEl.current;
      const fitAt = fitEl.current;
      if (cancelled || !contoursAt || !fitAt) return;
      const inks = readInks(contoursAt);
      const opening = descend(model, start);
      made = {
        JXG,
        contours: contourBoard(JXG, contoursAt, {
          model,
          minimum: opening.minimum,
          tune,
          levelsFrom: opening.iterates[0]?.J ?? 1,
          inks,
          startLabelHtml: mathHtml.start,
          minimumLabelHtml: "minimum",
          onDrag: (theta0, theta1) => {
            dispatch({ type: "set", input: "theta0", value: theta0 });
            dispatch({ type: "set", input: "theta1", value: theta1 });
          },
        }),
        fit: fitBoard(JXG, fitAt, { model, inks }),
      };
      setBoards(made);
    });
    return () => {
      cancelled = true;
      if (made) {
        made.JXG.JSXGraph.freeBoard(made.contours.board);
        made.JXG.JSXGraph.freeBoard(made.fit.board);
      }
    };
  }, [model, start, tune, mathHtml.start]);

  // The boards keep their coordinates when the column they sit in changes width.
  useEffect(() => {
    if (!boards) return;
    const observer = new ResizeObserver(() => {
      for (const [board, el] of [
        [boards.contours.board, contourEl.current],
        [boards.fit.board, fitEl.current],
      ] as const) {
        if (el) board.resizeContainer(el.clientWidth, el.clientHeight, true);
      }
      setSize((n) => n + 1);
    });
    if (contourEl.current) observer.observe(contourEl.current);
    return () => observer.disconnect();
  }, [boards]);

  useEffect(() => {
    if (!boards || !last) return;
    boards.contours.moveStart(inputs.theta0, inputs.theta1);
    boards.contours.draw(trace);
    boards.fit.draw(last.theta0, last.theta1);
    const [x, y] = screenOf(boards.JXG, boards.contours.board, last.theta0, last.theta1);
    const el = contourEl.current;
    const inside = el && x >= 0 && y >= 0 && x <= el.clientWidth && y <= el.clientHeight;
    // The ring hangs in the board's wrapper, which leaves room above the board for the axis name.
    setRing(trace.iterates.length > 1 && inside ? [x + el.offsetLeft, y + el.offsetTop] : undefined);
  }, [boards, trace, last, inputs.theta0, inputs.theta1, size]);

  // A long trace scrolls inside its box: keep the newest row in view.
  useEffect(() => {
    const box = tableBox.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [trace.iterates.length]);

  const landing = t.landing;
  const draw = !reduced && landing !== undefined;
  const per = valueStagger(COLUMNS.length);
  const ringsAfter = draw ? COLUMNS.length * per + VALUE_LAND : MARK_PAUSE;
  const value = (v: number) => printAt(v, decimals);
  const set = (input: Input) => (v: number) => dispatch({ type: "set", input, value: v });

  return (
    <MotionConfig reducedMotion="user">
      <section className="sim" aria-label={label} data-ready={ready} data-sim="gradient-descent">
        <div className="sim-grid">
          <figure className="sim-figure sim-contours" aria-labelledby={`${captionId}-contours`}>
            <div className="sim-stage-wrap" dir="ltr">
              <div ref={contourEl} className="sim-stage" data-board="contours" />
              <AxisName html={mathHtml.theta1} where="y" />
              <AxisName html={mathHtml.theta0} where="x" />
              {ring && (
                <PenRing
                  key={`${t.epoch}:${trace.iterates.length}`}
                  draw={draw}
                  delay={ringsAfter}
                  className="pointer-events-none absolute size-[26px] -translate-x-1/2 -translate-y-1/2"
                  style={{ insetInlineStart: ring[0], insetBlockStart: ring[1] }}
                />
              )}
            </div>
            <figcaption id={`${captionId}-contours`} className="sim-caption">
              <span className="field-label pbs-[3px]">Fig.</span>
              <span>
                Contours of <span dangerouslySetInnerHTML={{ __html: mathHtml.J }} />. Drag{" "}
                <span dangerouslySetInnerHTML={{ __html: mathHtml.start }} /> to start somewhere else.
              </span>
            </figcaption>
          </figure>

          <figure className="sim-figure sim-fit" aria-labelledby={`${captionId}-fit`}>
            <div className="sim-stage-wrap" dir="ltr">
              <div ref={fitEl} className="sim-stage" data-board="fit" />
              <AxisName html={mathHtml.y} where="y" />
              <AxisName html={mathHtml.x} where="x" />
            </div>
            <figcaption id={`${captionId}-fit`} className="sim-caption">
              <span className="field-label pbs-[3px]">Fig.</span>
              <span>
                The data, and the line after <span className="font-quantity">{trace.iterates.length - 1}</span>{" "}
                {trace.iterates.length === 2 ? "step" : "steps"}
              </span>
            </figcaption>
          </figure>

          <div className="sim-controls">
            <Slider
              name={mathHtml.alpha}
              range={tune.alpha}
              value={inputs.alpha}
              ready={ready}
              onChange={set("alpha")}
            />
            <Slider
              name={`${mathHtml.theta0} at the start`}
              range={tune.theta0}
              value={inputs.theta0}
              ready={ready}
              onChange={set("theta0")}
            />
            <Slider
              name={`${mathHtml.theta1} at the start`}
              range={tune.theta1}
              value={inputs.theta1}
              ready={ready}
              onChange={set("theta1")}
            />
            <Slider
              name="Steps"
              range={tune.iterations}
              value={inputs.iterations}
              ready={ready}
              onChange={set("iterations")}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="button-print-next note-button label-action"
                disabled={!ready || inputs.iterations >= tune.iterations.max}
                onClick={() => dispatch({ type: "step" })}
              >
                One more step
              </button>
              <button
                type="button"
                className="button-print note-button label-action"
                disabled={!ready}
                onClick={() => dispatch({ type: "reset", start })}
              >
                Back to the example
              </button>
            </div>
            {trace.diverges && (
              <p className="sim-warning" role="status">
                <span dangerouslySetInnerHTML={{ __html: mathHtml.alpha }} /> ={" "}
                <span className="font-quantity">{printAt(inputs.alpha, decimalsOf(tune.alpha.step))}</span> is past{" "}
                <span className="font-quantity">{printAt(trace.alphaLimit, decimalsOf(tune.alpha.step))}</span>, the
                largest that converges: every step overshoots the minimum and{" "}
                <span dangerouslySetInnerHTML={{ __html: mathHtml.J }} /> grows.
                {stopped && " The numbers outgrow the page before the last step."}
              </p>
            )}
          </div>

          <div className="sim-table">
            <div ref={tableBox} className="table-box sim-table-box">
              <table className="border-collapse bg-sheet font-quantity text-quantity-phone tabular-nums pad:text-quantity">
                <thead>
                  <tr>
                    {(["k", ...COLUMNS] as const).map((c) => (
                      <th
                        key={c}
                        scope="col"
                        className="border border-pencil px-2 pbs-1 pbe-1.5 text-start align-bottom font-normal pad:px-3"
                      >
                        <span className="sim-column" dangerouslySetInnerHTML={{ __html: mathHtml[c] }} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {trace.iterates.map((row) => {
                    const lands = draw && row.k === landing;
                    const newest = row.k === last?.k && row.k > 0;
                    return (
                      <tr key={`${t.epoch}:${row.k}`} className="h-[29px]" data-row={row.k}>
                        <td className="border border-pencil px-2 text-end text-graphite pad:px-3">{row.k}</td>
                        {COLUMNS.map((c, i) => (
                          <td
                            key={c}
                            className="relative border border-pencil px-2 text-end whitespace-nowrap text-pencil pad:px-3"
                            data-column={c}
                          >
                            <motion.span
                              className="inline-block"
                              initial={lands ? { opacity: 0, y: -2 } : false}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ duration: VALUE_LAND, ease: "easeOut", delay: i * per }}
                            >
                              {value(row[c])}
                            </motion.span>
                            {newest && c !== "J" && (
                              <PenRing
                                draw={lands}
                                delay={ringsAfter + i * MARK_STAGGER}
                                className="absolute inset-s-[-2px] inset-bs-[-2px] size-[calc(100%+4px)]"
                              />
                            )}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="sim-readout" aria-live="polite">
              After <span className="font-quantity">{last?.k ?? 0}</span> {last?.k === 1 ? "step" : "steps"}:{" "}
              <span dangerouslySetInnerHTML={{ __html: mathHtml.theta0 }} /> ={" "}
              <span className="font-quantity">{value(last?.theta0 ?? 0)}</span>,{" "}
              <span dangerouslySetInnerHTML={{ __html: mathHtml.theta1 }} /> ={" "}
              <span className="font-quantity">{value(last?.theta1 ?? 0)}</span>,{" "}
              <span dangerouslySetInnerHTML={{ __html: mathHtml.J }} /> ={" "}
              <span className="font-quantity">{value(last?.J ?? 0)}</span>
            </p>
          </div>
        </div>
      </section>
    </MotionConfig>
  );
}

/** An axis's name, beside the board rather than on it. */
function AxisName({ html, where }: { html: string; where: "x" | "y" }) {
  return (
    <span className="sim-axis-name" data-axis={where}>
      <span dangerouslySetInnerHTML={{ __html: html }} />
    </span>
  );
}

interface SliderProps {
  /** The input's name, as paper math or words. */
  name: string;
  range: Range;
  value: number;
  ready: boolean;
  onChange(value: number): void;
}

/** One tunable input: its name and value printed above a slider that snaps to its step. */
function Slider({ name, range, value, ready, onChange }: SliderProps) {
  const id = useId();
  return (
    <div className="sim-slider">
      <label htmlFor={id} className="sim-slider-head">
        <span dangerouslySetInnerHTML={{ __html: name }} />
        <output htmlFor={id} className="font-quantity text-graphite tabular-nums">
          {printAt(value, decimalsOf(range.step))}
        </output>
      </label>
      <input
        id={id}
        type="range"
        min={range.min}
        max={range.max}
        step={range.step}
        value={value}
        disabled={!ready}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </div>
  );
}
