// What a red live run does: roll Vercel's production back to the last green deployment (the newest
// earlier production deployment whose commit passed the live gates), and write the Owner's report.
import { setTimeout as sleep } from "node:timers/promises";
import type { GateReport } from "../gates/runner.ts";
import { VercelError, type Deployment, type Vercel } from "./vercel.ts";

export type RollbackOutcome =
  | { kind: "rolled-back"; failed: Deployment | undefined; target: Deployment; skipped: Deployment[] }
  | { kind: "no-green"; failed: Deployment | undefined; skipped: Deployment[] }
  | { kind: "refused"; failed: Deployment | undefined; target: Deployment; skipped: Deployment[]; error: string }
  /** Vercel took the request, but production never moved to the target. */
  | { kind: "unconfirmed"; failed: Deployment | undefined; target: Deployment; skipped: Deployment[]; error: string };

/** Production moved to another deployment before the rollback was asked for, so nothing was. */
export interface Superseded {
  kind: "superseded";
  current: string | undefined;
}

export interface RollbackDeps {
  vercel: Pick<Vercel, "productionDeployments" | "rollBack" | "production">;
  /** Whether the live gates passed on a commit. */
  passedLiveGates(sha: string): Promise<boolean>;
  /**
   * The deployment the live gates failed. Production is checked against it right before the
   * rollback is asked for, so a newer deployment promoted meanwhile is never rolled back.
   */
  failing: string;
  /** How to wait between checks that the rollback landed; tests pass one that doesn't. */
  wait?: (ms: number) => Promise<void>;
}

/** Vercel rolls back asynchronously: how long to watch for production to move before saying so. */
const CONFIRM_EVERY_MS = 10_000;
const CONFIRM_TRIES = 18;

/** Rolls production back from the deployment of `failedSha` to the last green one before it. */
export async function rollBackFrom(
  failedSha: string,
  why: string,
  deps: RollbackDeps,
): Promise<RollbackOutcome | Superseded> {
  const deployments = await deps.vercel.productionDeployments({ limit: 50 });
  const failed = deployments.find((d) => d.sha === failedSha);
  const before = failed?.created ?? Infinity;
  const skipped: Deployment[] = [];
  for (const candidate of deployments) {
    if (candidate.created >= before || candidate.sha === failedSha) continue;
    if (candidate.readyState !== "READY" || candidate.isRollbackCandidate === false) continue;
    if (candidate.sha === undefined || !(await deps.passedLiveGates(candidate.sha))) {
      skipped.push(candidate);
      continue;
    }
    const { current } = await deps.vercel.production();
    if (current !== deps.failing) return { kind: "superseded", current };
    try {
      await deps.vercel.rollBack(candidate.uid, why);
    } catch (error) {
      if (!(error instanceof VercelError)) throw error;
      return { kind: "refused", failed, target: candidate, skipped, error: error.message };
    }
    const problem = await landed(candidate.uid, deps);
    return problem === undefined
      ? { kind: "rolled-back", failed, target: candidate, skipped }
      : { kind: "unconfirmed", failed, target: candidate, skipped, error: problem };
  }
  return { kind: "no-green", failed, skipped };
}

/** Undefined once production serves `target`; otherwise why it doesn't. */
async function landed(target: string, { vercel, wait = sleep }: RollbackDeps): Promise<string | undefined> {
  let state = await vercel.production();
  for (let tries = 1; state.current !== target; tries++) {
    if (state.lastRequest?.to === target && state.lastRequest.status === "failed")
      return "Vercel's rollback job failed";
    if (tries >= CONFIRM_TRIES)
      return `production still served ${state.current ?? "an unknown deployment"} ${(CONFIRM_TRIES * CONFIRM_EVERY_MS) / 1000}s later`;
    await wait(CONFIRM_EVERY_MS);
    state = await vercel.production();
  }
  return undefined;
}

export interface OwnerReport {
  title: string;
  body: string;
}

const short = (sha: string | undefined) => (sha === undefined ? "an unknown commit" : sha.slice(0, 7));
const named = (d: Deployment) => `${short(d.sha)} (\`${d.uid}\`, https://${d.url})`;

/** The issue the Owner gets for a red live run: what failed, and what the rollback did. */
export function ownerReport({
  sha,
  liveUrl,
  report,
  outcome,
  drill,
  runUrl,
}: {
  sha: string;
  liveUrl: string;
  report: GateReport | undefined;
  outcome: RollbackOutcome;
  drill: boolean;
  runUrl?: string;
}): OwnerReport {
  const rolled = outcome.kind === "rolled-back" ? `rolled back to ${short(outcome.target.sha)}` : "NOT rolled back";
  const title = `${drill ? "Drill: " : ""}live deploy of ${short(sha)} failed, ${rolled}`;

  const failures: string[] = [];
  if (drill) failures.push("- A forced failure (the rollback drill): the live gates' verdict was set to red by hand.");
  for (const gate of report?.gates ?? []) {
    if (gate.status === "pass" || gate.status === "checkpoint") continue;
    if (gate.error !== undefined) failures.push(`- \`${gate.id}\` ${gate.status}: ${gate.error}`);
    for (const f of gate.findings.filter((x) => x.outcome === "block").slice(0, 20))
      failures.push(`- \`${gate.id}\`${f.at === undefined ? "" : ` at \`${f.at}\``}: ${f.message}`);
  }
  if (failures.length === 0 && !drill) failures.push("- The live gates didn't produce a report (see the run).");

  const skipped =
    outcome.skipped.length === 0
      ? []
      : ["", `Skipped, not green: ${outcome.skipped.map((d) => short(d.sha)).join(", ")}.`];
  const what = (() => {
    switch (outcome.kind) {
      case "rolled-back":
        return [
          `Production now serves ${named(outcome.target)}, the last deployment that passed the live gates.`,
          "",
          "Vercel won't promote new pushes to `main` until the rollback is undone. Once the fix is deployed and",
          "green on its preview, promote it: **Undo Rollback** on the project's production tile, or",
          "`vercel promote <deployment>`.",
        ];
      case "refused":
        return [
          `Vercel refused to roll back to ${named(outcome.target)}: ${outcome.error}`,
          "",
          "On the Hobby plan Instant Rollback only goes back to the deployment just before the current one.",
          "Production still serves the failing deployment: promote the green one by hand (Vercel dashboard,",
          "Deployments, its menu, **Promote**; or `vercel promote <deployment>`), or fix forward.",
        ];
      case "unconfirmed":
        return [
          `Vercel accepted the rollback to ${named(outcome.target)}, but ${outcome.error}.`,
          "",
          "Production may still serve the failing deployment. Check the project's production tile, and",
          "promote the green deployment by hand if it didn't move (`vercel promote <deployment>`).",
        ];
      case "no-green":
        return [
          "No earlier production deployment passed the live gates, so there was nothing green to roll back to.",
          "Production still serves the failing deployment: fix forward.",
        ];
    }
  })();

  const body = [
    `The live gates on ${liveUrl} went red for ${sha}${outcome.failed ? ` (deployment \`${outcome.failed.uid}\`)` : ""}.`,
    "",
    "## What failed",
    "",
    ...failures,
    "",
    "## Rollback",
    "",
    ...what,
    ...skipped,
    ...(runUrl === undefined ? [] : ["", `Run: ${runUrl}`]),
    "",
  ].join("\n");
  return { title, body };
}
