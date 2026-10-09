// A relaunched subagent's rows in the Build ledger: which of its dead predecessor's files were
// re-gated, and which it kept, fixed or discarded. `wave.ts relaunch` re-gates the files and writes
// these rows; nothing else does.
import { LedgerError } from "./file.ts";
import { mutate } from "./ledger.ts";
import { current, type Relaunch, type RelaunchOutcome } from "./model.ts";

/** The relaunch of `job` in `wave` not settled yet, if any. */
export function openRelaunchOf(relaunches: Relaunch[], wave: string, job: string): Relaunch | undefined {
  return current(relaunches).find((r) => r.wave === wave && r.job === job && r.closedAt === null);
}

/** Records that `job` was relaunched in a running wave, with its predecessor's files as the re-gate found them. */
export function openRelaunch(
  project: string,
  holder: string,
  row: {
    wave: string;
    job: string;
    files: Pick<Relaunch["files"][number], "path" | "before" | "covered" | "findings">[];
  },
): void {
  mutate(project, holder, (ledger) => {
    const wave = current(ledger.waves).find((w) => w.id === row.wave);
    if (wave === undefined || wave.state !== "running") throw new LedgerError("invalid", `no running wave ${row.wave}`);
    if (openRelaunchOf(ledger.relaunches, row.wave, row.job) !== undefined)
      throw new LedgerError(
        "refused",
        `${row.job} was already relaunched in ${row.wave} and its predecessor's files aren't settled: close that relaunch first`,
      );
    ledger.relaunches.push({
      wave: row.wave,
      job: row.job,
      openedAt: new Date().toISOString(),
      closedAt: null,
      files: row.files.map((f) => ({ ...f, outcome: null, after: null })),
      superseded: null,
    });
  });
}

/** Settles the open relaunch of `job`: each predecessor file's outcome, and its hash when kept or fixed. */
export function closeRelaunch(
  project: string,
  holder: string,
  wave: string,
  job: string,
  outcomes: Map<string, { outcome: RelaunchOutcome; after: string | null }>,
): void {
  mutate(project, holder, (ledger) => {
    const row = openRelaunchOf(ledger.relaunches, wave, job);
    if (row === undefined) throw new LedgerError("refused", `no open relaunch of ${job} in ${wave}`);
    for (const file of row.files) {
      const settled = outcomes.get(file.path);
      if (settled === undefined) throw new LedgerError("invalid", `no outcome for ${file.path}`);
      file.outcome = settled.outcome;
      file.after = settled.after;
    }
    row.closedAt = new Date().toISOString();
  });
}
