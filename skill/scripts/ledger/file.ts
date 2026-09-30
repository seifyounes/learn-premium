// Schema-checked JSON files, shared by the Build ledger, the media file and the machine state folder.
// Every read is checked against its schema; every write replaces the file atomically, inside a
// short-lived mutex so two processes can't interleave a read-modify-write.
import { closeSync, existsSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { SchemaError, type Schema } from "./schema.ts";

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

/** Reads `path` and checks it against `schema`; null if there is no such file. A bad file is refused, naming the field. */
export function readChecked<T>(path: string, schema: Schema<T>, label: string): T | null {
  if (!existsSync(path)) return null;
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new LedgerError("invalid", `${path} is not valid JSON: ${(error as Error).message}`);
  }
  try {
    return schema(data, label);
  } catch (error) {
    if (error instanceof SchemaError) throw new LedgerError("invalid", `${path} fails its schema: ${error.message}`);
    throw error;
  }
}

/** Writes `data` to `path` atomically, after checking it: never write what a later read would refuse. */
export function writeChecked<T>(path: string, schema: Schema<T>, label: string, data: T): void {
  const checked = schema(data, label);
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

/** Runs `body` holding the mutex that guards `path`'s read-modify-write. */
export function withMutex<T>(path: string, body: () => T): T {
  const mutex = `${path}.mutex`;
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
