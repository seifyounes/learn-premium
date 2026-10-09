import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Tests copy whole courses and repos into the temp folder and never remove them, which filled the
// system drive. So each run gets a temp folder of its own (TEMP, TMP and TMPDIR point at it, for the
// tests and every program they start), removed when the run ends. LP_TEST_TMP sets where the runs'
// folders go; a killed run's folder is swept by a later run once it is a day old.
// LP_KEEP_TEST_TMP=1 keeps the folder, to look at what a failing test left.

const STALE_MS = 24 * 60 * 60 * 1000;

export default function setup(): () => void {
  const base = process.env["LP_TEST_TMP"] || join(tmpdir(), "lpt");
  mkdirSync(base, { recursive: true });
  sweepStale(base);
  const dir = join(base, `r-${Date.now().toString(36)}-${process.pid}`);
  mkdirSync(dir);
  for (const name of ["TEMP", "TMP", "TMPDIR"]) process.env[name] = dir;
  return () => {
    if (process.env["LP_KEEP_TEST_TMP"] !== "1") remove(dir);
  };
}

function sweepStale(base: string): void {
  for (const name of readdirSync(base)) {
    const path = join(base, name);
    if (name.startsWith("r-") && Date.now() - statSync(path).mtimeMs > STALE_MS) remove(path);
  }
}

function remove(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // A file still locked by a program the run started: a later run sweeps the folder.
  }
}
