// Throwaway synthetic Course projects and Materials folders for the ledger tests.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach } from "vitest";
import { run } from "../scripts/ledger/cli.ts";

const made: string[] = [];

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

export function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `lp-${prefix}-`));
  made.push(dir);
  return dir;
}

/** Writes `files` (relative path → content) under `root`. */
export function writeFiles(root: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
}

export interface Result {
  code: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the JSON output; tests read the fields each command documents
  out: any;
}

/** Runs one ledger command exactly as the CLI would, returning its exit code and JSON output. */
export function ledger(...args: string[]): Result {
  const { code, stdout } = run(args);
  return { code, out: JSON.parse(stdout) };
}

/** Writes `data` as a JSON input file in a fresh folder and returns its path. */
export function jsonInput(data: unknown): string {
  const path = join(tempDir("input"), "input.json");
  writeFileSync(path, JSON.stringify(data));
  return path;
}
