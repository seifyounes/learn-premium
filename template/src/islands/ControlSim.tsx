// The control sim (an Agent-built sim): the gain K in front of the Professor's plant under unity
// negative feedback. The block diagram as the figure draws it (laid out by the layout core at
// build), then the loop behind four tabs, all on JSXGraph: the root locus with the closed-loop
// poles a student drags along it, the step response with the red pen on its overshoot and settling
// time, and the open loop's Bode and Nyquist plots. Students tune K, by slider or by dragging a
// pole, never the plant. It opens on the Worked example's gain, reads the step response by the
// definitions the Course style sheet pins, and runs the engine the build's number gate replays
// against python-control, which never loads here.
import { MotionConfig } from "motion/react";
import { useEffect, useId, useMemo, useReducer, useRef, useState } from "react";
import { closedLoop, margins, stepInfo, type Definitions, type Model } from "../sims/control/engine.ts";
import type { Drawing } from "../sims/layout/drawing.ts";
import type { InkNets } from "../sims/layout/geometry.ts";
import { decimalsOf, printAt } from "../sims/print.ts";
import { startTuning, tuning, type Range, type TuningAction } from "../sims/tuning.ts";
import { fitOnResize, type Board, type JXG } from "./sim/board.ts";
import {
  bodeBoards,
  locusBoard,
  nyquistBoard,
  readControlInks,
  stepBoard,
  type BodeBoards,
  type LocusBoard,
  type NyquistBoard,
  type StepBoard,
} from "./sim/control-boards.ts";
import { AxisName, Slider } from "./sim/controls.tsx";
import { Schematic } from "./sim/Schematic.tsx";
import { PenRing } from "./worked/pen.tsx";

type View = "locus" | "step" | "bode" | "nyquist";
const VIEWS: readonly [View, string][] = [
  ["locus", "Root locus"],
  ["step", "Step"],
  ["bode", "Bode"],
  ["nyquist", "Nyquist"],
];

type MathKey =
  | "K"
  | "sigma"
  | "jw"
  | "t"
  | "y"
  | "w"
  | "magnitude"
  | "phase"
  | "re"
  | "im"
  | "zeta"
  | "wn"
  | "wd"
  | "overshoot"
  | "Tp"
  | "Tr"
  | "Ts"
  | "wc"
  | "PM";

interface Props {
  model: Model;
  /** The block diagram, laid out at build exactly as the Drawing gate checked it. */
  drawing: Drawing;
  nets: InkNets;
  /** The Worked example's gain: the sim opens on it. */
  start: { K: number };
  tune: { K: Range };
  /** The Professor's settling band and rise limits, from the Course style sheet. */
  definitions: Definitions;
  /** Decimals every computed value prints with: the sheet's. */
  decimals: number;
  /** Paper-math labels, rendered at build. */
  mathHtml: Record<MathKey, string>;
  /** What the sim is, for assistive tech. */
  label: string;
}

interface Boards {
  locus?: LocusBoard;
  step?: StepBoard;
  bode?: BodeBoards;
  nyquist?: NyquistBoard;
}

const boardsOf = (b: Boards): Board[] =>
  [b.locus?.board, b.step?.board, ...(b.bode?.boards ?? []), b.nyquist?.board].filter((x): x is Board => !!x);

export default function ControlSim({
  model,
  drawing,
  nets,
  start,
  tune,
  definitions,
  decimals,
  mathHtml,
  label,
}: Props) {
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>("locus");
  const [t, dispatch] = useReducer(
    (current: ReturnType<typeof startTuning>, action: TuningAction) => tuning(tune, current, action),
    start,
    startTuning,
  );
  const K = (t.inputs as { K: number }).K;
  const loop = useMemo(() => closedLoop(model, K), [model, K]);
  const info = useMemo(() => stepInfo(model, K, definitions), [model, K, definitions]);
  const m = useMemo(() => margins(model, K), [model, K]);

  const els = {
    locus: useRef<HTMLDivElement>(null),
    step: useRef<HTMLDivElement>(null),
    magnitude: useRef<HTMLDivElement>(null),
    phase: useRef<HTMLDivElement>(null),
    nyquist: useRef<HTMLDivElement>(null),
  };
  const boards = useRef<Boards>({});
  const [jxg, setJxg] = useState<JXG>();
  const [made, setMade] = useState(0);
  const captionId = useId();
  const tabsId = useId();

  useEffect(() => setReady(true), []);
  // JSXGraph loads when the sim is on screen, never with the page.
  useEffect(() => {
    let cancelled = false;
    void import("jsxgraph").then(({ default: JXG }) => {
      if (!cancelled) setJxg(JXG);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  // Each board is made the first time its tab shows: a board in a hidden tab has no size.
  useEffect(() => {
    if (!jxg) return;
    const b = boards.current;
    const el = (ref: { current: HTMLDivElement | null }) => (ref.current?.clientWidth ? ref.current : null);
    const onDrag = (value: number) => dispatch({ type: "set", input: "K", value });
    let fresh = false;
    if (view === "locus" && !b.locus) {
      const e = el(els.locus);
      if (e) [b.locus, fresh] = [locusBoard(jxg, e, { model, tune: tune.K, inks: readControlInks(e), onDrag }), true];
    }
    if (view === "step" && !b.step) {
      const e = el(els.step);
      if (e)
        [b.step, fresh] = [
          stepBoard(jxg, e, { model, start: start.K, tune: tune.K, definitions, inks: readControlInks(e) }),
          true,
        ];
    }
    if (view === "bode" && !b.bode) {
      const [mag, ph] = [el(els.magnitude), el(els.phase)];
      if (mag && ph)
        [b.bode, fresh] = [bodeBoards(jxg, mag, ph, { model, tune: tune.K, inks: readControlInks(mag) }), true];
    }
    if (view === "nyquist" && !b.nyquist) {
      const e = el(els.nyquist);
      if (e) [b.nyquist, fresh] = [nyquistBoard(jxg, e, { model, tune: tune.K, inks: readControlInks(e) }), true];
    }
    if (fresh) setMade((n) => n + 1);
    // `els` is rebuilt each render but holds the same refs.
  }, [jxg, view, model, start.K, tune.K, definitions]);
  useEffect(
    () => () => {
      for (const board of boardsOf(boards.current)) jxg?.JSXGraph.freeBoard(board);
      boards.current = {};
    },
    [jxg],
  );

  useEffect(() => {
    const b = boards.current;
    const pairs: [Board, HTMLElement | null][] = [];
    if (b.locus) pairs.push([b.locus.board, els.locus.current]);
    if (b.step) pairs.push([b.step.board, els.step.current]);
    if (b.bode) pairs.push([b.bode.boards[0], els.magnitude.current], [b.bode.boards[1], els.phase.current]);
    if (b.nyquist) pairs.push([b.nyquist.board, els.nyquist.current]);
    return pairs.length > 0 ? fitOnResize(pairs) : undefined;
  }, [made]);

  useEffect(() => {
    const b = boards.current;
    b.locus?.draw(loop.poles);
    b.step?.draw(K, info);
    b.bode?.draw(K, m);
    b.nyquist?.draw(K);
  }, [made, K, loop, info, m]);

  const value = (v: number | undefined) => (v === undefined ? "none" : printAt(v, decimals));
  const [pole] = loop.poles;
  const second = loop.denominator.length === 3 && (loop.denominator[2] ?? 0) > 0;
  const wn = second ? Math.sqrt(loop.denominator[2] ?? 0) : undefined;
  const rows: { key: MathKey; unit?: string; v: number | undefined; ring?: boolean }[] = [
    ...(second && wn !== undefined
      ? [
          { key: "wn" as const, unit: "rad/s", v: wn },
          { key: "zeta" as const, v: (loop.denominator[1] ?? 0) / (2 * wn) },
        ]
      : []),
    { key: "sigma", v: pole?.[0] },
    { key: "wd", unit: "rad/s", v: pole?.[1] },
    { key: "overshoot", unit: "%", v: info?.overshoot, ring: true },
    { key: "Tp", unit: "s", v: info?.Tp },
    { key: "Tr", unit: "s", v: info?.Tr },
    { key: "Ts", unit: "s", v: info?.Ts, ring: true },
    { key: "wc", unit: "rad/s", v: m.wc },
    { key: "PM", unit: "°", v: m.PM },
  ];
  const cell = "border border-pencil px-2 text-end whitespace-nowrap pad:px-3";
  const tab = (id: View, name: string) => (
    <button
      key={id}
      type="button"
      role="tab"
      id={`${tabsId}-${id}`}
      aria-controls={`${tabsId}-${id}-panel`}
      aria-selected={view === id}
      className="artefact-tab label-action"
      disabled={!ready}
      onClick={() => setView(id)}
    >
      {name}
    </button>
  );
  const panel = (id: View, caption: string, children: React.ReactNode) => (
    <figure
      id={`${tabsId}-${id}-panel`}
      role="tabpanel"
      aria-labelledby={`${tabsId}-${id} ${captionId}-${id}`}
      hidden={view !== id}
    >
      {children}
      <figcaption id={`${captionId}-${id}`} className="sim-caption">
        <span className="field-label pbs-[3px]">Fig.</span>
        <span>{caption}</span>
      </figcaption>
    </figure>
  );

  return (
    <MotionConfig reducedMotion="user">
      <section className="sim" aria-label={label} data-ready={ready} data-sim="control">
        <figure className="control-diagram" aria-labelledby={`${captionId}-diagram`}>
          <div className="logic-stage" dir="ltr">
            <Schematic
              drawing={drawing}
              nets={nets}
              high={() => false}
              draw={false}
              terminalNets={{}}
              label="The loop's block diagram"
            />
          </div>
          <figcaption id={`${captionId}-diagram`} className="sim-caption">
            <span className="field-label pbs-[3px]">Fig.</span>
            <span>The loop as the figure draws it: the gain and the plant under unity negative feedback.</span>
          </figcaption>
        </figure>
        <div className="sim-grid sim-grid-single">
          <div className="sim-figure sim-contours">
            <div className="sim-tabs" role="tablist" aria-label="Loop view">
              {VIEWS.map(([id, name]) => tab(id, name))}
            </div>
            {panel(
              "locus",
              "The root locus: drag a closed-loop pole along it to set the gain. Crosses are the open-loop poles.",
              <div className="sim-stage-wrap" dir="ltr">
                <div ref={els.locus} className="sim-stage" data-board="locus" />
                <AxisName html={mathHtml.jw} where="y" />
                <AxisName html={mathHtml.sigma} where="x" />
              </div>,
            )}
            {panel(
              "step",
              "The step response, its final value and settling band dashed. The red pen marks the overshoot and the settling time.",
              <>
                <div className="sim-stage-wrap" dir="ltr">
                  <div ref={els.step} className="sim-stage" data-board="step" />
                  <AxisName html={mathHtml.y} where="y" />
                </div>
                <AxisName html={mathHtml.t} where="x" below />
              </>,
            )}
            {panel(
              "bode",
              "The open loop's Bode plot. The dotted line is the gain crossover; the bold stroke is the phase margin above −180°.",
              <>
                <div className="sim-stage-wrap" dir="ltr">
                  <div ref={els.magnitude} className="sim-stage control-bode" data-board="bode-magnitude" />
                  <AxisName html={mathHtml.magnitude} where="y" />
                </div>
                <div className="sim-stage-wrap" dir="ltr">
                  <div ref={els.phase} className="sim-stage control-bode" data-board="bode-phase" />
                  <AxisName html={mathHtml.phase} where="y" />
                </div>
                <AxisName html={mathHtml.w} where="x" below />
              </>,
            )}
            {panel(
              "nyquist",
              "The open loop's Nyquist plot round the critical point −1: positive frequencies solid, their mirror dashed.",
              <div className="sim-stage-wrap" dir="ltr">
                <div ref={els.nyquist} className="sim-stage" data-board="nyquist" />
                <AxisName html={mathHtml.im} where="y" />
                <AxisName html={mathHtml.re} where="x" />
              </div>,
            )}
          </div>

          <div className="sim-controls">
            <Slider
              name={mathHtml.K}
              range={tune.K}
              value={K}
              ready={ready}
              onChange={(v) => dispatch({ type: "set", input: "K", value: v })}
            />
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
                <tbody>
                  {rows.map(({ key, unit, v, ring }) => (
                    <tr key={key} className="h-[29px]" data-row={key}>
                      <th scope="row" className="border border-pencil px-2 text-start font-normal pad:px-3">
                        <span className="sim-column">
                          <span dangerouslySetInnerHTML={{ __html: mathHtml[key] }} />
                          {unit ? ` (${unit})` : ""}
                        </span>
                      </th>
                      <td className={`${ring && v !== undefined ? "relative " : ""}${cell} text-graphite`}>
                        {value(v)}
                        {ring && v !== undefined && (
                          <PenRing
                            draw={false}
                            className="absolute inset-s-[-2px] inset-bs-[-2px] size-[calc(100%+4px)]"
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="sim-readout" aria-live="polite">
              {info ? (
                <>
                  At <span dangerouslySetInnerHTML={{ __html: mathHtml.K }} /> ={" "}
                  <span className="font-quantity">{printAt(K, decimalsOf(tune.K.step))}</span> the response overshoots
                  by <span className="font-quantity">{value(info.overshoot)}</span> % and settles in{" "}
                  <span className="font-quantity">{value(info.Ts)}</span> s.
                </>
              ) : (
                <>
                  At <span dangerouslySetInnerHTML={{ __html: mathHtml.K }} /> ={" "}
                  <span className="font-quantity">{printAt(K, decimalsOf(tune.K.step))}</span>{" "}
                  {!loop.stable
                    ? "the loop is unstable: its response never settles."
                    : Math.abs((loop.numerator.at(-1) ?? 0) / (loop.denominator.at(-1) ?? 1)) < 1e-12
                      ? "the response settles to 0, so no overshoot or settling is read against it."
                      : "the response settles too slowly for its overshoot and settling to be read."}
                </>
              )}
            </p>
          </div>
        </div>
      </section>
    </MotionConfig>
  );
}
