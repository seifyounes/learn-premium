// The tangent sim (an Agent-built sim): the derivative as the tangent's slope. The Professor's
// curve with the tangent at P and the secants from P towards Q, and the Professor's table of
// secant slopes over runs shrinking by tenths, closing on the slope the red pen rings. Students
// tune the point and the first run, by slider or by sliding P and Q along the curve, never the
// curve. It opens on the Worked example's values, and the engine is the one the build's number
// gate replays.
import { MotionConfig } from "motion/react";
import { useEffect, useId, useMemo, useReducer, useRef, useState } from "react";
import { asWritten, printAt } from "../sims/print.ts";
import { at, secants, type Model } from "../sims/tangent/engine.ts";
import { startTuning, tuning, type Range, type TuningAction } from "../sims/tuning.ts";
import { fitOnResize, readInks } from "./sim/board.ts";
import { AxisName, Slider } from "./sim/controls.tsx";
import { tangentBoard, type TangentBoard } from "./sim/tangent-board.ts";
import { PenRing } from "./worked/pen.tsx";

type Input = "a" | "h";

interface Props {
  model: Model;
  /** The Worked example's values: the sim opens on them. */
  start: Record<Input, number>;
  tune: Record<Input, Range>;
  /** Decimals every computed value prints with: the sheet's. */
  decimals: number;
  /** Paper-math labels, rendered at build. */
  mathHtml: Record<"a" | "h" | "x" | "y" | "f" | "fa" | "fah" | "secant" | "slope" | "toZero" | "p" | "q", string>;
  /** What the sim is, for assistive tech. */
  label: string;
}

export default function TangentSim({ model, start, tune, decimals, mathHtml, label }: Props) {
  const [ready, setReady] = useState(false);
  const [t, dispatch] = useReducer(
    (current: ReturnType<typeof startTuning>, action: TuningAction) => tuning(tune, current, action),
    start,
    startTuning,
  );
  const inputs = t.inputs as Record<Input, number>;
  const tangent = useMemo(() => at(model, inputs), [model, inputs]);
  const rows = useMemo(() => secants(model, inputs), [model, inputs]);
  // A drag of Q sets the run from wherever P is now.
  const a = useRef(inputs.a);
  a.current = inputs.a;

  const boardEl = useRef<HTMLDivElement>(null);
  const [board, setBoard] = useState<{ view: TangentBoard; JXG: typeof import("jsxgraph") }>();
  const captionId = useId();

  useEffect(() => setReady(true), []);
  // JSXGraph loads when the sim is on screen, never with the page.
  useEffect(() => {
    let cancelled = false;
    let made: { view: TangentBoard; JXG: typeof import("jsxgraph") } | undefined;
    void import("jsxgraph").then(({ default: JXG }) => {
      const el = boardEl.current;
      if (cancelled || !el) return;
      made = {
        JXG,
        view: tangentBoard(JXG, el, {
          model,
          tune,
          inks: readInks(el),
          pLabelHtml: mathHtml.p,
          qLabelHtml: mathHtml.q,
          onDragP: (x) => dispatch({ type: "set", input: "a", value: x }),
          onDragQ: (x) => dispatch({ type: "set", input: "h", value: x - a.current }),
        }),
      };
      setBoard(made);
    });
    return () => {
      cancelled = true;
      if (made) made.JXG.JSXGraph.freeBoard(made.view.board);
    };
  }, [model, tune, mathHtml.p, mathHtml.q]);

  useEffect(() => {
    if (!board) return;
    return fitOnResize([[board.view.board, boardEl.current]]);
  }, [board]);

  useEffect(() => {
    board?.view.draw(inputs.a, tangent, rows);
  }, [board, inputs.a, tangent, rows]);

  const value = (v: number) => printAt(v, decimals);
  const set = (input: Input) => (v: number) => dispatch({ type: "set", input, value: v });
  const cell = "border border-pencil px-2 text-end whitespace-nowrap pad:px-3";

  return (
    <MotionConfig reducedMotion="user">
      <section className="sim" aria-label={label} data-ready={ready} data-sim="tangent">
        <div className="sim-grid sim-grid-single">
          <figure className="sim-figure sim-contours" aria-labelledby={captionId}>
            <div className="sim-stage-wrap" dir="ltr">
              <div ref={boardEl} className="sim-stage" data-board="tangent" />
              <AxisName html={mathHtml.y} where="y" />
              <AxisName html={mathHtml.x} where="x" />
            </div>
            <figcaption id={captionId} className="sim-caption">
              <span className="field-label pbs-[3px]">Fig.</span>
              <span>
                <span dangerouslySetInnerHTML={{ __html: mathHtml.f }} />, its tangent at{" "}
                <span dangerouslySetInnerHTML={{ __html: mathHtml.p }} /> and the secants towards{" "}
                <span dangerouslySetInnerHTML={{ __html: mathHtml.q }} />. Slide{" "}
                <span dangerouslySetInnerHTML={{ __html: mathHtml.p }} /> or{" "}
                <span dangerouslySetInnerHTML={{ __html: mathHtml.q }} /> along the curve.
              </span>
            </figcaption>
          </figure>

          <div className="sim-controls">
            <Slider name={mathHtml.a} range={tune.a} value={inputs.a} ready={ready} onChange={set("a")} />
            <Slider name={mathHtml.h} range={tune.h} value={inputs.h} ready={ready} onChange={set("h")} />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="button-print note-button label-action"
                disabled={!ready}
                onClick={() => dispatch({ type: "reset", start })}
              >
                Back to the example
              </button>
            </div>
          </div>

          <div className="sim-table">
            <div className="table-box sim-table-box">
              <table className="border-collapse bg-sheet font-quantity text-quantity-phone tabular-nums pad:text-quantity">
                <thead>
                  <tr>
                    {(["h", "fah", "secant"] as const).map((c) => (
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
                  {rows.map((row, k) => (
                    <tr key={k} className="h-[29px]" data-row={k}>
                      <td className={`${cell} text-graphite`}>{asWritten(row.run)}</td>
                      <td className={`${cell} text-pencil`}>{value(row.value)}</td>
                      <td className={`${cell} text-pencil`}>{value(row.slope)}</td>
                    </tr>
                  ))}
                  <tr className="h-[29px]" data-row="limit">
                    <td className={`${cell} text-graphite`}>
                      <span dangerouslySetInnerHTML={{ __html: mathHtml.toZero }} />
                    </td>
                    <td className={`${cell} text-pencil`}>{value(tangent.value)}</td>
                    <td className={`relative ${cell} text-graphite`}>
                      {value(tangent.slope)}
                      <PenRing draw={false} className="absolute inset-s-[-2px] inset-bs-[-2px] size-[calc(100%+4px)]" />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="sim-readout" aria-live="polite">
              The secants close on <span dangerouslySetInnerHTML={{ __html: mathHtml.slope }} /> ={" "}
              <span className="font-quantity">{value(tangent.slope)}</span>: the tangent at{" "}
              <span dangerouslySetInnerHTML={{ __html: mathHtml.p }} /> is{" "}
              <span className="font-quantity whitespace-nowrap">
                y = {value(tangent.slope)}x {tangent.intercept < 0 ? "−" : "+"} {value(Math.abs(tangent.intercept))}
              </span>
            </p>
          </div>
        </div>
      </section>
    </MotionConfig>
  );
}
