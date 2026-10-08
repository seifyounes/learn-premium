// What the SCL sim's page shows, worked out apart from the page: values as a STEP 7 watch table
// prints them, the watch table after any statement of a scan, what a statement wrote, and the
// listing as it stood at each build step of a walkthrough. Pure, so it is tested in Node.

import { formatValue, toPattern } from "../s7/core.ts";
import type { Leaf, SclWrite, TraceEntry } from "./engine.ts";
import { walkthroughLines } from "./validate.ts";

/** A value as a watch table prints it: TRUE/FALSE, `-5`, `L#70000`, `97.65625` (shortest float32), `W#16#00FF`. */
export function formatLeaf(leaf: Leaf): string {
  if (leaf.type === "BOOL") return leaf.value ? "TRUE" : "FALSE";
  return formatValue(leaf.type, toPattern(leaf.type, leaf.value));
}

/** Every value after statement `upTo` of a scan (−1: as the scan began), from the values it began with. */
export function valuesAt(
  before: Readonly<Record<string, Leaf>>,
  trace: readonly TraceEntry[],
  upTo: number,
): Record<string, Leaf> {
  const values = { ...before };
  for (const entry of trace.slice(0, upTo + 1))
    for (const w of entry.writes) values[w.path] = { type: w.type, value: w.after };
  return values;
}

export interface WatchRow {
  path: string;
  value: string;
  /** The statement being read wrote it. */
  written: boolean;
}

/** The watch table: each path's value now, the ones the statement being read wrote marked. */
export function watchRows(
  paths: readonly string[],
  values: Readonly<Record<string, Leaf>>,
  entry: TraceEntry | undefined,
): WatchRow[] {
  const written = new Set(entry?.writes.map((w) => w.path));
  return paths.map((path) => {
    const leaf = values[path];
    return { path, value: leaf ? formatLeaf(leaf) : "-", written: written.has(path) };
  });
}

/** What a statement wrote, as assignments: `fill_pct := 97.65625`. */
export const describeWrites = (writes: readonly SclWrite[]) =>
  writes.map((w) => `${w.path} := ${formatLeaf({ type: w.type, value: w.after })}`);

/** One line of the listing as a build step shows it. */
export interface StageLine {
  /** Its line in the final listing (0-based). */
  line: number;
  text: string;
  /** This build step added it. */
  added: boolean;
}

/**
 * The listing as it stood after build step `k` of a walkthrough: the lines steps 1 to k added, and
 * the lines no step names (the frame every slide shows), the step's own lines marked.
 */
export function buildStage(lines: readonly string[], steps: readonly { lines: string }[], k: number): StageLine[] {
  const stepOf = new Map<number, number>();
  steps.forEach((s, i) => {
    const named = walkthroughLines(s.lines);
    if (typeof named !== "string") for (const l of named) stepOf.set(l, i);
  });
  return lines.flatMap((text, line) => {
    const step = stepOf.get(line);
    if (step !== undefined && step > k) return [];
    return [{ line, text, added: step === k }];
  });
}
