// Which Course project a Materials folder belongs to: `/learn-premium <Materials path>` is all the
// Owner types, so the run finds the Course through the Course registry, by the Materials path each
// Build ledger records.
import { resolve } from "node:path";
import { LedgerError } from "../ledger/file.ts";
import { readLedger } from "../ledger/store.ts";
import { readRegistry } from "../media/store.ts";

/** The same folder, as Windows compares paths (case-insensitively) or as everywhere else does. */
export function samePath(a: string, b: string): boolean {
  const [x, y] = [resolve(a), resolve(b)];
  return process.platform === "win32" ? x.toLowerCase() === y.toLowerCase() : x === y;
}

export interface Found {
  project: string | null;
  course: string | null;
  /** Registered Courses whose Build ledger couldn't be read, so they couldn't be ruled out. */
  skipped: { project: string; error: string }[];
}

export function findCourse(stateDir: string, materials: string): Found {
  const skipped: Found["skipped"] = [];
  for (const { project } of readRegistry(stateDir).courses) {
    try {
      const ledger = readLedger(project);
      if (ledger === null) {
        skipped.push({ project, error: `no Build ledger in ${project}` });
        continue;
      }
      if (samePath(ledger.intake.materialsPath, materials)) {
        return { project, course: ledger.intake.courseName, skipped };
      }
    } catch (error) {
      if (!(error instanceof LedgerError)) throw error;
      skipped.push({ project, error: error.message });
    }
  }
  return { project: null, course: null, skipped };
}
