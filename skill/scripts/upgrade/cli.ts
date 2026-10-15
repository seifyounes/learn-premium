// The Upgrade wave's command interface: argv in, exit code and one JSON document out.
// Commands, flags and exit codes: README.md. Exit codes as the ledger's: 0 done; 1 a check found
// problems (not ready, a migration threw); 2 bad arguments or input; 3 refused (the lock, the ledger's
// state, the exam freeze, GitHub). The entry point (../upgrade.ts) adds 4 for internal errors.
import { resolve } from "node:path";
import { Args } from "../ledger/args.ts";
import { LedgerError } from "../ledger/file.ts";
import { nonEmpty, SchemaError } from "../ledger/schema.ts";
import { TrackerError, type Tracker } from "../gate-gap/tracker.ts";
import type { Verifier } from "../wave/wave.ts";
import { heldReason, localToday, planUpgrade } from "./plan.ts";
import { applyUpgrade, migrateUpgrade, startUpgrade, UpgradeProblem } from "./wave.ts";

export interface RunResult {
  code: number;
  stdout: string;
}

/** What the wave reaches outside the Course project through. Tests pass fakes and a fixed date. */
export interface Deps {
  tracker: Tracker;
  verifier: Verifier;
  /** The Owner's local date, `YYYY-MM-DD`. */
  today: string;
}

export async function run(args: string[], deps: Partial<Deps> = {}): Promise<RunResult> {
  try {
    const { code = 0, ...out } = await dispatch(new Args(args), deps);
    return { code, stdout: JSON.stringify({ ok: code === 0, ...out }) };
  } catch (error) {
    if (error instanceof LedgerError) return failure(error.kind === "refused" ? 3 : 2, error.message);
    if (error instanceof SchemaError) return failure(2, error.message);
    if (error instanceof UpgradeProblem)
      return { code: 1, stdout: JSON.stringify({ ok: false, problem: error.message }) };
    if (error instanceof TrackerError) return failure(3, `GitHub refused or didn't answer: ${error.message}`);
    throw error;
  }
}

function failure(code: number, error: string): RunResult {
  return { code, stdout: JSON.stringify({ ok: false, error }) };
}

/** The release worktree this script runs from: `<root>/skill/scripts/upgrade/`. */
const RELEASE_ROOT = resolve(import.meta.dirname, "..", "..", "..");

type Output = { code?: number } & Record<string, unknown>;

async function dispatch(args: Args, deps: Partial<Deps>): Promise<Output> {
  const command = args.command();
  const project = args.required("--project");
  const source = args.optional("--source") ?? RELEASE_ROOT;
  const today = deps.today ?? localToday();
  switch (command) {
    case "offer": {
      const to = args.required("--to");
      const { plan, reason } = planUpgrade(project, source, to, today);
      if (plan === null) return { offer: null, held: null, reason };
      if (plan.held && plan.freeze !== null) {
        const { id, name, date } = plan.freeze;
        return { offer: null, held: { to, sitting: id, name, date }, reason: heldReason(plan) };
      }
      return { offer: plan, held: null, reason: null };
    }
    case "start":
      return {
        ...startUpgrade(project, args.required("--holder"), {
          source,
          to: args.required("--to"),
          answer: nonEmpty(args.required("--answer"), "--answer"),
          today,
        }),
      };
    case "apply":
      return { ...applyUpgrade(project, args.required("--holder"), source) };
    case "migrate":
      return { ...(await migrateUpgrade(project, args.required("--holder"))) };
    default:
      throw new LedgerError("invalid", `unknown command: ${command}`);
  }
}
