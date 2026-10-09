// What makes an SCL sim hold together before anything runs: the listing reads as SCL and has the
// FUNCTION_BLOCK a scan calls, the example's values set every input and fit its type, the watch
// table names variables the block has, each walkthrough step names lines of the listing (no two
// steps the same line), and each Divergence sits on a line a statement starts on. The content
// contract reports each problem.

import { fits, type S7Type } from "../s7/core.ts";
import { SclRun, type SclModel } from "./engine.ts";
import { ListingError, statementsIn } from "./parse.ts";

type Problem = { path: (string | number)[]; message: string };

export interface TuneRange {
  min: number;
  max: number;
  step: number;
}

/** The listing lines (0-based) a walkthrough step's `lines` names: `"1-12, 30"` (1-based, inclusive). */
export function walkthroughLines(lines: string): number[] | string {
  const out: number[] = [];
  for (const part of lines.split(",").map((p) => p.trim())) {
    const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part);
    if (!m) return `"${part}" isn't a line or a range of lines like 12-20`;
    const [from, to] = [Number(m[1]), Number(m[2] ?? m[1])];
    if (from < 1 || to < from) return `${part} isn't a range running from line 1 up`;
    for (let l = from; l <= to; l++) out.push(l - 1);
  }
  return out;
}

export function sclProblems(
  model: SclModel,
  start: Readonly<Record<string, number>> | undefined,
  tune: Readonly<Record<string, TuneRange>> | undefined,
  cases: readonly { name: string; scans: readonly Readonly<Record<string, number>>[] }[],
  walkthrough: readonly { lines: string }[] = [],
  divergences: readonly { line: number }[] = [],
): Problem[] {
  const problems: Problem[] = [];
  const add = (path: (string | number)[], message: string) => problems.push({ path, message });
  let run: SclRun;
  try {
    run = new SclRun(model);
  } catch (error) {
    if (!(error instanceof ListingError)) throw error;
    add(["model", "source"], error.message);
    return problems;
  }
  const inputs: Readonly<Record<string, S7Type>> = run.inputs;
  const watchable = run.watchable();
  if (model.watch.length === 0) add(["model", "watch"], "the watch table shows at least one variable");
  model.watch.forEach((path, i) => {
    if (!(path in watchable))
      add(
        ["model", "watch", i],
        `"${path}" isn't an elementary variable of ${model.block} or a DB (write an element as name[1,2].member)`,
      );
  });

  const checkValues = (path: (string | number)[], values: Readonly<Record<string, number>>) => {
    for (const [name, value] of Object.entries(values)) {
      const type = inputs[name];
      if (!type)
        add(
          [...path, name],
          `${name} isn't one of ${model.block}'s inputs (${Object.keys(inputs).join(", ") || "none"})`,
        );
      else if (!fits(type, value))
        add([...path, name], `${value} doesn't fit ${name}, ${/^[AEIOU]/.test(type) ? "an" : "a"} ${type}`);
    }
  };
  if (start) {
    checkValues(["start"], start);
    const missing = Object.keys(inputs).filter((name) => !(name in start));
    if (missing.length > 0) add(["start"], `the example's values set every input: ${missing.join(", ")} missing`);
  }
  for (const [name, range] of Object.entries(tune ?? {})) {
    const type = inputs[name];
    if (!type) add(["tune", name], `${name} isn't one of the inputs`);
    else if (!fits(type, range.min) || !fits(type, range.max)) add(["tune", name], `${name}'s range leaves ${type}`);
    else if (type !== "REAL" && !Number.isInteger(range.step))
      add(["tune", name], `${name} holds ${type === "INT" ? "an" : "a"} ${type}: its slider steps by whole numbers`);
    else {
      const steps = (range.max - range.min) / range.step;
      if (Math.abs(steps - Math.round(steps)) > 1e-9 * Math.max(1, steps))
        add(["tune", name], `${name}'s slider can't reach ${range.max} from ${range.min} in steps of ${range.step}`);
    }
  }
  cases.forEach((c, ci) => c.scans.forEach((scan, si) => checkValues(["cases", ci, "scans", si], scan)));

  const lineCount = run.unit.lines.length;
  const claimed = new Map<number, number>();
  walkthrough.forEach((step, i) => {
    const lines = walkthroughLines(step.lines);
    if (typeof lines === "string") {
      add(["walkthrough", i, "lines"], lines);
      return;
    }
    for (const l of lines) {
      if (l >= lineCount) {
        add(["walkthrough", i, "lines"], `the listing has ${lineCount} lines, not ${l + 1}`);
        return;
      }
      const other = claimed.get(l);
      if (other !== undefined) {
        add(["walkthrough", i, "lines"], `line ${l + 1} is already added by build step ${other + 1}`);
        return;
      }
      claimed.set(l, i);
    }
  });

  const statementLines = new Set<number>();
  // A FUNCTION's statements run inside its caller's step, so the trace can't stop on them: a ruling
  // is marked on a line of the scanned block's own body.
  for (const s of statementsIn(run.block.body)) statementLines.add(s.line);
  const ruled = new Set<number>();
  divergences.forEach((d, i) => {
    if (!statementLines.has(d.line - 1))
      add(
        ["divergences", i, "line"],
        `no statement of ${model.block} starts on line ${d.line}: a Divergence marks the line of the block it was ruled on`,
      );
    else if (ruled.has(d.line)) add(["divergences", i, "line"], `line ${d.line} already has a Divergence`);
    ruled.add(d.line);
  });
  return problems;
}
