// The Go-public check's command line: argv in, exit code and one JSON document out.
//
// Exit codes: 0 clear; 1 something found (blocked, or Checkpoint items for the Owner); 2 bad flags
// or not a Course project the check can read. The entry point (../go-public.ts) adds 4 for internal errors.
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { LedgerError } from "../ledger/store.ts";
import { CheckError, goPublicCheck } from "./check.ts";

export interface RunResult {
  code: number;
  stdout: string;
}

export async function run(args: string[]): Promise<RunResult> {
  let flags;
  try {
    flags = parseArgs({ args, options: { project: { type: "string" }, private: { type: "string" } } }).values;
  } catch (error) {
    return failure((error as Error).message);
  }
  if (flags.project === undefined) return failure("--project <Course project> is required");
  try {
    const report = await goPublicCheck(
      resolve(flags.project),
      flags.private === undefined ? null : resolve(flags.private),
    );
    const clear = report.verdict === "clear";
    return { code: clear ? 0 : 1, stdout: JSON.stringify({ ok: clear, ...report }) };
  } catch (error) {
    if (error instanceof CheckError || error instanceof LedgerError) return failure(error.message);
    throw error;
  }
}

function failure(error: string): RunResult {
  return { code: 2, stdout: JSON.stringify({ ok: false, error }) };
}
