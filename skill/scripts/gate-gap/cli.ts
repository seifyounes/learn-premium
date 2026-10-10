// The gate-gap step's command interface: argv in, exit code and one JSON document out.
//
// Exit codes as the ledger's: 0 done; 2 bad arguments or input; 3 refused (the lock, the ledger's
// state, a fixture that isn't synthetic, or GitHub). The entry point (../gate-gap.ts) adds 4 for
// internal errors.
import { Args } from "../ledger/args.ts";
import { LedgerError } from "../ledger/file.ts";
import { SchemaError } from "../ledger/schema.ts";
import { fileGateGap } from "./file.ts";
import { ghTracker, TrackerError, type Tracker } from "./tracker.ts";

export interface RunResult {
  code: number;
  stdout: string;
}

/** What filing reaches outside this machine through: learn-premium's tracker. Tests pass a fake. */
export interface Deps {
  tracker: Tracker;
}

export async function run(args: string[], deps: Partial<Deps> = {}): Promise<RunResult> {
  try {
    const out = await dispatch(new Args(args), deps);
    return { code: 0, stdout: JSON.stringify({ ok: true, ...out }) };
  } catch (error) {
    if (error instanceof LedgerError) return failure(error.kind === "refused" ? 3 : 2, error.message);
    if (error instanceof SchemaError) return failure(2, error.message);
    if (error instanceof TrackerError) return failure(3, `GitHub refused or didn't answer: ${error.message}`);
    throw error;
  }
}

function failure(code: number, error: string): RunResult {
  return { code, stdout: JSON.stringify({ ok: false, error }) };
}

async function dispatch(args: Args, deps: Partial<Deps>): Promise<Record<string, unknown>> {
  const command = args.command();
  switch (command) {
    case "file":
      return fileGateGap(
        args.required("--project"),
        args.required("--holder"),
        args.required("--id"),
        deps.tracker ?? ghTracker(),
      );
    default:
      throw new LedgerError("invalid", `unknown command: ${command}`);
  }
}
