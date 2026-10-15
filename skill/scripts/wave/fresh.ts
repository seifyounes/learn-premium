// A re-run wave's readings and review must be newer than the Materials it took in. The readings and the
// review live in the Private folder, outside git, and are reused by file name: a fresh wave of a Module
// whose lecture changed would otherwise find the last wave's files and merge on them.
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { current, type Ledger } from "../ledger/model.ts";
import { waveFolder } from "./reading.ts";

/** Linux file times come from a coarse clock, a few ms behind `Date.now()`; a file this much older still counts. */
export const CLOCK_SLACK_MS = 2_000;

const FILES = ["reading-a.json", "reading-b.json", "review/review.json"];

/**
 * Why the Module's readings or review are older than its Materials: the newest Material row of the Module
 * was taken in after the file was written. A file that isn't there is reported elsewhere.
 */
export function staleProblems(ledger: Ledger, privateFolder: string, module: string): string[] {
  const taken = current(ledger.materials)
    .filter((m) => m.module === module)
    .map((m) => m.recordedAt)
    .sort()
    .at(-1);
  if (taken === undefined) return [];
  const root = waveFolder(privateFolder, module);
  return FILES.filter((file) => {
    const full = join(root, file);
    return existsSync(full) && statSync(full).mtimeMs + CLOCK_SLACK_MS < Date.parse(taken);
  }).map(
    (file) =>
      `${file} in the Private folder is older than Module ${module}'s Materials (taken in ${taken}): run it again in this wave`,
  );
}
