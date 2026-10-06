// The build-time preview of a Pyodide tool: its code run in Node, on the same Pyodide and the same
// package files the page downloads, so the opening state the student sees is what a live run
// gives. Each run happens in a worker thread holding a Pyodide that loaded exactly the tool's
// packages (one per package set, reused by the tools that name the same set), runs go one at a
// time, and each tool's code is run once however many pages show it. A run still going at the
// deadline is stopped, and fails its tool.
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { coreDir, coursePackages } from "./download.ts";
import type { PreviewJob, PreviewReply } from "./preview-worker.ts";
import type { RunOutcome } from "./run.ts";

/** How long a tool's code may run at build: a preview that takes longer has no place on a phone. */
export const PREVIEW_DEADLINE_MS = 30_000;

/**
 * The worker's source in the template. The build bundles this module away from its siblings, so
 * it is found from the template's pinned Pyodide, which sits in the template's `node_modules`.
 */
const workerPath = () => join(coreDir(), "..", "..", "src", "python", "preview-worker.ts");

const workers = new Map<string, Worker>();
const runs = new Map<string, Promise<RunOutcome>>();
let queue: Promise<unknown> = Promise.resolve();
let nextId = 0;

/** The Pyodide that loaded exactly `packages` for this Course, started on first use. */
function workerFor(contentDir: string, packages: readonly string[]): { worker: Worker; drop: () => void } {
  const key = JSON.stringify([contentDir, [...packages].sort()]);
  let worker = workers.get(key);
  if (!worker) {
    worker = new Worker(workerPath(), { workerData: { contentDir, packages: [...packages] } });
    workers.set(key, worker);
  }
  const it = worker;
  return {
    worker: it,
    drop: () => {
      if (workers.get(key) === it) workers.delete(key);
      void it.terminate();
    },
  };
}

/** One run on its worker: the outcome, or a throw when it can't run or is still going at the deadline. */
function runOn(contentDir: string, packages: readonly string[], code: string, deadlineMs: number): Promise<RunOutcome> {
  const { worker, drop } = workerFor(contentDir, packages);
  const id = ++nextId;
  return new Promise<RunOutcome>((resolve, reject) => {
    let deadline: NodeJS.Timeout | undefined;
    const settle = () => {
      clearTimeout(deadline);
      worker.off("message", onMessage).off("error", onError).off("exit", onExit);
      // An idle worker doesn't hold the build open.
      worker.unref();
    };
    const onMessage = (reply: PreviewReply) => {
      if (reply.id !== id) return;
      if ("running" in reply) {
        deadline = setTimeout(() => {
          settle();
          drop();
          reject(
            new Error(
              `the code was still running ${deadlineMs / 1000} s after it started, so it has no preview: look for a loop that never ends, or an await that never settles`,
            ),
          );
        }, deadlineMs);
        return;
      }
      settle();
      if ("failed" in reply) reject(new Error(reply.failed));
      else resolve(reply.outcome);
    };
    const onError = (error: Error) => {
      settle();
      drop();
      reject(error);
    };
    const onExit = (code: number) => {
      settle();
      drop();
      reject(new Error(`the preview's Python stopped (exit code ${code}) before the code finished`));
    };
    worker.on("message", onMessage).on("error", onError).on("exit", onExit);
    worker.ref();
    worker.postMessage({ id, code } satisfies PreviewJob);
  });
}

/**
 * Runs a tool's code at build. Its packages must be in the Course's `pyodide/` folder, and every
 * Pyodide package it imports must be one it names; either failing throws, as does code still
 * running `deadlineMs` after it started.
 */
export function previewRun(
  contentDir: string,
  packages: readonly string[],
  code: string,
  { deadlineMs = PREVIEW_DEADLINE_MS }: { deadlineMs?: number } = {},
): Promise<RunOutcome> {
  const key = JSON.stringify([contentDir, packages, code]);
  let run = runs.get(key);
  if (!run) {
    coursePackages(contentDir, packages);
    run = queue.then(() => runOn(contentDir, packages, code, deadlineMs));
    queue = run.catch(() => {});
    runs.set(key, run);
  }
  return run;
}
