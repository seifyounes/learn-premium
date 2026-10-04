// The build-time preview of a Pyodide tool: its code run in Node, on the same Pyodide and the same
// package files the page downloads, so the opening state the student sees is what a live run
// gives. One Pyodide per build, runs one at a time, and each tool's code is run once however many
// pages show it.
import { loadPyodide, type PyodideAPI } from "pyodide";
import { sep } from "node:path";
import { coursePackages, packageDir, readLock } from "./download.ts";
import { ownerOf, packageFiles } from "./lock.ts";
import { runCode, type RunOutcome } from "./run.ts";

const started = new Map<string, Promise<PyodideAPI>>();
const runs = new Map<string, Promise<RunOutcome>>();
let queue: Promise<unknown> = Promise.resolve();

/** One Pyodide per Course, loading packages from the Course's own `pyodide/` folder. */
function pyodideFor(contentDir: string): Promise<PyodideAPI> {
  let py = started.get(contentDir);
  if (!py) {
    py = loadPyodide({ packageBaseUrl: packageDir(contentDir) + sep, stdout: () => {}, stderr: () => {} });
    started.set(contentDir, py);
  }
  return py;
}

/**
 * The Pyodide packages the code imports that the tool doesn't load. One Pyodide serves every tool
 * at build, so a package another tool loaded would let the preview pass while the page, which
 * loads only what the tool names (and sizes its button by), fails.
 */
function undeclaredImports(py: PyodideAPI, packages: readonly string[], code: string): string[] {
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

/**
 * Runs a tool's code at build. Its packages must be in the Course's `pyodide/` folder, and every
 * Pyodide package it imports must be one it names; either failing throws.
 */
export function previewRun(contentDir: string, packages: readonly string[], code: string): Promise<RunOutcome> {
  const key = JSON.stringify([contentDir, packages, code]);
  let run = runs.get(key);
  if (!run) {
    coursePackages(contentDir, packages);
    run = queue.then(async () => {
      const py = await pyodideFor(contentDir);
      const undeclared = undeclaredImports(py, packages, code);
      if (undeclared.length > 0) throw new Error(undeclared.join("; "));
      if (packages.length > 0) await py.loadPackage([...packages], { messageCallback: () => {} });
      return runCode(py, code);
    });
    queue = run.catch(() => {});
    runs.set(key, run);
  }
  return run;
}
