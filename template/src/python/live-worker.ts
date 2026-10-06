// The page's Python, in a module Web Worker so code that never finishes can't freeze the page:
// `live.ts` stops it by ending the worker. Pyodide comes from the site's own `/pyodide/`, started
// on the first run and kept for the next ones. One run at a time: `live.ts` sends the next only
// once this one has answered.
import type { PyodideAPI } from "pyodide";
import { runCode, type RunOutcome } from "./run.ts";

export interface LiveJob {
  id: number;
  /** Where Pyodide is served, as an absolute URL. */
  base: string;
  packages: string[];
  code: string;
}

export interface WorkerTiming {
  packagesMs: number;
  runMs: number;
  /** Bytes this run fetched from `base` over the network (0 when all came from the cache). */
  fetchedBytes: number;
}

export type LiveReply = { id: number; outcome: RunOutcome; timing: WorkerTiming } | { id: number; failed: string };

let started: Promise<PyodideAPI> | undefined;

/** Starts Pyodide from `base` (once); a failed start can be tried again. */
function start(base: string): Promise<PyodideAPI> {
  started ??= (async () => {
    const { loadPyodide } = (await import(/* @vite-ignore */ `${base}pyodide.mjs`)) as typeof import("pyodide");
    return loadPyodide({ indexURL: base, stdout: () => {}, stderr: () => {} });
  })().catch((error: unknown) => {
    started = undefined;
    throw error;
  });
  return started;
}

/** What the resource entries from `from` on fetched from `base` over the network. */
const fetchedSince = (from: number, base: string) =>
  performance
    .getEntriesByType("resource")
    .slice(from)
    .filter((e) => e.name.startsWith(base))
    .reduce((sum, e) => sum + ((e as PerformanceResourceTiming).transferSize || 0), 0);

self.onmessage = async ({ data: { id, base, packages, code } }: MessageEvent<LiveJob>) => {
  const reply = (message: LiveReply) => self.postMessage(message);
  const from = performance.getEntriesByType("resource").length;
  try {
    const py = await start(base);
    const t1 = performance.now();
    if (packages.length > 0) await py.loadPackage(packages, { messageCallback: () => {} });
    const t2 = performance.now();
    const outcome = await runCode(py, code);
    const t3 = performance.now();
    reply({ id, outcome, timing: { packagesMs: t2 - t1, runMs: t3 - t2, fetchedBytes: fetchedSince(from, base) } });
  } catch (error) {
    reply({ id, failed: error instanceof Error ? error.message : String(error) });
  }
};
