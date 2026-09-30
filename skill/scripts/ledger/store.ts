// Reading and writing the Build ledger file. Every read is schema-checked; every write replaces the
// file atomically, inside a short-lived mutex so two processes can't interleave a read-modify-write.
import { closeSync, existsSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LEDGER_FILE, ledgerSchema, type Ledger } from "./model.ts";
import { writePages } from "./render.ts";
import { SchemaError } from "./schema.ts";

/** Why a command was refused. `refused` is a state conflict (the lock, an existing ledger); `invalid` is bad input. */
export class LedgerError extends Error {
  readonly kind: "invalid" | "refused";
  constructor(kind: "invalid" | "refused", message: string) {
    super(message);
    this.kind = kind;
  }
}

/** A mutex older than this was left by a crashed process: a read-modify-write takes milliseconds. */
const STALE_MUTEX_MS = 30_000;
const MUTEX_WAIT_MS = 10_000;

export function ledgerPath(project: string): string {
  return join(project, LEDGER_FILE);
}

export function readLedger(project: string): Ledger | null {
  const path = ledgerPath(project);
  if (!existsSync(path)) return null;
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new LedgerError("invalid", `${path} is not valid JSON: ${(error as Error).message}`);
  }
  try {
    return ledgerSchema(data, "ledger");
  } catch (error) {
    if (error instanceof SchemaError) throw new LedgerError("invalid", `${path} fails its schema: ${error.message}`);
    throw error;
  }
}

/** Reads the ledger, applies `change` and writes the result back (and the pages generated from it), all under the mutex. */
export function updateLedger<T>(project: string, change: (ledger: Ledger | null) => { ledger: Ledger; result: T }): T {
  return withMutex(project, () => {
    const { ledger, result } = change(readLedger(project));
    writeLedger(project, ledger);
    writePages(project, ledger);
    return result;
  });
}

function writeLedger(project: string, ledger: Ledger): void {
  const checked = ledgerSchema(ledger, "ledger"); // never write what a later read would refuse
  const path = ledgerPath(project);
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(checked, null, 2)}\n`);
  renameRetrying(temp, path);
}

/** On Windows a rename over a file another process is reading fails for a moment; readers take no mutex. */
function renameRetrying(from: string, to: string): void {
  for (let attempt = 1; ; attempt++) {
    try {
      renameSync(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 50 || (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY")) throw error;
      sleep(20);
    }
  }
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withMutex<T>(project: string, body: () => T): T {
  const mutex = `${ledgerPath(project)}.mutex`;
  const deadline = Date.now() + MUTEX_WAIT_MS;
  for (;;) {
    try {
      closeSync(openSync(mutex, "wx"));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (isStale(mutex)) rmSync(mutex, { force: true });
      else if (Date.now() > deadline) throw new LedgerError("refused", `${mutex} is held by another process`);
      else sleep(20);
    }
  }
  try {
    return body();
  } finally {
    rmSync(mutex, { force: true });
  }
}

function isStale(mutex: string): boolean {
  try {
    return Date.now() - statSync(mutex).mtimeMs > STALE_MUTEX_MS;
  } catch {
    return false; // released between our attempt and this check; the next attempt will get it
  }
}
