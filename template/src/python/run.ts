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

/** Printed text as the lines it shows, the last one kept even without its newline. */
const linesOf = (text: string) => (text === "" ? [] : text.replace(/\n$/, "").split("\n"));

/**
 * Runs `code` as a script (`__name__` is `"__main__"`) in a fresh namespace. Everything it printed
 * comes back, flushed, even a last line with no newline, so none of it is left for the next run.
 */
export async function runCode(py: PyodideAPI, code: string): Promise<RunOutcome> {
  let text = "";
  const decoder = new TextDecoder();
  const write = (bytes: Uint8Array) => {
    text += decoder.decode(bytes, { stream: true });
    return bytes.length;
  };
  py.setStdout({ write });
  py.setStderr({ write });
  const printout = () => {
    const sys = py.pyimport("sys");
    try {
      sys.stdout.flush();
      sys.stderr.flush();
    } finally {
      sys.destroy();
    }
    return linesOf(text + decoder.decode());
  };
  const globals = py.globals.get("dict")();
  globals.set("__name__", "__main__");
  try {
    const last: unknown = await py.runPythonAsync(code, { globals });
    // The value of a last expression (a NumPy array, say) is a proxy holding WASM memory.
    if (last instanceof py.ffi.PyProxy) last.destroy();
    if (!globals.has("plot"))
      return { error: "the code leaves no plot: end it by setting plot = [...]", printout: printout() };
    const plot: unknown = JSON.parse(py.runPython(DUMP, { globals }) as string);
    return { plot, printout: printout() };
  } catch (error) {
    return { error: tracebackOf(error), traceback: true, printout: printout() };
  } finally {
    globals.destroy();
  }
}
