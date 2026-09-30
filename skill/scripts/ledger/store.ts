// Reading and writing the Build ledger file, through the schema-checked, atomic, mutex-guarded
// helpers in file.ts; every write also regenerates the pages generated from it.
import { join } from "node:path";
import { readChecked, withMutex, writeChecked } from "./file.ts";
import { LEDGER_FILE, ledgerSchema, type Ledger } from "./model.ts";
import { writePages } from "./render.ts";

export { LedgerError } from "./file.ts";

export function ledgerPath(project: string): string {
  return join(project, LEDGER_FILE);
}

export function readLedger(project: string): Ledger | null {
  return readChecked(ledgerPath(project), ledgerSchema, "ledger");
}

/** Reads the ledger, applies `change` and writes the result back (and the pages generated from it), all under the mutex. */
export function updateLedger<T>(project: string, change: (ledger: Ledger | null) => { ledger: Ledger; result: T }): T {
  return withMutex(ledgerPath(project), () => {
    const { ledger, result } = change(readLedger(project));
    writeChecked(ledgerPath(project), ledgerSchema, "ledger", ledger);
    writePages(project, ledger);
    return result;
  });
}
