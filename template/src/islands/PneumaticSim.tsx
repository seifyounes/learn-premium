// The pneumatic sim (an Agent-built sim): the Professor's circuit, redrawn by the layout core, run by
// the engine a stroke at a time. Students press or hold its push buttons and step the cycle: every
// pressurised line is inked over its pencil line, control lines are dashed, spools slide and pistons
// travel, the caption says what set what off, and the displacement-step diagram inks itself in
// graphite over the key in pencil. They never rewire it. The engine is the one the build's
// `pneumatic-cycle` and `timing-key` gates hold to an independent recompute, bit for bit.
import { MotionConfig } from "motion/react";
import { useEffect, useId, useMemo, useState } from "react";
import type { Drawing } from "../sims/layout/drawing.ts";
import type { InkNets } from "../sims/layout/geometry.ts";
import { restCaption, stepCaption } from "../sims/pneumatic/captions.ts";
import {
  advance,
  atRest,
  controlNets,
  cycleDone,
  isStill,
  liveDiagram,
  restState,
  setHeld,
  STROKE_MS,
  stepStateOf,
  timingRows,
  toNextStep,
  type Level,
  type PneumaticEvent,
  type PneumaticModel,
  type State,
  type StepState,
} from "../sims/pneumatic/engine.ts";
import { PneumaticParts } from "./sim/pneumatic-parts.tsx";
import { usePrefersReducedMotion } from "./sim/reduced-motion.ts";
import { Schematic } from "./sim/Schematic.tsx";
import { TimingDiagram } from "./sim/timing-diagram.tsx";

interface Props {
  model: PneumaticModel;
  /** The figure, laid out at build from the model and its Layout hints. */
  drawing: Drawing;
  nets: InkNets;
  /** Each push button as the sim opens: held (1) or not (0). */
  start: Record<string, Level>;
  /** The key: the Worked example's diagram, by the quantity each cell maps (`A[3]`). */
  keyLevels: Record<string, number>;
  label: string;
}

/** The longest span of time one animation frame may move the circuit, in ms. */
const MAX_TICK_MS = 100;

/** What the page has run so far: the circuit, the step lines of this cycle, and the caption. */
interface Run {
  state: State;
  /** The circuit at each step line since this cycle began. */
  recorded: StepState[];
  caption: string;
  cycles: number;
}

type Result = { state: State; events: PneumaticEvent[] };

/** The circuit at a step line, or nothing for a state no step line has (a cylinder mid-stroke). */
function lineOf(model: PneumaticModel, state: State): StepState[] {
  try {
    return [stepStateOf(model, state)];
  } catch {
    // The gate a sim passes shows no cylinder mid-stroke at a stroke end; a line it can't draw is skipped.
    return [];
  }
}

/** The run once `result` has happened: a cycle begun, a step line reached, or what a button did. */
function absorb(model: PneumaticModel, run: Run, result: Result): Run {
  const { state, events } = result;
  if (events.length === 0) return { ...run, state };
  const started = events.some((e) => e.kind === "start");
  if (started && isStill(run.state) && atRest(model, run.state))
    return { ...run, state, recorded: lineOf(model, state), caption: stepCaption(model, events) };
  if (events.some((e) => e.kind === "end")) {
    const done = cycleDone(model, state, events);
    const caption = stepCaption(model, events, done && isStill(state));
    // A button held down starts the next cycle by itself: its diagram begins afresh.
    if (done && !isStill(state)) return { state, recorded: lineOf(model, state), caption, cycles: run.cycles + 1 };
    return {
      state,
      recorded: [...run.recorded, ...lineOf(model, state)],
      caption,
      cycles: run.cycles + (done ? 1 : 0),
    };
  }
  return { ...run, state, caption: stepCaption(model, events) };
}

/** Time on by `ms`, reading each stroke end as the step line it is. */
function play(model: PneumaticModel, from: Run, ms: number): Run {
  let run = from;
  let left = ms;
  for (let guard = 0; left > 0 && !isStill(run.state) && guard < 64; guard++) {
    const toEnd = Math.min(
      ...Object.keys(run.state.motion)
        .filter((id) => run.state.motion[id] !== 0)
        .map((id) =>
          run.state.motion[id] === 1 ? STROKE_MS - (run.state.travel[id] ?? 0) : (run.state.travel[id] ?? 0),
        ),
    );
    const dt = Math.max(1, Math.min(left, toEnd));
    run = absorb(model, run, advance(model, run.state, dt));
    left -= dt;
  }
  return run;
}

/** The circuit at rest, on the example's buttons: the page opens as the figure draws it. */
function opening(model: PneumaticModel, start: Record<string, Level>): Run {
  const rest = restState(model);
  let run: Run = { state: rest.state, recorded: [], caption: restCaption(model, rest.state.lines), cycles: 0 };
  for (const [part, level] of Object.entries(start))
    if (level === 1) run = absorb(model, run, setHeld(model, run.state, part, 1));
  return run;
}

export default function PneumaticSim({ model, drawing, nets, start, keyLevels, label }: Props) {
  const [ready, setReady] = useState(false);
  const first = useMemo(() => opening(model, start), [model, start]);
  const [run, setRun] = useState<Run>(first);
  const [paused, setPaused] = useState(false);
  const [touched, setTouched] = useState(false);
  const reduced = usePrefersReducedMotion();
  const captionId = useId();
  useEffect(() => setReady(true), []);

  const rows = useMemo(() => timingRows(model), [model]);
  const control = useMemo(() => controlNets(model), [model]);
  const buttons = model.parts.filter((p) => p.kind === "valve-32-button");
  const { state } = run;
  const still = isStill(state);
  const { levels, now } = liveDiagram(model, run.recorded, state);

  // One frame loop, only while something moves and nothing holds it: an idle sim runs no clock.
  useEffect(() => {
    if (!ready || paused || reduced || still) return;
    let last = performance.now();
    let frame = requestAnimationFrame(function tick(t) {
      const dt = Math.min(Math.round(t - last), MAX_TICK_MS);
      last = t;
      if (dt > 0) setRun((r) => play(model, r, dt));
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [ready, paused, reduced, still, model]);

  const act = (change: (r: Run) => Run) => {
    setTouched(true);
    setRun(change);
  };
  /** A push button pressed once: held, then let go. */
  const press = (part: string) =>
    act((r) => {
      const down = setHeld(model, r.state, part, 1);
      const up = setHeld(model, down.state, part, 0);
      return absorb(model, r, { state: up.state, events: [...down.events, ...up.events] });
    });
  const hold = (part: string) =>
    act((r) => absorb(model, r, setHeld(model, r.state, part, r.state.held[part] === 1 ? 0 : 1)));
  const step = () => act((r) => absorb(model, r, toNextStep(model, r.state)));
  const reset = () => {
    setPaused(false);
    act(() => opening(model, {}));
  };
  const idle =
    atRest(model, state) && still && run.recorded.length === 0 && buttons.every((b) => state.held[b.id] !== 1);

  return (
    <MotionConfig reducedMotion="user">
      <section
        className="sim pneumatic-sim"
        aria-label={label}
        data-ready={ready}
        data-sim="pneumatic"
        data-step={run.recorded.length}
        data-still={still}
        data-reduced={reduced}
        data-cycles={run.cycles}
      >
        <div className="pneumatic-grid">
          <figure className="sim-figure pneumatic-figure" aria-labelledby={captionId}>
            <div className="logic-stage" dir="ltr">
              <Schematic
                drawing={drawing}
                nets={nets}
                high={(net) => net !== undefined && state.lines[net] === 1}
                draw={touched}
                terminalNets={{}}
                wireClass={(net) => (net !== undefined && control.has(net) ? "is-pilot" : undefined)}
                overlay={<PneumaticParts drawing={drawing} model={model} state={state} />}
                label={`${label}: the circuit, ${run.recorded.length === 0 ? "at rest" : `at step ${run.recorded.length}`}`}
              />
            </div>
            <figcaption id={captionId} className="sim-caption">
              <span className="field-label pbs-[3px]">Fig.</span>
              <span>
                The figure's circuit. A pressurised line is inked, an exhausted one stays in pencil; control lines are
                dashed.
              </span>
            </figcaption>
            <p className="sim-readout pneumatic-caption" aria-live="polite" data-caption>
              {run.caption}
            </p>
          </figure>

          <div className="pneumatic-controls">
            <span className="field-label">Buttons</span>
            <div className="flex flex-wrap gap-2">
              {buttons.map((b) => (
                <span key={b.id} className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="button-print note-button label-action"
                    disabled={!ready || state.held[b.id] === 1}
                    onClick={() => press(b.id)}
                  >
                    Press <span className="font-quantity">{b.label ?? b.id}</span>
                  </button>
                  <button
                    type="button"
                    className="button-print note-button label-action logic-input"
                    aria-pressed={state.held[b.id] === 1}
                    disabled={!ready}
                    onClick={() => hold(b.id)}
                  >
                    Hold <span className="font-quantity">{b.label ?? b.id}</span>
                  </button>
                </span>
              ))}
            </div>
            <span className="field-label">Motion</span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="button-print-next note-button label-action"
                disabled={!ready || still}
                onClick={step}
              >
                Step
              </button>
              <button
                type="button"
                className="button-print note-button label-action"
                aria-pressed={paused}
                disabled={!ready || still || reduced}
                onClick={() => setPaused((p) => !p)}
              >
                {paused ? "Resume" : "Pause"}
              </button>
              <button
                type="button"
                className="button-print note-button label-action"
                disabled={!ready || idle}
                onClick={reset}
              >
                Reset
              </button>
            </div>
            {reduced && (
              <p className="sim-readout">Motion is reduced: Step moves each cylinder its whole stroke at once.</p>
            )}
            <p className="sim-readout tabular-nums">
              Step <span className="font-quantity">{run.recorded.length}</span> of{" "}
              <span className="font-quantity">{model.sequence.length + 1}</span>
            </p>
          </div>

          <figure className="pneumatic-diagram">
            <div className="logic-stage" dir="ltr">
              <TimingDiagram
                rows={rows}
                lines={model.sequence.length + 1}
                keyLevels={keyLevels}
                live={levels}
                now={now}
                label={`${label}: the displacement-step diagram`}
              />
            </div>
            <figcaption className="sim-caption">
              <span className="field-label pbs-[3px]">Chart</span>
              <span>The displacement-step diagram: the key in pencil, the run inked over it in graphite.</span>
            </figcaption>
          </figure>
        </div>
      </section>
    </MotionConfig>
  );
}
