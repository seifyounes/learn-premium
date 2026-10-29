// The Nernst sim (an Agent-built sim): a galvanic cell of two metal | metal-ion half-cells, written
// first | second, under the Nernst equation. By default the cell itself in 3D, its electrons
// running the wire; behind a second tab, E against log₁₀Q, one line for each isotherm. Students
// tune the two concentrations and the temperature, never the cell. Slide c₁ past c₂ and the
// electrons, the anode and the voltmeter's sign turn round. It opens on the Worked example's values,
// and the engine is the one the build's `nernst` gate replays, against an independent recompute.
// three.js and JSXGraph load only when the view that needs them is on screen.
import { useEffect, useId, useMemo, useReducer, useRef, useState } from "react";
import { nernstSeries, startSeries, toggleSeries } from "../chemistry/series.ts";
import { cellState } from "../sims/nernst/apparatus.ts";
import { cellPotential, type Model } from "../sims/nernst/engine.ts";
import { decimalsOf, printAt } from "../sims/print.ts";
import { startTuning, tuning, type Range, type TuningAction } from "../sims/tuning.ts";
import { fitOnResize, readInks } from "./sim/board.ts";
import { CellViewer } from "./sim/cell-viewer.tsx";
import { AxisName, Slider } from "./sim/controls.tsx";
import { nernstBoard, type NernstBoard } from "./sim/nernst-board.ts";
import { usePrefersReducedMotion } from "./sim/reduced-motion.ts";
import { SeriesToggles } from "./sim/series-toggles.tsx";

type Input = "c1" | "c2" | "T";
type View = "cell" | "plot";

interface Props {
  model: Model;
  /** The Worked example's values: the sim opens on them. */
  start: Record<Input, number>;
  tune: Record<Input, Range>;
  plot: { isotherms: number[]; many?: "toggle" | undefined; shown?: number[] | undefined };
  /** Decimals every value prints with: the sheet's. */
  decimals: number;
  /** Paper-math labels, rendered at build, units included where a value has one. */
  mathHtml: Record<"c1" | "c2" | "T" | "E0" | "n" | "Q" | "E" | "deltaG" | "K" | "logQ" | "notation", string>;
  /** What the sim is, for assistive tech. */
  label: string;
}

const REGIONS = { forward: "E > 0: runs as written", reverse: "E < 0: runs in reverse" };

export default function NernstSim({ model, start, tune, plot, decimals, mathHtml, label }: Props) {
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>("cell");
  const [t, dispatch] = useReducer(
    (current: ReturnType<typeof startTuning>, action: TuningAction) => tuning(tune, current, action),
    start,
    startTuning,
  );
  const inputs = t.inputs as Record<Input, number>;
  const cell = useMemo(() => cellPotential(model, inputs), [model, inputs]);
  const state = useMemo(() => cellState(model, inputs), [model, inputs]);
  const reduced = usePrefersReducedMotion();

  const defs = useMemo(() => nernstSeries(plot), [plot]);
  const [series, setSeries] = useState(() => startSeries(defs, plot.shown));

  const boardEl = useRef<HTMLDivElement>(null);
  const [board, setBoard] = useState<{ view: NernstBoard; JXG: typeof import("jsxgraph") }>();
  const captionId = useId();
  const tabsId = useId();

  useEffect(() => setReady(true), []);

  // JSXGraph loads the first time the plot is opened, never with the page.
  const plotOpened = view === "plot" || board !== undefined;
  useEffect(() => {
    if (!plotOpened) return;
    let cancelled = false;
    let made: { view: NernstBoard; JXG: typeof import("jsxgraph") } | undefined;
    void import("jsxgraph").then(({ default: JXG }) => {
      const el = boardEl.current;
      if (cancelled || !el) return;
      made = {
        JXG,
        view: nernstBoard(JXG, el, {
          model,
          tune,
          defs,
          inks: readInks(el),
          regions: REGIONS,
          initial: standing.current,
        }),
      };
      setBoard(made);
    });
    return () => {
      cancelled = true;
      if (made) made.JXG.JSXGraph.freeBoard(made.view.board);
      setBoard(undefined);
    };
  }, [plotOpened, model, tune, defs]);

  useEffect(() => {
    if (!board) return;
    return fitOnResize([[board.view.board, boardEl.current]], board.view.relayout);
  }, [board]);

  const logQ = Math.log10(cell.Q);
  /** What the board is drawn with when it is made: the cell and the lines as they stand then. */
  const standing = useRef({ at: { logQ, E: cell.E }, shown: series.shown });
  standing.current = { at: { logQ, E: cell.E }, shown: series.shown };
  useEffect(() => {
    board?.view.draw({ logQ, E: cell.E }, series.shown);
  }, [board, logQ, cell.E, series.shown, view]);

  const value = (v: number) => printAt(v, decimals);
  const set = (input: Input) => (v: number) => dispatch({ type: "set", input, value: v });
  const cellClass = "border border-pencil px-2 text-end whitespace-nowrap pad:px-3";
  const rows: { name: string; html: string; text: string }[] = [
    { name: "E0", html: mathHtml.E0, text: value(cell.E0cell) },
    { name: "n", html: mathHtml.n, text: String(cell.n) },
    { name: "Q", html: mathHtml.Q, text: value(cell.Q) },
    { name: "E", html: mathHtml.E, text: value(cell.E) },
    { name: "deltaG", html: mathHtml.deltaG, text: value(cell.deltaG) },
    { name: "K", html: mathHtml.K, text: value(cell.K) },
  ];
  const tab = (id: View, name: string) => (
    <button
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

  return (
    <section
      className="sim nernst"
      aria-label={label}
      data-ready={ready}
      data-sim="nernst"
      data-e={printAt(cell.E, decimals)}
      data-electron-flow={state.flow}
      data-view={view}
    >
      <div className="sim-grid sim-grid-single">
        <div className="sim-figure sim-contours">
          <p className="sim-readout nernst-notation" data-cell-notation>
            <span dangerouslySetInnerHTML={{ __html: mathHtml.notation }} />
          </p>
          <div className="sim-tabs" role="tablist" aria-label="Nernst view">
            {tab("cell", "Cell")}
            {tab("plot", "Plot")}
          </div>
          <div id={`${tabsId}-cell-panel`} role="tabpanel" aria-labelledby={`${tabsId}-cell`} hidden={view !== "cell"}>
            <CellViewer
              model={model}
              state={state}
              decimals={{ E: decimals, c: decimalsOf(tune.c1.step) }}
              label={label}
              ready={ready}
              reduced={reduced}
            />
          </div>
          <figure
            id={`${tabsId}-plot-panel`}
            role="tabpanel"
            aria-labelledby={`${tabsId}-plot ${captionId}-plot`}
            hidden={view !== "plot"}
          >
            <div className="sim-stage-wrap" dir="ltr">
              <div ref={boardEl} className="sim-stage" data-board="nernst" />
              <AxisName html={`${mathHtml.E}`} where="y" />
            </div>
            <AxisName html={mathHtml.logQ} where="x" below />
            <SeriesToggles
              defs={defs}
              state={series}
              ready={ready}
              onToggle={(id) => setSeries((s) => toggleSeries(defs, s, id))}
            />
            <figcaption id={`${captionId}-plot`} className="sim-caption">
              <span className="field-label pbs-[3px]">Fig.</span>
              <span>
                The cell&rsquo;s potential against its reaction quotient, one line for each temperature. The dot is
                where the sliders put the cell.
              </span>
            </figcaption>
          </figure>
        </div>

        <div className="sim-controls">
          <Slider name={mathHtml.c1} range={tune.c1} value={inputs.c1} ready={ready} onChange={set("c1")} />
          <Slider name={mathHtml.c2} range={tune.c2} value={inputs.c2} ready={ready} onChange={set("c2")} />
          <Slider name={mathHtml.T} range={tune.T} value={inputs.T} ready={ready} onChange={set("T")} />
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
            <table className="nernst-values border-collapse bg-sheet font-quantity text-quantity-phone tabular-nums pad:text-quantity">
              <tbody>
                {rows.map((row) => (
                  <tr key={row.name} className="h-[29px]" data-row={row.name}>
                    <th scope="row" className="border border-pencil px-2 text-start font-normal pad:px-3">
                      <span className="sim-column" dangerouslySetInnerHTML={{ __html: row.html }} />
                    </th>
                    <td className={`${cellClass} text-graphite`}>{row.text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="sim-readout" aria-live="polite">
            {state.flow === "none"
              ? "No current: the two concentrations are equal."
              : state.flow === "first-to-second"
                ? "The cell runs as written: electrons go from the first electrode to the second."
                : "The cell runs in reverse: electrons go from the second electrode to the first."}
          </p>
        </div>
      </div>
    </section>
  );
}
