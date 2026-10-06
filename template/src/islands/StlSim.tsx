// The STL sim (an Agent-built sim): the Professor's listing running on the S7 core, a statement or
// a scan at a time. Students set the inputs (a switch, the transmitter's raw value) and read the
// trace: the accumulators, AR 1, the status word and what each statement wrote, beside the watch
// table. They never edit the listing. It opens on the Worked example's values, one scan run, and
// the engine is the one the build's stl gate holds to awlsim bit for bit.
//
// A listing with an instruction the interpreter lacks plays awlsim's own trace of the example's
// values instead (`replay`): the same view, stepping through precomputed scans, inputs fixed.
import { useEffect, useId, useMemo, useState } from "react";
import { fits, S7Memory, type S7Type } from "../sims/s7/core.ts";
import { StlRun, type Inputs, type StlModel, type TraceEntry } from "../sims/stl/engine.ts";
import { accumulatorTypes, describeWrites, watchRows, type ReplayScan } from "../sims/stl/view.ts";
import type { Range } from "../sims/tuning.ts";
import { Listing, Registers, Trace, WatchTable } from "./sim/stl-view.tsx";

interface Props {
  model: StlModel;
  /** The Worked example's values: the sim opens on them. */
  start: Inputs;
  tune: Record<string, Range>;
  /** What the sim is, for assistive tech. */
  label: string;
  /** A step-through: awlsim's trace of the example's values, for a listing the interpreter can't run. */
  replay?: ReplayScan[];
}

/** One scan as the page holds it: memory as it began, and every statement run so far. */
interface Scan {
  number: number;
  before: S7Memory;
  trace: TraceEntry[];
  /** The scan reached OB 1's block end. */
  done: boolean;
  /** Why the interpreter stopped, if it did. */
  error?: string;
}

/** Runs a whole scan with these inputs on the run, catching an error as the trace's last word. */
function runScan(run: StlRun, inputs: Inputs, number: number): Scan {
  run.begin(inputs);
  const scan: Scan = { number, before: run.cpu.mem.clone(), trace: [], done: false };
  try {
    while (!run.between) scan.trace.push(run.step());
    scan.done = true;
  } catch (error) {
    scan.error = (error as Error).message;
  }
  return scan;
}

/** Memory after `upTo` statements of the scan. */
function memoryAt(scan: Scan, upTo: number): S7Memory {
  const mem = scan.before.clone();
  for (const entry of scan.trace.slice(0, upTo + 1))
    for (const w of entry.writes) mem.areas[w.area][w.offset] = w.value;
  return mem;
}

const replayScan = (replay: ReplayScan[], index: number): Scan => {
  const r = replay[index] as ReplayScan;
  const before = new S7Memory();
  for (const [area, offset, value] of r.before) before.areas[area as "I" | "Q" | "M"][offset] = value;
  return { number: index + 1, before, trace: [], done: false };
};

/** The page's state: the run (live only), the scan on show, and the statement being read. */
interface View {
  run?: StlRun;
  scan: Scan;
  selected: number;
}

/** The example's values with one scan run, as the Worked example's sheet has them. */
function opening(model: StlModel, start: Inputs, replay: ReplayScan[] | undefined): View {
  if (replay) {
    const scan = { ...replayScan(replay, 0), trace: replay[0]?.trace ?? [], done: true };
    return { scan, selected: scan.trace.length - 1 };
  }
  const run = new StlRun(model);
  const scan = runScan(run, start, 1);
  return { run, scan, selected: scan.trace.length - 1 };
}

export default function StlSim({ model, start, tune, label, replay }: Props) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const lines = useMemo(() => model.source.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n"), [model.source]);
  const [inputs, setInputs] = useState<Inputs>(start);
  const [view, setView] = useState<View>(() => opening(model, start, replay));
  const [pending, setPending] = useState(false);
  const counterId = useId();

  /** The next statement: a new scan begins first if the last one ended. */
  const step = () => {
    const { run, scan } = view;
    setPending(false);
    if (replay) {
      const next = scan.done ? replayScan(replay, scan.number % replay.length) : scan;
      const all = replay[next.number - 1]?.trace ?? [];
      const trace = all.slice(0, next.trace.length + 1);
      setView({ scan: { ...next, trace, done: trace.length === all.length }, selected: trace.length - 1 });
      return;
    }
    if (!run) return;
    let current = scan;
    if (scan.done || scan.error) {
      run.begin(inputs);
      current = { number: scan.number + 1, before: run.cpu.mem.clone(), trace: [], done: false };
    }
    try {
      const trace = [...current.trace, run.step()];
      setView({ run, scan: { ...current, trace, done: run.between }, selected: trace.length - 1 });
    } catch (error) {
      setView({ run, scan: { ...current, error: (error as Error).message }, selected: current.trace.length - 1 });
    }
  };

  /** The rest of this scan, or a whole new one if it ended. */
  const scanToEnd = () => {
    const { run, scan } = view;
    setPending(false);
    if (replay) {
      const next = scan.done ? replayScan(replay, scan.number % replay.length) : scan;
      const trace = replay[next.number - 1]?.trace ?? [];
      setView({ scan: { ...next, trace, done: true }, selected: trace.length - 1 });
      return;
    }
    if (!run) return;
    if (scan.done || scan.error) {
      const fresh = runScan(run, inputs, scan.number + 1);
      setView({ run, scan: fresh, selected: fresh.trace.length - 1 });
      return;
    }
    const trace = [...scan.trace];
    let error: string | undefined;
    try {
      while (!run.between) trace.push(run.step());
    } catch (e) {
      error = (e as Error).message;
    }
    setView({
      run,
      scan: { ...scan, trace, done: error === undefined, ...(error === undefined ? {} : { error }) },
      selected: trace.length - 1,
    });
  };

  /** A cold start: memory cleared, the inputs back at the example's values, one scan run. */
  const reset = () => {
    setInputs(start);
    setPending(false);
    setView(opening(model, start, replay));
  };

  const setInput = (operand: string, value: number) => {
    const type = model.inputs[operand];
    if (type === undefined || !Number.isFinite(value) || !fits(type, value)) return;
    setInputs((current) => ({ ...current, [operand]: value }));
    setPending(true);
  };

  const { scan, selected } = view;
  const entry = scan.trace[selected];
  const mem = useMemo(() => memoryAt(scan, selected), [scan, selected]);
  const rows = useMemo(() => watchRows(mem, model, entry?.writes), [mem, model, entry]);
  const ran = useMemo(() => {
    const set = new Set<number>();
    for (const t of scan.trace) for (let l = t.line; l <= t.lastLine; l++) set.add(l);
    return set;
  }, [scan.trace]);
  const written = entry ? describeWrites(entry.writes) : [];
  const types = useMemo(() => accumulatorTypes(scan.trace, model), [scan.trace, model]);

  return (
    <section className="sim stl-sim" aria-label={label} data-ready={ready} data-sim={replay ? "stl-replay" : "stl"}>
      <div className="stl-grid">
        <div className="stl-source">
          <Listing lines={lines} current={entry} ran={ran} label={`${label}: the listing`} />
        </div>

        <div className="stl-controls">
          {replay ? (
            <p className="sim-readout">
              The inputs stay at the example's values: a step-through plays the oracle's scans, it doesn't run them.
            </p>
          ) : (
            <InputKeys model={model} tune={tune} inputs={inputs} ready={ready} onChange={setInput} />
          )}
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
              {scan.done || scan.error ? "Run a scan" : "Finish the scan"}
            </button>
            <button type="button" className="button-print note-button label-action" disabled={!ready} onClick={reset}>
              Reset
            </button>
          </div>
          <p id={counterId} className="font-quantity text-graphite tabular-nums stl-counter" aria-live="polite">
            Scan {scan.number} · statement {entry ? selected + 1 : 0}
            {scan.done ? <span className="text-pencil"> of {scan.trace.length}</span> : null}
            {pending && !replay ? <span className="text-muted"> · new inputs from the next scan</span> : null}
          </p>
          {scan.error && <p className="sim-warning stl-error">The CPU can't go on: {scan.error}</p>}
        </div>

        <div className="stl-state">
          <div className="stl-statement">
            <span className="field-label">Statement</span>
            <span className="font-quantity text-graphite">
              {entry ? `${entry.line + 1}  ${[entry.op, entry.text].filter(Boolean).join(" ")}` : "-"}
            </span>
          </div>
          <Registers entry={entry} types={types[selected] ?? { accu1: "INT", accu2: "INT" }} />
          <div className="stl-written">
            <span className="field-label">Written</span>
            <span className="font-quantity text-graphite tabular-nums">
              {written.length ? written.join(", ") : "nothing"}
            </span>
          </div>
          <WatchTable rows={rows} />
          <Trace trace={scan.trace} types={types} />
        </div>
      </div>
    </section>
  );
}

interface InputKeysProps {
  model: StlModel;
  tune: Record<string, Range>;
  inputs: Inputs;
  ready: boolean;
  onChange(operand: string, value: number): void;
}

/** A key for each BOOL a student sets, and a slider with its value for each number. */
function InputKeys({ model, tune, inputs, ready, onChange }: InputKeysProps) {
  const tuned = Object.entries(model.inputs).filter(([operand]) => tune[operand] !== undefined);
  const bits = tuned.filter(([, type]) => type === "BOOL");
  const numbers = tuned.filter(([, type]) => type !== "BOOL");
  return (
    <div className="stl-inputs">
      {bits.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {bits.map(([operand]) => (
            <button
              key={operand}
              type="button"
              className="button-print note-button logic-input"
              aria-pressed={inputs[operand] === 1}
              disabled={!ready}
              onClick={() => onChange(operand, inputs[operand] === 1 ? 0 : 1)}
            >
              <span className="font-quantity">{operand}</span>
              <span className="font-quantity font-semibold tabular-nums">{inputs[operand] ?? 0}</span>
            </button>
          ))}
        </div>
      )}
      {numbers.map(([operand, type]) => (
        <NumberInput
          key={operand}
          operand={operand}
          type={type}
          range={tune[operand] as Range}
          value={inputs[operand] ?? 0}
          ready={ready}
          onChange={(v) => onChange(operand, v)}
        />
      ))}
    </div>
  );
}

function NumberInput(props: {
  operand: string;
  type: S7Type;
  range: Range;
  value: number;
  ready: boolean;
  onChange(v: number): void;
}) {
  const { operand, type, range, value, ready, onChange } = props;
  const id = useId();
  // What is typed stays as typed; a value the operand can hold, inside the range, is taken.
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const take = (text: string) => {
    setDraft(text);
    const v = Number(text);
    if (text.trim() !== "" && Number.isFinite(v) && v >= range.min && v <= range.max && fits(type, v)) onChange(v);
  };
  return (
    <div className="sim-slider">
      <div className="sim-slider-head">
        <label htmlFor={id} className="font-quantity">
          {operand} <span className="text-pencil">({type})</span>
        </label>
        <input
          type="text"
          inputMode={type === "REAL" ? "decimal" : "numeric"}
          className="stl-number-input font-quantity tabular-nums"
          aria-label={`${operand}, typed`}
          value={draft ?? String(value)}
          disabled={!ready}
          onChange={(event) => take(event.currentTarget.value)}
          onBlur={() => setDraft(undefined)}
        />
      </div>
      <input
        id={id}
        type="range"
        min={range.min}
        max={range.max}
        step={range.step}
        value={value}
        disabled={!ready}
        onChange={(event) => {
          setDraft(undefined);
          onChange(Number(event.currentTarget.value));
        }}
      />
    </div>
  );
}
