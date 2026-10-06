// The gate runner: every gate plugs in here, and every gate point (per job, per Module, per
// deploy, and live: on the live URL once Vercel has deployed) runs through `runGates`. A gate has
// two outcomes on a finding, block or Checkpoint item; there is no warning level. A gate that
// didn't run, crashed or saw nothing counts as failed, except a content gate on a Course with no
// Modules yet: it passes, and the report says it had nothing to check.
//
// The run leaves a Gate report bound to the exact commit it checked. `verifyReport` is the only
// way to call a report green: it re-derives the verdict rather than trusting the report's own.
import { lstatSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "astro/zod";
import { spotOf } from "./spots.ts";

/**
 * `deploy` checks the build before it merges; `live` checks the live site after Vercel deploys it,
 * and a red `live` run rolls Vercel back (`deploy/`).
 */
export const GATE_POINTS = ["job", "module", "deploy", "live"] as const;
export type GatePoint = (typeof GATE_POINTS)[number];

const OUTCOMES = ["block", "checkpoint"] as const;
/** `block`: the job that made the problem fixes it. `checkpoint`: only the Owner can settle it. */
export type Outcome = (typeof OUTCOMES)[number];

export interface Finding {
  outcome: Outcome;
  message: string;
  /** Where it sits: `file:line[:column]` for content, a route for a rendered page. */
  at?: string;
}

/** What a gate is given to check. */
export interface GateInput {
  /** The Course's content folder. */
  contentDir: string;
  /** The built site, for gates that check rendered pages. */
  distDir?: string;
  /**
   * Where the same build is served (a Vercel preview), for the browser gates; they serve `distDir`
   * themselves when absent. The pages to open are still listed from `distDir`.
   */
  siteUrl?: string;
  /** Scope the check to one Module (its folder name); the whole Course when absent. */
  module?: string;
  /**
   * The Site template the site was built with, for the files the deploy gates read from it
   * (`vercel.json`, the committed `public/licences.txt`); the gates' own template when absent.
   */
  templateDir?: string;
}

export interface GateRun {
  /** What the gate looked at, by kind (files, pages, formulas…). All zero means it saw nothing. */
  coverage: Record<string, number>;
  findings: Finding[];
  /**
   * What the gate fixed on its own (the pad's contrast auto-fix), one line each. Never a finding:
   * listed so the Owner sees every change the build made.
   */
  fixes?: string[];
}

/**
 * Deliberately broken input the gate must catch: proof it can see what it claims to check. Most
 * defects must block; one only the Owner can settle (a sheet value the engine and the recompute
 * agree against) must raise a Checkpoint item, and blocking it is a miss too.
 */
export interface NegativeControl {
  defect: string;
  /** The outcome that catches it: `block` unless said otherwise. */
  expect?: Outcome;
  /** Builds the broken input from the good one, writing any files under `scratch`. */
  plant(good: GateInput, scratch: string): GateInput;
}

export interface Gate {
  id: string;
  /** One line: what the gate checks. */
  checks: string;
  points: readonly GatePoint[];
  run(input: GateInput): Promise<GateRun>;
  controls: readonly NegativeControl[];
}

const STATUSES = ["pass", "checkpoint", "block", "failed"] as const;
export type GateStatus = (typeof STATUSES)[number];
const GREEN_STATUSES: readonly GateStatus[] = ["pass", "checkpoint"];

const finding = z.strictObject({ outcome: z.enum(OUTCOMES), message: z.string(), at: z.string().optional() });

const gateResult = z.strictObject({
  id: z.string(),
  checks: z.string(),
  status: z.enum(STATUSES),
  coverage: z.record(z.string(), z.number()),
  findings: z.array(finding),
  fixes: z.array(z.string()).optional(),
  /** Why a `failed` gate didn't run. */
  error: z.string().optional(),
  /** Why a content gate passed covering nothing: the Course has no Modules yet. */
  nothingToCheck: z.string().optional(),
});
export type GateResult = z.infer<typeof gateResult>;

const gateReport = z.strictObject({
  report: z.literal("learn-premium gate report v1"),
  commit: z.string().min(1),
  /** Taken on uncommitted changes: bound to no commit, so never green. */
  dirty: z.boolean(),
  point: z.enum(GATE_POINTS),
  module: z.string().optional(),
  /** Where the gates opened the site (a Vercel preview, the live URL), when they were given one. */
  url: z.string().optional(),
  ranAt: z.string(),
  green: z.boolean(),
  gates: z.array(gateResult),
  /**
   * Every Checkpoint item the gates raised, for the Owner's batched Checkpoint. `spot` is the page
   * and anchor it shows at (`/01-slug/#worked-W01.1`), for a link to the exact place on the preview.
   */
  checkpointItems: z.array(finding.extend({ gate: z.string(), spot: z.string().optional() })),
});
export type GateReport = z.infer<typeof gateReport>;

export interface RunOptions {
  point: GatePoint;
  commit: string;
  dirty?: boolean;
  input: GateInput;
  gates: readonly Gate[];
}

export async function runGates({ point, commit, dirty = false, input, gates }: RunOptions): Promise<GateReport> {
  const results: GateResult[] = [];
  for (const gate of gatesAt(point, gates)) results.push(await runGate(gate, input));
  return {
    report: "learn-premium gate report v1",
    commit,
    dirty,
    point,
    ...(input.module === undefined ? {} : { module: input.module }),
    ...(input.siteUrl === undefined ? {} : { url: input.siteUrl }),
    ranAt: new Date().toISOString(),
    green: !dirty && results.length > 0 && results.every((r) => GREEN_STATUSES.includes(r.status)),
    gates: results,
    checkpointItems: results.flatMap((r) =>
      r.findings
        .filter((f) => f.outcome === "checkpoint")
        .map((f) => {
          const spot = spotOf(input.contentDir, f.at);
          return { gate: r.id, ...f, ...(spot === undefined ? {} : { spot }) };
        }),
    ),
  };
}

const gatesAt = (point: GatePoint, gates: readonly Gate[]) => gates.filter((g) => g.points.includes(point));

async function runGate(gate: Gate, input: GateInput): Promise<GateResult> {
  const base = { id: gate.id, checks: gate.checks };
  let run: GateRun;
  try {
    run = await gate.run(input);
  } catch (error) {
    return { ...base, status: "failed", coverage: {}, findings: [], error: messageOf(error) };
  }
  if (!Object.values(run.coverage).some((n) => n > 0)) {
    if (run.findings.length === 0 && gate.points.includes("job") && courseWithoutModules(input)) {
      return { ...base, status: "pass", ...run, nothingToCheck: "the Course has no Modules yet" };
    }
    return { ...base, status: "failed", ...run, error: "the gate covered nothing, so it can't pass" };
  }
  return { ...base, status: statusOf(run.findings), ...run };
}

/**
 * A whole-Course run on a Course with nothing under `modules/` yet: the one case where a content gate
 * (a per-job gate) may cover nothing and pass, so an empty Course project's deploy run is green. Any
 * entry under `modules/` but plain folders and intake's plain-file `modules/.gitkeep` counts as a
 * Module begun, and a folder without a plain-file course.yaml isn't a Course. A link anywhere here
 * (dangling, or out of the commit the report is bound to) or an unreadable entry never passes: the
 * gate fails, recorded in the report, rather than passing or crashing the run.
 */
function courseWithoutModules({ contentDir, module }: GateInput): boolean {
  if (module !== undefined) return false;
  const modules = join(contentDir, "modules");
  try {
    // lstat throughout: a link is never taken for an absent folder, a plain folder or a plain file.
    if (lstatSync(join(contentDir, "course.yaml"), { throwIfNoEntry: false })?.isFile() !== true) return false;
    const root = lstatSync(modules, { throwIfNoEntry: false });
    if (root === undefined) return true;
    if (!root.isDirectory()) return false;
    return readdirSync(modules, { recursive: true, encoding: "utf8" }).every((entry) => {
      const stat = lstatSync(join(modules, entry));
      return entry === ".gitkeep" ? stat.isFile() : stat.isDirectory();
    });
  } catch {
    return false;
  }
}

function statusOf(findings: readonly Finding[]): GateStatus {
  if (findings.some((f) => f.outcome === "block")) return "block";
  if (findings.length > 0) return "checkpoint";
  return "pass";
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export interface ExpectedReport {
  commit: string;
  point: GatePoint;
  module?: string;
  /** Every gate the point must have run; one missing from the report counts as failed. */
  gates: readonly Gate[];
}

/** Whether `report` proves `expected.commit` green at the gate point. Never trusts the report's own verdict. */
export function verifyReport(report: unknown, expected: ExpectedReport): { green: boolean; problems: string[] } {
  const parsed = gateReport.safeParse(report);
  if (!parsed.success) return { green: false, problems: [`not a Gate report: ${z.prettifyError(parsed.error)}`] };
  const checked = parsed.data;
  const problems: string[] = [];
  if (checked.commit !== expected.commit)
    problems.push(`the report checked commit ${checked.commit}, not ${expected.commit}`);
  if (checked.dirty) problems.push("the report was taken on uncommitted changes");
  if (checked.point !== expected.point)
    problems.push(`the report is for the ${checked.point} point, not ${expected.point}`);
  if (checked.module !== expected.module) {
    problems.push(
      `the report is for ${checked.module ?? "the whole Course"}, not ${expected.module ?? "the whole Course"}`,
    );
  }
  const expectedGates = gatesAt(expected.point, expected.gates);
  if (expectedGates.length === 0) problems.push(`no gate runs at the ${expected.point} point`);
  for (const gate of expectedGates) {
    const result = checked.gates.find((g) => g.id === gate.id);
    if (!result) problems.push(`gate "${gate.id}" did not run: failed`);
    else if (!GREEN_STATUSES.includes(result.status)) problems.push(`gate "${gate.id}": ${result.status}`);
  }
  return { green: problems.length === 0, problems };
}

export interface ControlResult {
  defect: string;
  expected: Outcome;
  status: GateStatus;
  /** The gate reached the expected outcome on the planted defect. Anything else, a crash included, is a miss. */
  caught: boolean;
  error?: string;
}

export interface ControlsResult {
  /** Every gate passed its positive fixture, has a negative control, and caught every one. */
  ok: boolean;
  gates: { id: string; positive: GateStatus; controls: ControlResult[] }[];
}

/** Runs every gate on the good input (its positive fixture) and on each of its negative controls. */
export async function runControls({
  input,
  gates,
}: {
  input: GateInput;
  gates: readonly Gate[];
}): Promise<ControlsResult> {
  const result: ControlsResult = { ok: true, gates: [] };
  for (const gate of gates) {
    const positive = (await runGate(gate, input)).status;
    const controls: ControlResult[] = [];
    for (const control of gate.controls) controls.push(await runControl(gate, control, input));
    const ok = positive === "pass" && controls.length > 0 && controls.every((c) => c.caught);
    result.ok &&= ok;
    result.gates.push({ id: gate.id, positive, controls });
  }
  return result;
}

async function runControl(gate: Gate, control: NegativeControl, good: GateInput): Promise<ControlResult> {
  const scratch = mkdtempSync(join(tmpdir(), `lp-control-${gate.id}-`));
  const expected = control.expect ?? "block";
  try {
    const broken = control.plant(good, scratch);
    const result = await runGate(gate, broken);
    return {
      defect: control.defect,
      expected,
      status: result.status,
      caught: result.status === expected,
      ...(result.error === undefined ? {} : { error: result.error }),
    };
  } catch (error) {
    return { defect: control.defect, expected, status: "failed", caught: false, error: messageOf(error) };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
