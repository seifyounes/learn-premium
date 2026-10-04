// Runs a Pyodide tool's code once, the same way at build (Node, for the preview) and in the page
// (a live run): in a fresh namespace, with what it prints captured, and the `plot` it leaves read
// back as JSON. A Python error comes back as its traceback, never thrown.
import type { PyodideAPI } from "pyodide";

/** `traceback`: the error is Python's own traceback, not a sentence about the code's result. */
export type RunOutcome =
  { plot: unknown; printout: string[] } | { error: string; traceback?: boolean; printout: string[] };

/** `plot` as JSON: numpy arrays and scalars become lists and floats, and NaN or infinity refuse. */
const DUMP = `__import__("json").dumps(plot, allow_nan=False, default=lambda o: o.tolist() if hasattr(o, "tolist") else float(o))`;

/** The code's own frames of a Python traceback, without Pyodide's internals above them. */
export function tracebackOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const lines = message.trimEnd().split("\n");
  const own = lines.findIndex((line) => line.includes('File "<exec>"'));
  return own < 0 ? (lines.at(-1) ?? message) : ["Traceback (most recent call last):", ...lines.slice(own)].join("\n");
}

export async function runCode(py: PyodideAPI, code: string): Promise<RunOutcome> {
  const printout: string[] = [];
  const print = { batched: (line: string) => printout.push(line) };
  py.setStdout(print);
  py.setStderr(print);
  const globals = py.globals.get("dict")();
  try {
    await py.runPythonAsync(code, { globals });
    if (!globals.has("plot")) return { error: "the code leaves no plot: end it by setting plot = [...]", printout };
    return { plot: JSON.parse(py.runPython(DUMP, { globals }) as string), printout };
  } catch (error) {
    return { error: tracebackOf(error), traceback: true, printout };
  } finally {
    globals.destroy();
  }
}
