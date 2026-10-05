// The plane-wall sim (an Agent-built sim): a wall at one temperature whose faces are suddenly held
// at another, cooling (or heating) by conduction. The temperature across the wall at the chosen
// time on JSXGraph, with the Professor's table of the probes, and behind a second tab the whole
// wall over time as a heatmap. Students tune the time and the diffusivity, never the wall. It
// opens on the Worked example's values, and the engine is the one the build's number gate
// replays. Plotly, which draws the map, loads only when the map is opened.
import { useEffect, useId, useMemo, useReducer, useRef, useState } from "react";
import { field, PROBES, profile, quantities, type Model } from "../sims/plane-wall/engine.ts";
import { asWritten, printAt } from "../sims/print.ts";
import { startTuning, tuning, type Range, type TuningAction } from "../sims/tuning.ts";
import { fitOnResize, readInks } from "./sim/board.ts";
import { AxisName, Slider } from "./sim/controls.tsx";
import type { Heatmap, HeatmapLabels } from "./sim/heatmap.ts";
import { wallBoard, type WallBoard } from "./sim/wall-board.ts";

type Input = "time" | "diffusivity";
type View = "profile" | "map";

interface Props {
  model: Model;
  /** The Worked example's values: the sim opens on them. */
  start: Record<Input, number>;
  tune: Record<Input, Range>;
  /** Decimals every temperature prints with: the sheet's. */
  decimals: number;
  /** Paper-math labels, rendered at build, units included where a value has one. */
  mathHtml: Record<"x" | "T" | "time" | "diffusivity" | "Fo", string>;
  /** The map's axis titles, as plain text. */
  mapLabels: HeatmapLabels;
  /** The temperature's unit, as the Materials write it. */
  temperatureUnit: string;
  /** What the sim is, for assistive tech. */
  label: string;
}

/** The Fourier number, printed to three places. */
const FO_DECIMALS = 3;
/** Between a value and its unit: a monospaced space sets them too far apart. */
const NARROW_SPACE = " ";

export default function PlaneWallSim({
  model,
  start,
  tune,
  decimals,
  mathHtml,
  mapLabels,
  temperatureUnit,
  label,
}: Props) {
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>("profile");
  const [t, dispatch] = useReducer(
    (current: ReturnType<typeof startTuning>, action: TuningAction) => tuning(tune, current, action),
    start,
    startTuning,
  );
  const inputs = t.inputs as Record<Input, number>;
  const wall = useMemo(() => profile(model, inputs), [model, inputs]);
  const named = useMemo(() => quantities(model, inputs), [model, inputs]);

  const boardEl = useRef<HTMLDivElement>(null);
  const mapEl = useRef<HTMLDivElement>(null);
  const [board, setBoard] = useState<{ view: WallBoard; JXG: typeof import("jsxgraph") }>();
  const [map, setMap] = useState<Heatmap>();
  const captionId = useId();
  const tabsId = useId();

  useEffect(() => setReady(true), []);
  // JSXGraph loads when the sim is on screen, never with the page.
  useEffect(() => {
    let cancelled = false;
    let made: { view: WallBoard; JXG: typeof import("jsxgraph") } | undefined;
    void import("jsxgraph").then(({ default: JXG }) => {
      const el = boardEl.current;
      if (cancelled || !el) return;
      made = { JXG, view: wallBoard(JXG, el, { model, inks: readInks(el) }) };
      setBoard(made);
    });
    return () => {
      cancelled = true;
      if (made) made.JXG.JSXGraph.freeBoard(made.view.board);
    };
  }, [model]);

  // Plotly loads the first time the map is opened, never before. It is heavy: on a phone it holds
  // the page for seconds while it starts. So the tab answers first, saying the map is loading, and
  // the import waits a frame for that to show; the sim says it is busy until the map is drawn.
  const mapOpened = view === "map" || map !== undefined;
  const [mapDrawn, setMapDrawn] = useState(false);
  // Busy while the open tab waits for the map; back on Profile, nothing waits for it.
  const loadingMap = view === "map" && !mapDrawn;
  useEffect(() => {
    if (!mapOpened || map) return;
    let cancelled = false;
    const frame = requestAnimationFrame(() =>
      setTimeout(() => {
        if (cancelled) return;
        void import("./sim/heatmap.ts").then(({ heatmap }) => {
          const el = mapEl.current;
          if (!cancelled && el) setMap(heatmap(el, { inks: readInks(el), labels: mapLabels }));
        });
      }),
    );
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [mapOpened, map, mapLabels]);
  useEffect(() => () => map?.free(), [map]);

  useEffect(() => {
    if (!board) return;
    return fitOnResize([[board.view.board, boardEl.current]]);
  }, [board]);

  useEffect(() => {
    board?.view.draw(wall);
  }, [board, wall]);

  // The map depends on the diffusivity alone; the chosen time is the line across it.
  const over = useMemo(
    () => (map ? field(model, { diffusivity: inputs.diffusivity, until: tune.time.max }) : undefined),
    [map, model, inputs.diffusivity, tune.time.max],
  );
  useEffect(() => {
    if (map && over && view === "map") void map.draw(over, inputs.time).then(() => setMapDrawn(true));
  }, [map, over, inputs.time, view]);

  const value = (v: number) => printAt(v, decimals);
  const set = (input: Input) => (v: number) => dispatch({ type: "set", input, value: v });
  const cell = "border border-pencil px-2 text-end whitespace-nowrap pad:px-3";
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
      className="sim"
      aria-label={label}
      data-ready={ready}
      data-sim="plane-wall"
      aria-busy={loadingMap || undefined}
    >
      <div className="sim-grid sim-grid-single">
        <div className="sim-figure sim-contours">
          <div className="sim-tabs" role="tablist" aria-label="Wall view">
            {tab("profile", "Profile")}
            {tab("map", "Map over time")}
          </div>
          <figure
            id={`${tabsId}-profile-panel`}
            role="tabpanel"
            aria-labelledby={`${tabsId}-profile ${captionId}-profile`}
            hidden={view !== "profile"}
          >
            <div className="sim-stage-wrap" dir="ltr">
              <div ref={boardEl} className="sim-stage" data-board="profile" />
              <AxisName html={mathHtml.T} where="y" />
            </div>
            <AxisName html={mathHtml.x} where="x" below />
            <figcaption id={`${captionId}-profile`} className="sim-caption">
              <span className="field-label pbs-[3px]">Fig.</span>
              <span>
                The temperature across the wall at the chosen time, between where it starts and where it settles, both
                dashed.
              </span>
            </figcaption>
          </figure>
          <figure
            id={`${tabsId}-map-panel`}
            role="tabpanel"
            aria-labelledby={`${tabsId}-map ${captionId}-map`}
            hidden={view !== "map"}
          >
            {loadingMap && (
              <p className="sim-readout mbe-2" role="status">
                Loading the map…
              </p>
            )}
            {/* Plotly draws one plot in stacked SVG layers: one figure to the layout sweep. */}
            <div ref={mapEl} className="sim-stage sim-map" data-map="heatmap" data-figure-layers dir="ltr" />
            <figcaption id={`${captionId}-map`} className="sim-caption">
              <span className="field-label pbs-[3px]">Fig.</span>
              <span>The whole wall over time, darker where it is hotter. The line is the chosen time.</span>
            </figcaption>
          </figure>
        </div>

        <div className="sim-controls">
          <Slider name={mathHtml.time} range={tune.time} value={inputs.time} ready={ready} onChange={set("time")} />
          <Slider
            name={mathHtml.diffusivity}
            range={tune.diffusivity}
            value={inputs.diffusivity}
            ready={ready}
            onChange={set("diffusivity")}
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
              <thead>
                <tr>
                  {(["x", "T"] as const).map((c) => (
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
                {PROBES.map(([name, share], i) => (
                  <tr key={share} className="h-[29px]" data-row={i}>
                    <td className={`${cell} text-graphite`}>{asWritten(share * model.thickness)}</td>
                    <td className={`${cell} text-pencil`}>{value(named[name] ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="sim-readout" aria-live="polite">
            <span dangerouslySetInnerHTML={{ __html: mathHtml.Fo }} /> ={" "}
            <span className="font-quantity">{printAt(named.Fo ?? 0, FO_DECIMALS)}</span>: the mid-plane is at{" "}
            <span className="font-quantity whitespace-nowrap">
              {value(named["T(L/2)"] ?? 0)}
              {NARROW_SPACE}
              {temperatureUnit}
            </span>
            , the quarter points at{" "}
            <span className="font-quantity whitespace-nowrap">
              {value(named["T(L/4)"] ?? 0)}
              {NARROW_SPACE}
              {temperatureUnit}
            </span>
          </p>
        </div>
      </div>
    </section>
  );
}
