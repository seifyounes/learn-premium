// A Pyodide tool: real Python, opening on its preview (the plot and printout its code gave at
// build) beside a printed Run-live button that says what the tap downloads. Python loads only on
// that tap, from the site's own /pyodide/, then runs the code as the student edits it and redraws
// the plot in the pad's inks. Nothing about Pyodide is imported until then. Python runs off the
// page's thread, so code that never finishes leaves the page working, and Stop ends it.
import { MotionConfig, useReducedMotion } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";
import { readPlot } from "../python/plot.ts";
import type { Timing } from "../python/live.ts";
import { sizeLabel } from "../python/lock.ts";
import { atRest, type FigureData } from "../worked/sheet.ts";
import { PlotFigure } from "./worked/PlotFigure.tsx";

interface Props {
  /** The figure, drawn with the preview's elements. */
  figure: FigureData;
  /** Labels for the plot's elements by id, rendered. */
  labels: Record<string, string>;
  code: string;
  packages: string[];
  /** What the code printed at build. */
  printout: string[];
  /** Where Pyodide is served, e.g. `/pyodide/`. */
  base: string;
  /** The tap's download, in bytes. */
  bytes: number;
  /** What the tool is, for assistive tech. */
  label: string;
  /** Show each part of a live run's time and what it fetched: the Tool gallery's timing run. */
  timing?: boolean;
}

type Phase = "preview" | "loading" | "running" | "live" | "error" | "stopped";

const STOPPED = "Stopped. Python starts again on the next run.";

const seconds = (ms: number) => (ms / 1000).toFixed(1);
const megabytes = (bytes: number) => (bytes / 1_000_000).toFixed(1);

export default function PythonTool({ figure, labels, code, packages, printout, base, bytes, label, timing }: Props) {
  const reduced = useReducedMotion() ?? false;
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState<Phase>("preview");
  const [started, setStarted] = useState(false);
  const [source, setSource] = useState(code);
  const [shown, setShown] = useState({ elements: figure.elements, printout, epoch: 0 });
  /** What went wrong: Python's traceback (code, set in mono), or a sentence saying so. */
  const [error, setError] = useState<{ text: string; traceback: boolean }>();
  const [took, setTook] = useState<Timing>();
  /** Stops the run in flight: Python runs off the page's thread, so the page can always ask. */
  const stop = useRef<AbortController>(undefined);
  const captionId = useId();
  const codeId = useId();
  useEffect(() => setReady(true), []);

  const drawn: FigureData = { ...figure, elements: shown.elements, question: shown.elements.map((e) => e.id) };
  // A live run draws its plot in; the preview is on the sheet from the start.
  const animate = shown.epoch > 0 && !reduced;
  const state = { ...atRest(drawn), added: animate ? shown.elements.map((e) => e.id) : [] };
  const busy = phase === "loading" || phase === "running";
  const size = sizeLabel(bytes);

  function fail(text: string, traceback: boolean, printed?: string[], to: Phase = "error") {
    if (printed) setShown((s) => ({ ...s, printout: printed }));
    setError({ text, traceback });
    setPhase(to);
  }

  async function run() {
    setPhase(started ? "running" : "loading");
    setError(undefined);
    const controller = new AbortController();
    stop.current = controller;
    // Stopping ended Python, with its output: the next run starts it again, from the start.
    const stopped = (printed: string[] = []) => {
      setStarted(false);
      setTook(undefined);
      fail(STOPPED, false, printed, "stopped");
    };
    const aborted = new Promise<"stopped">((resolve) =>
      controller.signal.addEventListener("abort", () => resolve("stopped"), { once: true }),
    );
    // A run stopped while this module downloads never awaits it: its failure is then no one's to report.
    const loading = import("../python/live.ts");
    loading.catch(() => {});
    try {
      const live = await Promise.race([loading, aborted]);
      if (live === "stopped") return stopped();
      // Python may have been stopped since this tool last ran (by any tool on the page).
      setPhase(live.pythonStarted() ? "running" : "loading");
      const outcome = await live.runLive(base, packages, source, controller.signal);
      if ("stopped" in outcome) return stopped(outcome.printout);
      setStarted(true);
      setTook(outcome.timing);
      if ("error" in outcome) return fail(outcome.error, outcome.traceback === true, outcome.printout);
      const elements = readPlot(outcome.plot, labels);
      if (typeof elements === "string") return fail(elements, false, outcome.printout);
      setShown((s) => ({ elements, printout: outcome.printout, epoch: s.epoch + 1 }));
      setPhase("live");
    } catch (failure) {
      fail(`Python didn't load: ${failure instanceof Error ? failure.message : String(failure)}`, false);
    } finally {
      if (stop.current === controller) stop.current = undefined;
    }
  }

  return (
    <MotionConfig reducedMotion="user">
      <section
        className="python-tool"
        aria-label={label}
        data-ready={ready}
        data-python-tool={packages.join(" ")}
        data-state={phase}
      >
        <div className="python-grid">
          <div className="python-figure" data-python-preview={phase === "preview" ? "" : undefined}>
            <PlotFigure
              figure={drawn}
              shown={{ state, hidden: false, animate, epoch: shown.epoch }}
              captionId={captionId}
            />
          </div>
          <div className="python-work">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="button-print-next note-button label-action"
                disabled={!ready || busy}
                onClick={run}
                data-run-live={bytes}
              >
                {phase === "loading" ? "Loading Python…" : started ? "Run again" : `Run live · ${size}`}
              </button>
              {busy ? (
                <button
                  type="button"
                  className="button-print note-button label-action"
                  onClick={() => stop.current?.abort()}
                >
                  Stop
                </button>
              ) : (
                <button
                  type="button"
                  className="button-print note-button label-action"
                  disabled={!ready || source === code}
                  onClick={() => setSource(code)}
                >
                  Reset code
                </button>
              )}
            </div>
            <p className="python-status text-body-small text-muted" aria-live="polite">
              {phase === "preview" && (
                <>
                  The plot and output the code gave at build. Run live downloads Python (
                  <span className="font-quantity tabular-nums">{size}</span>) and runs the code as you edit it.
                </>
              )}
              {phase === "loading" && (
                <>
                  Downloading Python, <span className="font-quantity tabular-nums">{size}</span>…
                </>
              )}
              {phase === "running" && "Running…"}
              {took && !busy && (timing ? <TimingLine took={took} /> : <RanIn ms={took.runMs} />)}
            </p>
            {error &&
              (error.traceback ? (
                <pre className="python-error" role="alert" dir="ltr">
                  {error.text}
                </pre>
              ) : (
                <p className="python-error-note text-body-small" role="alert">
                  {error.text}
                </p>
              ))}
            {shown.printout.length > 0 && (
              <div className="python-output">
                <span className="field-label">Output</span>
                <pre dir="ltr">{shown.printout.join("\n")}</pre>
              </div>
            )}
            <label htmlFor={codeId} className="field-label">
              Code
            </label>
            <textarea
              id={codeId}
              className="python-code"
              dir="ltr"
              value={source}
              rows={Math.min(Math.max(source.split("\n").length, 6), 18)}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              wrap="off"
              disabled={!ready}
              onChange={(event) => setSource(event.target.value)}
            />
          </div>
        </div>
      </section>
    </MotionConfig>
  );
}

function RanIn({ ms }: { ms: number }) {
  return (
    <>
      {" "}
      Ran live in <span className="font-quantity tabular-nums">{seconds(ms)} s</span>.
    </>
  );
}

/** The timing run: each part of the tap's time, and what it fetched, for the real-phone pass. */
function TimingLine({ took }: { took: Timing }) {
  return (
    <span className="python-timing" data-timing={JSON.stringify(took)}>
      {" "}
      Python started in <span className="font-quantity tabular-nums">{seconds(took.startMs)} s</span>, packages loaded
      in <span className="font-quantity tabular-nums">{seconds(took.packagesMs)} s</span>, ran in{" "}
      <span className="font-quantity tabular-nums">{seconds(took.runMs)} s</span>; fetched{" "}
      <span className="font-quantity tabular-nums">{megabytes(took.fetchedBytes)} MB</span>.
    </span>
  );
}
