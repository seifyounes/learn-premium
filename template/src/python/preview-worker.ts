// One Pyodide for the build's previews, in its own thread so a preview that never finishes can be
// stopped. It loads only the packages it was started with (`workerData`), so a preview run here
// sees the same packages the page loads for that tool, and none another tool loaded. Run from the
// template's source by `preview.ts`, never bundled.
import { parentPort, workerData } from "node:worker_threads";
import { sep } from "node:path";
import { loadPyodide } from "pyodide";
import { packageDir, readLock } from "./download.ts";
import { ownerOf, packageFiles } from "./lock.ts";
import { runCode, type RunOutcome } from "./run.ts";

export interface PreviewJob {
  id: number;
  code: string;
}

export type PreviewReply =
  | { id: number; running: true }
  | { id: number; outcome: RunOutcome }
  | { id: number; failed: string };

const { contentDir, packages } = workerData as { contentDir: string; packages: string[] };
const port = parentPort;
if (!port) throw new Error("preview-worker.ts runs as a worker thread of preview.ts");

const started = (async () => {
  const py = await loadPyodide({ packageBaseUrl: packageDir(contentDir) + sep, stdout: () => {}, stderr: () => {} });
  if (packages.length > 0) await py.loadPackage(packages, { messageCallback: () => {} });
  return py;
})();

/**
 * The Pyodide packages the code imports that the tool doesn't load, each as a sentence. The run
 * would fail on them anyway; this names the package and the fix.
 */
function undeclaredImports(py: Awaited<typeof started>, code: string): string[] {
  const lock = readLock();
  const loaded = new Set(packageFiles(lock, packages).map((p) => p.name));
  const found = py.pyodide_py.code.find_imports(code) as { toJs(): string[]; destroy(): void };
  const imports = found.toJs();
  found.destroy();
  return imports.flatMap((name) => {
    const owner = ownerOf(lock, name);
    return owner && !loaded.has(owner.name)
      ? [`the code imports ${name} from the Pyodide package "${owner.name}", which the tool doesn't name in packages`]
      : [];
  });
}

port.on("message", ({ id, code }: PreviewJob) => {
  const reply = (message: PreviewReply) => port.postMessage(message);
  void (async () => {
    try {
      const py = await started;
      const undeclared = undeclaredImports(py, code);
      if (undeclared.length > 0) return reply({ id, failed: undeclared.join("; ") });
      reply({ id, running: true });
      reply({ id, outcome: await runCode(py, code) });
    } catch (error) {
      reply({ id, failed: error instanceof Error ? error.message : String(error) });
    }
  })();
});
