// The ladder/FBD sim (an Agent-built sim): the Professor's networks, redrawn by the layout core, run
// scan by scan on the S7 core. Students press the inputs and run time on: every rung segment carrying
// power inks in over its pencil line, a coil the power reaches is inked, each timer box fills its
// gauge as it runs, and the timing chart below records the bits and measures each timer's delay in
// red pen. They never rewire it. It opens on the Worked example's timeline already run, and the
// engine is the one the build's ladder gate holds to awlsim bit for bit.
import { MotionConfig } from "motion/react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { LadderRun, scansOf, type Inputs, type Timeline } from "../sims/ladder/engine.ts";
import { ELEMENTS, netOf, type LadderModel } from "../sims/ladder/model.ts";
import { momentOf, timerParts, type Moment } from "../sims/ladder/view.ts";
import type { Drawing } from "../sims/layout/drawing.ts";
import type { InkNets } from "../sims/layout/geometry.ts";
import { boxOf } from "../sims/layout/symbols.ts";
import { parseTime } from "../sims/s7/core.ts";
import { Schematic } from "./sim/Schematic.tsx";
import { TimingChart } from "./sim/timing-chart.tsx";

interface Props {
  model: LadderModel;
  /** The figure, laid out at build from the model and its Layout hints. */
  drawing: Drawing;
  nets: InkNets;
  /** The Worked example's input bits and timeline: the sim opens with it run. */
  start: Inputs;
  scenario: Timeline;
  /** Milliseconds from one scan to the next. */
  cycle: number;
  label: string;
}

/** The chart keeps this many scans; older ones scroll off. */
const KEEP = 600;
/** Run plays this long before it pauses itself, in ms of the PLC's time. */
const RUN_FOR = 30_000;

interface State {
  history: Moment[];
  inputs: Inputs;
}

/** A fresh CPU with the example's timeline run through it. */
function opening(model: LadderModel, start: Inputs, scenario: Timeline, cycle: number) {
  const run = new LadderRun(model);
  const scans = scansOf(start, scenario, cycle);
  const history = scans.map(({ ms, inputs }) => momentOf(run, run.scan(inputs, ms), inputs));
  return { run, state: { history, inputs: scans.at(-1)?.inputs ?? start } };
}

export default function LadderSim({ model, drawing, nets, start, scenario, cycle, label }: Props) {
  const [ready, setReady] = useState(false);
  const first = useMemo(() => opening(model, start, scenario, cycle), [model, start, scenario, cycle]);
  const run = useRef(first.run);
  // The run and its history live in refs, so a scan runs exactly once per tick; state re-renders them.
  const current = useRef<State>(first.state);
  const [state, setState] = useState<State>(first.state);
  const [touched, setTouched] = useState(false);
  const [playing, setPlaying] = useState(false);
  const captionId = useId();
  useEffect(() => setReady(true), []);

  const now = state.history.at(-1);
  const level = now?.levels ?? {};

  const commit = (next: State) => {
    current.current = next;
    setState(next);
  };

  /** Runs `count` scans with these inputs (the current ones by default). */
  const advance = (count: number, inputs = current.current.inputs) => {
    setTouched(true);
    const added: Moment[] = [];
    let ms = current.current.history.at(-1)?.ms ?? -cycle;
    for (let i = 0; i < count; i++) {
      ms += cycle;
      added.push(momentOf(run.current, run.current.scan(inputs, ms), inputs));
    }
    commit({ inputs, history: [...current.current.history, ...added].slice(-KEEP) });
  };

  useEffect(() => {
    if (!playing) return;
    const from = current.current.history.at(-1)?.ms ?? 0;
    const timer = setInterval(() => {
      if ((current.current.history.at(-1)?.ms ?? 0) - from >= RUN_FOR) setPlaying(false);
      else advance(1);
    }, cycle);
    return () => clearInterval(timer);
  }, [playing]);

  const press = (operand: string) => {
    const inputs = { ...current.current.inputs, [operand]: current.current.inputs[operand] === 1 ? 0 : 1 };
    // A press is read by the next scan, as the PLC reads its inputs at a scan's start.
    advance(1, inputs);
  };

  const reset = () => {
    setPlaying(false);
    run.current = new LadderRun(model);
    setTouched(true);
    commit({ inputs: start, history: [momentOf(run.current, run.current.scan(start, 0), start)] });
  };

  // The coils and boxes the power reaches are inked; a timer box is inked once its Q is.
  const partHigh = (id: string) => {
    const part = model.parts.find((p) => p.id === id);
    if (!part) return false;
    const element = ELEMENTS[part.kind];
    const pin = element.output && element.acts ? element.output : element.acts ? element.inputs[0] : undefined;
    const net = pin && netOf(model, `${id}.${pin}`);
    return !!net && level[net.id] === 1;
  };
  const scales = useMemo(() => {
    const out: Record<string, number> = {};
    for (const part of model.parts)
      if (part.kind === "ton" && part.params?.ET && part.params.PT) out[part.params.ET] = parseTime(part.params.PT);
    return out;
  }, [model]);
  const gauges = timerParts(model).flatMap((part) => {
    const placed = drawing.parts.find((p) => p.id === part.id);
    if (!placed) return [];
    const [x0, , x1, y1] = boxOf(placed);
    return [{ id: part.id, x: x0 + 8, y: y1 - 12, w: x1 - x0 - 16, fill: now?.gauges[part.id] ?? 0 }];
  });
  const watchBits = Object.entries(model.watch).filter(([, type]) => type === "BOOL");
  /** Each TON's elapsed time against its preset, in ms. */
  const timerReadout = timerParts(model)
    .filter((p) => p.kind === "ton")
    .map((p) => {
      const pt = parseTime(p.params?.PT ?? "T#0S");
      const et = (p.params?.ET ? now?.watch[p.params.ET] : undefined) ?? Math.round((now?.gauges[p.id] ?? 0) * pt);
      return { id: p.id, name: p.label ?? p.operand ?? p.id, et, pt };
    });

  return (
    <MotionConfig reducedMotion="user">
      <section className="sim ladder-sim" aria-label={label} data-ready={ready} data-sim="ladder">
        <div className="ladder-grid">
          <figure className="sim-figure ladder-figure" aria-labelledby={captionId}>
            <div className="logic-stage" dir="ltr">
              <Schematic
                drawing={drawing}
                nets={nets}
                high={(net) => net !== undefined && level[net] === 1}
                draw={touched}
                terminalNets={{}}
                partHigh={partHigh}
                label={`${label}: the networks at ${((now?.ms ?? 0) / 1000).toFixed(1)} s, with ${model.inputs.map((id) => `${id} = ${state.inputs[id] ?? 0}`).join(", ")}`}
                overlay={gauges.map((g) => (
                  <g key={g.id} className="ladder-gauge" data-gauge={g.id}>
                    <rect className="ladder-gauge-track" x={g.x} y={g.y} width={g.w} height={5} />
                    <rect className="ladder-gauge-fill" x={g.x} y={g.y} width={g.w * g.fill} height={5} />
                  </g>
                ))}
              />
            </div>
            <figcaption id={captionId} className="sim-caption">
              <span className="field-label pbs-[3px]">Fig.</span>
              <span>The figure's networks. A rung carrying power is inked; a timer's bar fills as it runs.</span>
            </figcaption>
          </figure>

          <div className="ladder-controls">
            <span className="field-label">Inputs</span>
            <div className="flex flex-wrap gap-2">
              {model.inputs.map((id) => (
                <button
                  key={id}
                  type="button"
                  className="button-print note-button logic-input"
                  aria-pressed={state.inputs[id] === 1}
                  disabled={!ready}
                  onClick={() => press(id)}
                >
                  <span className="font-quantity">{id}</span>
                  <span className="font-quantity font-semibold tabular-nums">{state.inputs[id] ?? 0}</span>
                </button>
              ))}
            </div>
            <span className="field-label">Time</span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="button-print-next note-button label-action"
                aria-pressed={playing}
                disabled={!ready}
                onClick={() => setPlaying((p) => !p)}
              >
                {playing ? "Pause" : "Run"}
              </button>
              <button
                type="button"
                className="button-print note-button label-action"
                disabled={!ready || playing}
                onClick={() => advance(1)}
              >
                Step a scan
              </button>
              <button
                type="button"
                className="button-print note-button label-action"
                disabled={!ready || playing}
                onClick={() => advance(Math.round(1000 / cycle))}
              >
                +1 s
              </button>
              <button type="button" className="button-print note-button label-action" disabled={!ready} onClick={reset}>
                Reset
              </button>
            </div>
            <p className="sim-readout tabular-nums">
              t = <span className="font-quantity">{((now?.ms ?? 0) / 1000).toFixed(1)}</span> s · a scan every{" "}
              <span className="font-quantity">{cycle}</span> ms
            </p>
            <p className="sim-readout" aria-live="polite">
              {watchBits.map(([operand], i) => (
                <span key={operand}>
                  {i > 0 && ", "}
                  {operand} = <span className="font-quantity">{now?.watch[operand] ?? 0}</span>
                </span>
              ))}
            </p>
            {timerReadout.length > 0 && (
              <p className="sim-readout tabular-nums">
                {timerReadout.map((t, i) => (
                  <span key={t.id}>
                    {i > 0 && " · "}
                    {t.name}: ET <span className="font-quantity">{t.et}</span> ms of{" "}
                    <span className="font-quantity">{t.pt}</span> ms
                  </span>
                ))}
              </p>
            )}
          </div>

          <figure className="ladder-chart">
            <div className="logic-stage" dir="ltr">
              <TimingChart
                model={model}
                history={state.history}
                scales={scales}
                label={`${label}: the timing chart of the last ten seconds`}
              />
            </div>
            <figcaption className="sim-caption">
              <span className="field-label pbs-[3px]">Chart</span>
              <span>The last ten seconds, scan by scan. Red pen measures each timer from its input to its Q.</span>
            </figcaption>
          </figure>
        </div>
      </section>
    </MotionConfig>
  );
}
