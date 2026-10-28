// The state-machine sim (an Agent-built sim): the Professor's Moore state diagram or GRAFCET,
// redrawn by the layout core and its curve drawer, run by the token engine a clock at a time.
// Students set the inputs and press Clock: a token travels the taken edge, the state table's row
// and the equations follow, and the timing strip grows over the key. Clock alone plays the example;
// a toggle deviates from it. They never redraw the diagram. The engine is the one the build's
// `state-table` and `timing-key` gates hold to an independent recompute.
import { MotionConfig } from "motion/react";
import { useEffect, useId, useMemo, useState } from "react";
import type { DiagramDrawing } from "../sims/layout/diagram.ts";
import { clockCaption, openingCaption } from "../sims/state-machine/captions.ts";
import {
  combos,
  fire,
  levelsOf,
  machineOf,
  periodOf,
  SEMANTICS,
  stateBits,
  stateName,
  timingRows,
  type Bit,
  type Family,
  type MachineModel,
  type Period,
  type Situation,
} from "../sims/state-machine/engine.ts";
import { evaluate, parseExpression, termsOf } from "../sims/state-machine/expressions.ts";
import { usePrefersReducedMotion } from "./sim/reduced-motion.ts";
import { StateDiagram } from "./sim/state-diagram.tsx";
import { TimingDiagram } from "./sim/timing-diagram.tsx";
import { PenRing } from "./worked/pen.tsx";
import { MARK_PAUSE } from "./worked/timing.ts";

interface Props {
  family: Family;
  model: MachineModel;
  /** The figure, laid out at build from the model and its Layout hints. */
  drawing: DiagramDrawing;
  /** The model edge each drawn edge is, read from geometry at build. */
  edges: number[];
  /** The example's first period's inputs: the sim opens on them. */
  start: Record<string, Bit>;
  /** The key: the Worked example's strip, by the quantity each cell maps (`x[3]`). */
  keyLevels: Record<string, number>;
  label: string;
}

/** How long a token takes along its edge, in ms. */
const TRAVEL_MS = 700;

/** What the page has run so far. */
interface Run {
  active: Situation;
  inputs: Record<string, Bit>;
  recorded: Period[];
  caption: string;
  /** The edges the last clock took. */
  taken: number[];
}

/** Ease in and out: a token leaves and arrives gently. */
const ease = (f: number) => (f < 0.5 ? 2 * f * f : 1 - (-2 * f + 2) ** 2 / 2);

const bitsOf = (inputs: readonly string[], values: Readonly<Record<string, number>>) =>
  inputs.map((i) => values[i]).join("");

export default function StateMachineSim({ family, model, drawing, edges, start, keyLevels, label }: Props) {
  const machine = useMemo(() => machineOf(family, model), [family, model]);
  const periods = Math.max(...Object.values(model.stimulus).map((s) => s.length));
  const opening = useMemo(
    (): Run => ({ active: machine.initial, inputs: start, recorded: [], caption: openingCaption(machine), taken: [] }),
    [machine, start],
  );
  const [ready, setReady] = useState(false);
  const [run, setRun] = useState<Run>(opening);
  const [flight, setFlight] = useState<{ edges: number[]; next: Situation } | undefined>();
  const [eased, setEased] = useState(0);
  const [touched, setTouched] = useState(false);
  const reduced = usePrefersReducedMotion();
  const captionId = useId();
  useEffect(() => setReady(true), []);

  // One frame loop, only while a token is on its way: an idle sim runs no clock.
  useEffect(() => {
    if (!flight) return;
    const began = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const f = Math.min(1, Math.max(0, (now - began) / TRAVEL_MS));
      setEased(ease(f));
      if (f >= 1) {
        setRun((r) => ({ ...r, active: flight.next }));
        setFlight(undefined);
        return;
      }
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [flight]);

  const rows = useMemo(() => timingRows(machine), [machine]);
  const live = useMemo(() => levelsOf(machine, run.recorded), [machine, run.recorded]);
  const done = run.recorded.length >= periods;
  const next = useMemo(
    () => (flight || done ? [] : fire(machine, run.active, run.inputs).taken),
    [machine, run.active, run.inputs, flight, done],
  );
  const leaving = flight ? [...new Set(flight.edges.map((i) => machine.edges[i]?.from ?? ""))] : [];
  const atOpening =
    run.recorded.length === 0 &&
    !flight &&
    model.inputs.every((i) => run.inputs[i] === start[i]) &&
    run.active.join() === machine.initial.join();

  const clock = () => {
    if (flight || done) return;
    setTouched(true);
    const k = run.recorded.length + 1;
    const period = periodOf(machine, run.active, run.inputs, k);
    const upcoming = k < periods ? SEMANTICS.sample(model.stimulus, model.inputs, k + 1) : run.inputs;
    const instant = reduced || period.taken.length === 0;
    setRun({
      active: instant ? period.next : run.active,
      inputs: upcoming,
      recorded: [...run.recorded, period],
      caption: clockCaption(machine, period, periods),
      taken: period.taken,
    });
    if (!instant) {
      setEased(0);
      setFlight({ edges: period.taken, next: period.next });
    }
  };
  const reset = () => {
    setFlight(undefined);
    setTouched(true);
    setRun(opening);
  };
  const toggle = (id: string) => {
    setTouched(true);
    setRun((r) => ({ ...r, inputs: { ...r.inputs, [id]: r.inputs[id] === 1 ? 0 : 1 } }));
  };

  const shown = bitsOf(model.inputs, run.inputs);
  const stateValues = { ...run.inputs, ...stateBits(machine, run.active) };
  const nameOfId = (id: string) => {
    const s = model.states.find((q) => q.id === id);
    return s ? stateName(family, s) : id;
  };
  const stateTable = family === "fsm";
  const ring = (
    <PenRing
      key={shown}
      draw={touched && !reduced}
      delay={MARK_PAUSE}
      className="absolute inset-s-[-2px] inset-bs-[-2px] size-[calc(100%+4px)]"
    />
  );
  const header = (c: Record<string, Bit>) => {
    const bits = bitsOf(model.inputs, c);
    return model.inputs.length === 1 ? `${model.inputs[0]} = ${bits}` : `${model.inputs.join("")} = ${bits}`;
  };

  return (
    <MotionConfig reducedMotion="user">
      <section
        className="sim state-machine-sim"
        aria-label={label}
        data-ready={ready}
        data-sim={family}
        data-period={run.recorded.length}
        data-active={run.active.join(" ")}
        data-travelling={flight !== undefined}
        data-reduced={reduced}
      >
        <div className="machine-grid">
          <figure className="sim-figure machine-figure" aria-labelledby={captionId}>
            <div className="logic-stage" dir="ltr">
              <StateDiagram
                drawing={drawing}
                edges={edges}
                active={run.active}
                leaving={leaving}
                next={next}
                taken={flight ? flight.edges : run.taken}
                travel={flight ? { edges: flight.edges, t: eased } : undefined}
                label={`${label}: the ${family === "fsm" ? "state diagram" : "GRAFCET"}, ${
                  family === "fsm" ? "in" : "with"
                } ${run.active.map(nameOfId).join(" and ")} ${family === "fsm" ? "" : "active"}`.trim()}
              />
            </div>
            <figcaption id={captionId} className="sim-caption">
              <span className="field-label pbs-[3px]">Fig.</span>
              <span>
                {family === "fsm"
                  ? "The figure's state diagram. The token sits in the active state; the edge the clock will take is inked."
                  : "The figure's GRAFCET. A token sits in each active step; the link whose transition can fire is inked."}
              </span>
            </figcaption>
            <p className="sim-readout machine-caption" aria-live="polite" data-caption>
              {run.caption}
            </p>
          </figure>

          <div className="machine-controls">
            <span className="field-label">Inputs</span>
            <div className="flex flex-wrap gap-2">
              {model.inputs.map((id) => (
                <button
                  key={id}
                  type="button"
                  className="button-print note-button logic-input"
                  aria-pressed={run.inputs[id] === 1}
                  disabled={!ready}
                  onClick={() => toggle(id)}
                >
                  <span className="font-quantity">{id}</span>
                  <span className="font-quantity font-semibold tabular-nums">{run.inputs[id] ?? 0}</span>
                </button>
              ))}
            </div>
            <span className="field-label">Clock</span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="button-print-next note-button label-action"
                disabled={!ready || flight !== undefined || done}
                onClick={clock}
              >
                Clock
              </button>
              <button
                type="button"
                className="button-print note-button label-action"
                disabled={!ready || atOpening}
                onClick={reset}
              >
                Reset
              </button>
            </div>
            {reduced && <p className="sim-readout">Motion is reduced: the token jumps to where the clock takes it.</p>}
            <p className="sim-readout tabular-nums">
              {done ? (
                <>
                  All <span className="font-quantity">{periods}</span> periods clocked
                </>
              ) : (
                <>
                  Period <span className="font-quantity">{run.recorded.length + 1}</span> of{" "}
                  <span className="font-quantity">{periods}</span>
                </>
              )}
            </p>
          </div>

          <div className="machine-table">
            <div className="table-box">
              {stateTable ? (
                <table
                  className="border-collapse bg-sheet font-quantity text-quantity-phone tabular-nums pad:text-quantity"
                  data-table="states"
                >
                  <thead>
                    <tr>
                      <th scope="col" className="border border-pencil px-3 pbs-1 pbe-1.5 text-start font-normal">
                        Present
                      </th>
                      {combos(model.inputs).map((c) => (
                        <th key={bitsOf(model.inputs, c)} scope="col" className="border border-pencil px-3 font-normal">
                          {header(c)}
                        </th>
                      ))}
                      {model.outputs.map((o) => (
                        <th key={o} scope="col" className="border border-pencil px-3 font-normal">
                          {o}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {model.states.map((s) => {
                      const current = run.active.includes(s.id);
                      return (
                        <tr key={s.id} className="h-[29px]" data-row={s.id} data-current={current || undefined}>
                          <th scope="row" className="border border-pencil px-3 text-start font-normal">
                            {s.label}
                            {model.encoding?.codes[s.id] !== undefined && (
                              <span className="machine-code"> {model.encoding.codes[s.id]}</span>
                            )}
                          </th>
                          {combos(model.inputs).map((c) => {
                            const bits = bitsOf(model.inputs, c);
                            const target = fire(machine, [s.id], c).next;
                            const isNext = current && bits === shown && !flight;
                            return (
                              <td
                                key={bits}
                                className="relative border border-pencil px-3 text-center text-pencil"
                                data-cell={`${s.id}:${bits}`}
                                data-next={isNext || undefined}
                              >
                                {target.map((id) => model.states.find((q) => q.id === id)?.label ?? id).join(", ")}
                                {isNext && ring}
                              </td>
                            );
                          })}
                          {model.outputs.map((o) => (
                            <td key={o} className="border border-pencil px-3 text-center text-pencil">
                              {s.out?.includes(o) ? 1 : 0}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <table
                  className="border-collapse bg-sheet font-quantity text-quantity-phone tabular-nums pad:text-quantity"
                  data-table="transitions"
                >
                  <thead>
                    <tr>
                      {["From", "Receptivity", "To"].map((h) => (
                        <th
                          key={h}
                          scope="col"
                          className="border border-pencil px-3 pbs-1 pbe-1.5 text-start font-normal"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {machine.edges.map((e, i) => {
                      const enabled = run.active.includes(e.from);
                      const firable = enabled && e.holds(run.inputs) && !flight;
                      return (
                        <tr
                          key={`${e.from}>${e.to}`}
                          className="h-[29px]"
                          data-row={i}
                          data-enabled={enabled || undefined}
                          data-firable={firable || undefined}
                        >
                          <td className="border border-pencil px-3">{nameOfId(e.from)}</td>
                          <td className="relative border border-pencil px-3 text-pencil">
                            {e.label}
                            {firable && ring}
                          </td>
                          <td className="border border-pencil px-3">{nameOfId(e.to)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {model.equations && (
            <ul className="machine-equations">
              {model.equations.map((eq) => {
                const terms = termsOf(eq.expr);
                return (
                  <li key={eq.name} data-equation={eq.name} className="font-quantity tabular-nums">
                    {eq.name} ={" "}
                    {terms.map((term, i) => (
                      <span key={term.text}>
                        {i > 0 && " + "}
                        <span data-term={i} data-true={evaluate(term.expr, stateValues) === 1 || undefined}>
                          {term.text}
                        </span>
                      </span>
                    ))}{" "}
                    <span data-value>= {evaluate(parseExpression(eq.expr), stateValues)}</span>
                  </li>
                );
              })}
            </ul>
          )}

          <figure className="machine-strip">
            <div className="logic-stage" dir="ltr">
              <TimingDiagram
                rows={rows}
                lines={periods + 1}
                keyLevels={keyLevels}
                live={live}
                now={flight ? { line: run.recorded.length, fraction: eased, travel: {} } : undefined}
                label={`${label}: the timing strip`}
              />
            </div>
            <figcaption className="sim-caption">
              <span className="field-label pbs-[3px]">Chart</span>
              <span>The timing strip: the key in pencil, the run inked over it in graphite, period by period.</span>
            </figcaption>
          </figure>
        </div>
      </section>
    </MotionConfig>
  );
}
