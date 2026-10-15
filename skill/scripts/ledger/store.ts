// Reading and writing the Build ledger file, through the schema-checked, atomic, mutex-guarded
// helpers in file.ts; every write also regenerates the pages generated from it.
import { statSync } from "node:fs";
import { join } from "node:path";
import { LedgerError, readChecked, withMutex, writeChecked } from "./file.ts";
import { LEDGER_FILE, ledgerSchema, type Ledger } from "./model.ts";
import { writePages } from "./render.ts";

export { LedgerError } from "./file.ts";

export function ledgerPath(project: string): string {
  return join(project, LEDGER_FILE);
}

/**
 * A linked worktree has `.git` as a file, the main checkout as a folder. A Module wave's worktree holds
 * a stale copy of the ledger (committed on `main` before the wave began): the one live ledger is the
 * main checkout's, so the ledger is neither read nor written through a worktree.
 */
function refuseWorktree(project: string): void {
  let isFile = false;
  try {
    isFile = statSync(join(project, ".git")).isFile();
  } catch {
    // no .git at all: a plain folder
  }
  if (isFile)
    throw new LedgerError(
      "invalid",
      `${project} is a wave's git worktree, not the Course project's main checkout: the Build ledger is read and written only there`,
    );
}

export function readLedger(project: string): Ledger | null {
  refuseWorktree(project);
  return readChecked(ledgerPath(project), ledgerSchema, "ledger");
}

/** Reads the ledger, applies `change` and writes the result back (and the pages generated from it), all under the mutex. */
export function updateLedger<T>(project: string, change: (ledger: Ledger | null) => { ledger: Ledger; result: T }): T {
  refuseWorktree(project);
  return withMutex(ledgerPath(project), () => {
    const { ledger, result } = change(readLedger(project));
    writeChecked(ledgerPath(project), ledgerSchema, "ledger", ledger);
    writePages(project, ledger);
    return result;
  });
}
