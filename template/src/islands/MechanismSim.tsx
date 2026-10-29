// The mechanism sim (an Agent-built sim): the Professor's four-bar or spur gear pair, solved live by
// one kinematics engine and shown in 3D by default, with a printed 2D | 3D switch to the sheet
// drawing (hatched ground pins, pencil bars, the trace inking in). Students turn the driver, by the
// slider, by dragging the ringed pin in either view, or with Play; they never change the links. It
// opens on the Worked example's angle, and the engine is the one the build's kinematics gate
// replays. Reduced motion stops a running mechanism at the angle it has, and Play waits until the
// preference is off; the slider and the pin still turn it, instantly. three.js loads only when the
// 3D view is on screen.
import { useEffect, useId, useMemo, useReducer, useRef, useState } from "react";
import { drive, inkBuckets, startDrive, total } from "../sims/mechanism/drive.ts";
import { pose as poseAt, quantities, type Model } from "../sims/mechanism/engine.ts";
import { printAt } from "../sims/print.ts";
import { snap, type Range } from "../sims/tuning.ts";
import { Slider } from "./sim/controls.tsx";
import { MechanismSheet } from "./sim/mechanism-sheet.tsx";
import { MechanismViewer, type ViewerStatus } from "./sim/mechanism-viewer.tsx";
import { usePrefersReducedMotion } from "./sim/reduced-motion.ts";

type View = "2d" | "3d";

interface Props {
  model: Model;
  /** The Worked example's angle: the sim opens on it. */
  start: { theta: number };
  tune: { theta: Range };
  /** Decimals every value prints with: the sheet's. */
  decimals: number;
  /** Paper-math labels, rendered at build. */
  mathHtml: Record<"theta" | "theta3" | "theta4" | "mu" | "driven" | "ratio", string>;
  /** What the sim is, for assistive tech. */
  label: string;
}

/** The least time between two steps of the play clock: 30 a second. */
const FRAME_MS = 30;

const NO_WEBGL = "This browser can't draw the mechanism in 3D: it is shown as the sheet drawing.";

export default function MechanismSim({ model, start, tune, decimals, mathHtml, label }: Props) {
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>("3d");
  const [noThree, setNoThree] = useState(false);
  const [d, dispatch] = useReducer(drive, undefined, () => startDrive(start.theta, false));
  const reduced = usePrefersReducedMotion();
  const tabsId = useId();

  useEffect(() => setReady(true), []);
  // Reduced motion, followed live: a running mechanism stops where it is the moment the setting turns on.
  useEffect(() => dispatch({ type: "reduced", reduced }), [reduced]);

  // Whether the sim is near the screen: a running mechanism scrolled far away draws nothing and costs the page nothing.
  const rootEl = useRef<HTMLDivElement>(null);
  const [onScreen, setOnScreen] = useState(true);
  useEffect(() => {
    const el = rootEl.current;
    if (!el) return;
    const watch = new IntersectionObserver(([entry]) => entry && setOnScreen(entry.isIntersecting), {
      rootMargin: "25% 0px",
    });
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  // One frame loop, only while playing and in view: nothing runs when idle (and none under reduced motion).
  // It turns the driver every other frame at most (30 a second): a phone, or a page held back to a quarter of
  // its speed, gets the same motion for half the drawing.
  useEffect(() => {
    if (!d.playing || d.reduced || !onScreen) return;
    let last = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      frame = requestAnimationFrame(step);
      if (now - last < FRAME_MS) return;
      dispatch({ type: "tick", ms: now - last });
      last = now;
    });
    return () => cancelAnimationFrame(frame);
  }, [d.playing, d.reduced, onScreen]);

  // The pose, the engine's, drawn by whichever view is open.
  // Asked for at the angle and the turns Play has taken, so a gear pair's driven gear carries on across a wrap.
  const driver = total(d);
  const pose = useMemo(() => poseAt(model, driver), [model, driver]);
  const named = useMemo(() => quantities(model, { theta: driver }), [model, driver]);

  // The trace inks in the degrees the driver passes, in either view; coming back to 2D, it is all still there.
  // The path is the coupler point's over the crank's turn, or the tip of the driven gear's tooth round its
  // rim, so the ink follows the crank's angle, or the driven gear's.
  const inkAt = model.type === "gear-pair" ? (pose.links.driven?.angle ?? 0) : d.angle;
  const [inked, setInked] = useState<ReadonlySet<number>>(() => {
    const first = model.type === "gear-pair" ? (poseAt(model, start.theta).links.driven?.angle ?? 0) : start.theta;
    return inkBuckets(new Set(), first, first);
  });
  const lastInk = useRef(inkAt);
  useEffect(() => {
    // Read now: the updater runs later, once the ref below already holds the new place.
    const from = lastInk.current;
    setInked((now) => inkBuckets(now, from, inkAt));
    lastInk.current = inkAt;
  }, [inkAt]);

  const set = (angle: number) => dispatch({ type: "set", angle });
  const drag = (angle: number) => dispatch({ type: "drag", angle });
  // The slider shows where it was put: the far end stays at its end (360°), where the angle alone would read 0°.
  const onSlider = total(d) >= tune.theta.min && total(d) <= tune.theta.max ? total(d) : d.angle;
  const onStatus = (status: ViewerStatus) => {
    if (status === "no-webgl" || status === "no-part") {
      setNoThree(true);
      setView("2d");
    }
  };

  const value = (v: number) => printAt(v, decimals);
  const cell = "border border-pencil px-2 text-end whitespace-nowrap pad:px-3";
  const rows: { name: string; html?: string; text?: React.ReactNode; value: string }[] =
    model.type === "four-bar"
      ? [
          { name: "theta", html: mathHtml.theta, value: `${value(d.angle)}°` },
          { name: "theta3", html: mathHtml.theta3, value: `${value(named["theta3"] ?? 0)}°` },
          { name: "theta4", html: mathHtml.theta4, value: `${value(named["theta4"] ?? 0)}°` },
          { name: "mu", html: mathHtml.mu, value: `${value(named["mu"] ?? 0)}°` },
          ...(named["Px"] === undefined
            ? []
            : [
                {
                  name: "Px",
                  text: (
                    <>
                      P<sub>x</sub> (mm)
                    </>
                  ),
                  value: value(named["Px"]),
                },
                {
                  name: "Py",
                  text: (
                    <>
                      P<sub>y</sub> (mm)
                    </>
                  ),
                  value: value(named["Py"] ?? 0),
                },
              ]),
        ]
      : [
          { name: "theta", html: mathHtml.theta, value: `${value(d.angle)}°` },
          { name: "driven", html: mathHtml.driven, value: `${value(named["driven"] ?? 0)}°` },
          { name: "ratio", html: mathHtml.ratio, value: value(named["ratio"] ?? 0) },
        ];

  const tab = (id: View, name: string, disabled = false) => (
    <button
      type="button"
      role="tab"
      id={`${tabsId}-${id}`}
      aria-controls={`${tabsId}-panel`}
      aria-selected={view === id}
      className="artefact-tab label-action"
      disabled={!ready || disabled}
      onClick={() => setView(id)}
    >
      {name}
    </button>
  );

  return (
    <div
      ref={rootEl}
      className="sim mechanism"
      role="group"
      aria-label={label}
      data-mechanism={model.type}
      data-angle={d.angle.toFixed(3)}
      data-playing={d.playing}
      data-view={view}
      data-ready={ready}
    >
      <div className="sim-grid sim-grid-single">
        <div className="sim-figure sim-contours">
          <div className="sim-tabs" role="tablist" aria-label="Mechanism view">
            {tab("2d", "2D")}
            {tab("3d", "3D", noThree)}
          </div>
          <div id={`${tabsId}-panel`} role="tabpanel" aria-labelledby={`${tabsId}-${view}`}>
            {view === "3d" ? (
              <MechanismViewer
                model={model}
                pose={pose}
                label={label}
                onAngle={drag}
                onStatus={onStatus}
                ready={ready}
              />
            ) : (
              <MechanismSheet model={model} pose={pose} inked={inked} label={label} onAngle={drag} ready={ready} />
            )}
          </div>
          {noThree && (
            <p className="sim-readout" role="status" data-note="no-3d">
              {NO_WEBGL}
            </p>
          )}
        </div>

        <div className="sim-controls">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="button-print label-action"
              aria-pressed={d.playing}
              disabled={!ready || d.reduced}
              onClick={() => dispatch({ type: d.playing ? "pause" : "play" })}
            >
              {d.playing ? "Pause" : "Play"}
            </button>
            {d.reduced && (
              <p className="sim-readout m-0" data-note="reduced-motion">
                Motion is reduced: turn it with the slider or drag the ringed pin.
              </p>
            )}
          </div>
          <Slider
            name={mathHtml.theta}
            range={tune.theta}
            value={snap(onSlider, tune.theta)}
            ready={ready}
            onChange={set}
          />
        </div>

        <div className="sim-table">
          <div className="table-box sim-table-box">
            <table className="mechanism-values border-collapse bg-sheet font-quantity text-quantity-phone tabular-nums pad:text-quantity">
              <tbody>
                {rows.map((row) => (
                  <tr key={row.name} className="h-[29px]" data-row={row.name}>
                    <th scope="row" className="border border-pencil px-2 text-start font-normal pad:px-3">
                      {row.html !== undefined ? (
                        <span className="sim-column" dangerouslySetInnerHTML={{ __html: row.html }} />
                      ) : (
                        <span className="sim-column">{row.text}</span>
                      )}
                    </th>
                    <td className={`${cell} text-graphite`}>{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
