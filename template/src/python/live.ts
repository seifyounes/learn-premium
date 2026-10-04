// Pyodide in the page, imported only when the student taps Run live: the self-hosted loader from
// the site's own `/pyodide/`, one Pyodide shared by every tool on the page, and how long each part
// took, for the Tool gallery's timing run on a real phone. Never imported with the page, so neither
// the loader nor the runtime is in the initial load.
import type { PyodideAPI } from "pyodide";
import { runCode, type RunOutcome } from "./run.ts";

export interface Timing {
  /** From the tap to Python ready: the loader, the runtime and the standard library. */
  startMs: number;
  /** Loading the tool's packages, once Python is ready. */
  packagesMs: number;
  runMs: number;
  /** Bytes the browser fetched from `/pyodide/` over the network (0 when all came from its cache). */
  fetchedBytes: number;
}

let started: Promise<PyodideAPI> | undefined;

/** Starts Pyodide from `base` (once per page); a failed start can be tried again. */
function start(base: string): Promise<PyodideAPI> {
  started ??= (async () => {
    const url = `${base}pyodide.mjs`;
    const { loadPyodide } = (await import(/* @vite-ignore */ url)) as typeof import("pyodide");
    return loadPyodide({ indexURL: base, stdout: () => {}, stderr: () => {} });
  })().catch((error: unknown) => {
    started = undefined;
    throw error;
  });
  return started;
}

const fetchedFrom = (base: string) =>
  performance
    .getEntriesByType("resource")
    .filter((e) => new URL(e.name, location.href).pathname.startsWith(base))
    .reduce((sum, e) => sum + ((e as PerformanceResourceTiming).transferSize || 0), 0);

/** Starts Python if it isn't yet, loads `packages` and runs `code`, timing each part. */
export async function runLive(
  base: string,
  packages: readonly string[],
  code: string,
): Promise<RunOutcome & { timing: Timing }> {
  const t0 = performance.now();
  const py = await start(base);
  const t1 = performance.now();
  if (packages.length > 0) await py.loadPackage([...packages], { messageCallback: () => {} });
  const t2 = performance.now();
  const outcome = await runCode(py, code);
  const t3 = performance.now();
  return {
    ...outcome,
    timing: { startMs: t1 - t0, packagesMs: t2 - t1, runMs: t3 - t2, fetchedBytes: fetchedFrom(base) },
  };
}
