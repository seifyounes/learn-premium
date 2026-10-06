// Pyodide for the page, imported only when the student taps Run live. Python runs in a Web Worker
// (`live-worker.ts`), loading from the site's own `/pyodide/`, one shared by every tool on the
// page, so the page stays responsive however long the code runs, and Stop ends the worker. Runs
// go one at a time: a second tool's run waits for the first's to answer. Each run reports how long
// each part took and what it fetched, for the Tool gallery's timing run on a real phone. Never
// imported with the page, so neither the loader nor the runtime is in the initial load.
import type { LiveJob, LiveReply } from "./live-worker.ts";
import type { RunOutcome } from "./run.ts";

export interface Timing {
  /** From the run's turn to Python ready: the loader, the runtime and the standard library. */
  startMs: number;
  /** Loading the tool's packages, once Python is ready. */
  packagesMs: number;
  runMs: number;
  /** Bytes this run fetched from `/pyodide/` over the network (0 when all came from the cache). */
  fetchedBytes: number;
}

/** `stopped`: the student stopped the run, so Python was ended and starts again on the next. */
export type LiveOutcome = (RunOutcome | { error: string; stopped: true; printout: string[] }) & { timing: Timing };

let worker: Worker | undefined;
/** Whether the worker's Python has started: a run on it has answered. */
let up = false;
let queue: Promise<unknown> = Promise.resolve();
let nextId = 0;

const noTiming = (startMs = 0): Timing => ({ startMs, packagesMs: 0, runMs: 0, fetchedBytes: 0 });

/** Whether the page's Python is running, so a run needn't start it (any tool may have stopped it). */
export const pythonStarted = () => up;

/** Ends the page's Python; the next run starts a fresh one. */
function endWorker() {
  worker?.terminate();
  worker = undefined;
  up = false;
}

const stopped = (startMs = 0): LiveOutcome => ({
  error: "Stopped. Python starts again on the next run.",
  stopped: true,
  printout: [],
  timing: noTiming(startMs),
});

function runOne(base: string, packages: readonly string[], code: string, signal?: AbortSignal): Promise<LiveOutcome> {
  if (signal?.aborted) return Promise.resolve(stopped());
  const w = (worker ??= new Worker(new URL("./live-worker.ts", import.meta.url), { type: "module" }));
  const id = ++nextId;
  const t0 = performance.now();
  return new Promise<LiveOutcome>((resolve, reject) => {
    const done = () => {
      w.removeEventListener("message", onMessage);
      w.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
    };
    const onMessage = ({ data }: MessageEvent<LiveReply>) => {
      if (data.id !== id) return;
      done();
      if ("failed" in data) return reject(new Error(data.failed));
      const { packagesMs, runMs, fetchedBytes } = data.timing;
      const startMs = Math.max(performance.now() - t0 - packagesMs - runMs, 0);
      if (worker === w) up = true;
      resolve({ ...data.outcome, timing: { startMs, packagesMs, runMs, fetchedBytes } });
    };
    const onError = (event: ErrorEvent) => {
      done();
      if (worker === w) endWorker();
      reject(new Error(event.message || "Python's worker failed"));
    };
    const onAbort = () => {
      done();
      if (worker === w) endWorker();
      resolve(stopped(performance.now() - t0));
    };
    w.addEventListener("message", onMessage);
    w.addEventListener("error", onError);
    signal?.addEventListener("abort", onAbort);
    w.postMessage({
      id,
      base: new URL(base, location.href).href,
      packages: [...packages],
      code,
    } satisfies LiveJob);
  });
}

/**
 * Starts Python if it isn't yet, loads `packages` and runs `code`, timing each part, once every
 * run asked for before it has answered. Aborting `signal` stops the run (or drops it if it hasn't
 * started) and answers `stopped`.
 */
export function runLive(
  base: string,
  packages: readonly string[],
  code: string,
  signal?: AbortSignal,
): Promise<LiveOutcome> {
  // Stopped before it was even asked for (while this module loaded): nothing to queue.
  if (signal?.aborted) return Promise.resolve(stopped());
  const run = queue.then(() => runOne(base, packages, code, signal));
  queue = run.catch(() => {});
  if (!signal) return run;
  // A run stopped while it waits its turn answers at once; its turn then passes straight on.
  const dropped = new Promise<LiveOutcome>((resolve) =>
    signal.addEventListener("abort", () => resolve(stopped()), { once: true }),
  );
  return Promise.race([run, dropped]);
}
