// The SCL sim (an Agent-built sim): the Professor's SCL listing running on the S7 core, each scan
// one call of its FUNCTION_BLOCK. Students set the block's inputs, step a statement or run a scan,
// and read what each statement decided and wrote, beside the watch table. They never edit the
// listing. It opens on the Worked example's values, one scan run, and its engine is the one the
// build's scl gate holds to the blind interpreter on every scan.
//
// A listing the Professor built up over several slides shows a tab per build step, each with the
// lines that step added; a fragment a slide shows only for its syntax stays static code. A line the
// Owner ruled a Divergence is marked in red pen: reading it shows the Professor's result as the
// exam answer, and what a real S7 does.
import { useEffect, useId, useMemo, useState } from "react";
import { fits, toReal } from "../sims/s7/core.ts";
import { SclRun, type Inputs, type Leaf, type SclModel, type TraceEntry } from "../sims/scl/engine.ts";
import { buildStage, valuesAt, watchRows } from "../sims/scl/view.ts";
import type { Range } from "../sims/tuning.ts";
import { InputKeys } from "./sim/s7-inputs.tsx";
import { Fragment, Listing, StageListing, StatePanel, Trace, type Ruling } from "./sim/scl-view.tsx";

/** A walkthrough step as the page prints it: its title and note rendered at build. */
export interface BuildStep {
  titleHtml: string;
  lines: string;
  noteHtml?: string;
  fragment?: string;
}

interface Props {
  model: SclModel;
  /** The Worked example's values: the sim opens on them. */
  start: Inputs;
  tune: Record<string, Range>;
  /** What the sim is, for assistive tech. */
  label: string;
  walkthrough: BuildStep[];
  divergences: Ruling[];
  /** The inputs whose example value is −0.0, which the page's props carry as 0. */
  negativeZero?: string[];
}

/** One scan as the page holds it: the values it began with, its whole trace, and how much is read. */
interface Scan {
  number: number;
  before: Record<string, Leaf>;
  trace: TraceEntry[];
  /** Why the CPU stopped, if it did. */
  error?: string;
  /** Statements read so far (the last is the one being read). */
  shown: number;
}

/** Runs one scan on the run: the trace is all worked out now, and read a statement at a time. */
function runScan(run: SclRun, inputs: Inputs, number: number, shown: "all" | 1): Scan {
  const before = run.watchable();
  for (const [name, type] of Object.entries(run.inputs)) {
    const value = inputs[name];
    if (value !== undefined) before[name] = { type, value: type === "REAL" ? toReal(value) : value };
  }
  const { trace, error } = run.scan(inputs);
  return {
    number,
    before,
    trace,
    ...(error === undefined ? {} : { error }),
    shown: shown === "all" ? trace.length : Math.min(1, trace.length),
  };
}

export default function SclSim({
  model,
  start: given,
  tune,
  label,
  walkthrough,
  divergences,
  negativeZero = [],
}: Props) {
  const start = useMemo(
    () => ({ ...given, ...Object.fromEntries(negativeZero.map((name) => [name, -0])) }),
    [given, negativeZero],
  );
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const lines = useMemo(() => model.source.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n"), [model.source]);
  const [inputs, setInputs] = useState<Inputs>(start);
  const [pending, setPending] = useState(false);
  const [{ run, scan }, setView] = useState(() => {
    const r = new SclRun(model);
    return { run: r, scan: runScan(r, start, 1, "all") };
  });
  /** The tab on show: a build step, or the live listing (`walkthrough.length`). */
  const [tab, setTab] = useState(walkthrough.length);
  const tabsId = useId();
  const live = tab === walkthrough.length;

  const done = scan.shown >= scan.trace.length;
  const next = () => {
    setPending(false);
    return runScan(run, inputs, scan.number + 1, 1);
  };
  /** The next statement: a new scan begins first (taking the new inputs) if the last one was read through. */
  const step = () => {
    setTab(walkthrough.length);
    setView({ run, scan: done ? next() : { ...scan, shown: scan.shown + 1 } });
  };
  /** The rest of this scan, or a whole new one if it was read through. */
  const scanToEnd = () => {
    setTab(walkthrough.length);
    setView({ run, scan: done ? { ...next(), shown: Infinity } : { ...scan, shown: scan.trace.length } });
  };
  /** A cold start: the DBs and statics back at their initial values, the example's inputs, one scan run. */
  const reset = () => {
    setInputs(start);
    setPending(false);
    const r = new SclRun(model);
    setView({ run: r, scan: runScan(r, start, 1, "all") });
  };
  const setInput = (name: string, value: number) => {
    const type = run.inputs[name];
    if (type === undefined || !Number.isFinite(value) || !fits(type, value)) return;
    setInputs((current) => ({ ...current, [name]: value }));
    setPending(true);
  };

  const shown = Math.min(scan.shown, scan.trace.length);
  const entry = scan.trace[shown - 1];
  const values = useMemo(() => valuesAt(scan.before, scan.trace, shown - 1), [scan, shown]);
  const rows = useMemo(() => watchRows(model.watch, values, entry), [model.watch, values, entry]);
  const ran = useMemo(() => {
    const set = new Set<number>();
    for (const t of scan.trace.slice(0, shown)) for (let l = t.line; l <= t.lastLine; l++) set.add(l);
    return set;
  }, [scan.trace, shown]);
  const ruled = useMemo(() => new Set(divergences.map((d) => d.line - 1)), [divergences]);
  const ruling = entry && divergences.find((d) => d.line - 1 === entry.line);
  const stage = live ? undefined : walkthrough[tab];

  return (
    <section className="sim stl-sim scl-sim" aria-label={label} data-ready={ready} data-sim="scl">
      <div className="scl-grid">
        <div className="stl-source">
          {walkthrough.length > 0 && (
            <div className="scl-tabs" role="tablist" aria-label="The listing, build step by build step">
              {[...walkthrough.map((w) => w.titleHtml), "The final listing, running"].map((title, i) => (
                <button
                  key={i}
                  type="button"
                  role="tab"
                  id={`${tabsId}-tab-${i}`}
                  aria-controls={`${tabsId}-panel`}
                  aria-selected={tab === i}
                  className="scl-tab note-button"
                  disabled={!ready}
                  onClick={() => setTab(i)}
                >
                  {i < walkthrough.length && <span className="field-label">Build {i + 1}</span>}
                  <span dangerouslySetInnerHTML={{ __html: title }} />
                </button>
              ))}
            </div>
          )}
          <div
            id={`${tabsId}-panel`}
            role={walkthrough.length > 0 ? "tabpanel" : undefined}
            aria-labelledby={walkthrough.length > 0 ? `${tabsId}-tab-${tab}` : undefined}
          >
            {stage ? (
              <>
                {stage.noteHtml && (
                  <p
                    className="scl-build-note text-body-small text-graphite"
                    dangerouslySetInnerHTML={{ __html: stage.noteHtml }}
                  />
                )}
                <StageListing lines={buildStage(lines, walkthrough, tab)} label={`${label}: build step ${tab + 1}`} />
                {stage.fragment && <Fragment code={stage.fragment} />}
              </>
            ) : (
              <Listing lines={lines} current={entry} ran={ran} ruled={ruled} label={`${label}: the listing`} />
            )}
          </div>
        </div>

        <div className="stl-controls scl-inputs">
          <InputKeys types={run.inputs} tune={tune} inputs={inputs} ready={ready} onChange={setInput} />
        </div>

        <div className="scl-bar">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="button-print-next note-button label-action"
              disabled={!ready}
              onClick={step}
            >
              Step
            </button>
            <button
              type="button"
              className="button-print note-button label-action"
              disabled={!ready}
              onClick={scanToEnd}
            >
              {done ? "Run a scan" : "Finish the scan"}
            </button>
            <button type="button" className="button-print note-button label-action" disabled={!ready} onClick={reset}>
              Reset
            </button>
          </div>
          <p className="font-quantity text-graphite tabular-nums stl-counter" aria-live="polite">
            Scan {scan.number} · statement {shown}
            {done ? <span className="text-pencil"> of {scan.trace.length}</span> : null}
            {pending ? <span className="text-muted"> · new inputs from the next scan</span> : null}
          </p>
          {scan.error && done && <p className="sim-warning stl-error">The CPU can't go on: {scan.error}</p>}
        </div>

        <div className="stl-state scl-state">
          <StatePanel entry={entry} rows={rows} ruling={ruling} />
          <Trace trace={scan.trace} shown={shown} ruled={ruled} />
        </div>
      </div>
    </section>
  );
}
