// Gate gaps in the Build ledger: recorded the moment a build finds a defect class no gate caught,
// filed on learn-premium's tracker by the gate-gap step (../gate-gap/README.md), and holding up
// "Course done" while any is unfiled.
import { join } from "node:path";
import { hashTree } from "./hash.ts";
import { mutate } from "./ledger.ts";
import { current, GATE_GAPS_DIR, type GateGap, type Ledger } from "./model.ts";
import { overrideProblem } from "./overrides.ts";
import { LedgerError } from "./store.ts";

/** A gate gap's fixture folder in the Course project, relative to it. */
export const fixtureFolder = (id: string) => `${GATE_GAPS_DIR}/${id}`;

/** The gate gaps recorded but not yet filed. */
export function unfiledGateGaps(ledger: Ledger): GateGap[] {
  return current(ledger.gateGaps).filter((gap) => gap.issue === null);
}

/**
 * Records a gate gap, unfiled. Its fixture must already be in `build-records/gate-gaps/<id>/`, and
 * each override it declares in the overrides area. Recording an unfiled one again replaces it; a
 * filed one is on the tracker, so a new defect gets a new id. The Course is no longer done.
 */
export function recordGateGap(
  project: string,
  holder: string,
  gap: { id: string; title: string; defect: string; overrides: string[] },
): void {
  mutate(project, holder, (ledger) => {
    const existing = current(ledger.gateGaps).find((row) => row.id === gap.id);
    if (existing?.issue != null)
      throw new LedgerError(
        "refused",
        `gate gap ${gap.id} is already filed as #${existing.issue}: a new defect gets a new id`,
      );
    if (Object.keys(hashTree(join(project, fixtureFolder(gap.id)))).length === 0)
      throw new LedgerError(
        "invalid",
        `no fixture in ${fixtureFolder(gap.id)}/: write the synthetic minimal broken fixture there first`,
      );
    for (const path of gap.overrides) {
      const problem = overrideProblem(project, ledger, path);
      if (problem !== null) throw new LedgerError("invalid", problem);
    }
    const at = new Date().toISOString();
    if (existing !== undefined) existing.superseded = { at, reason: "re-recorded before filing" };
    ledger.gateGaps.push({ ...gap, issue: null, recordedAt: at, filedAt: null, superseded: null });
    ledger.done = null;
  });
}

/** Marks a gate gap filed as issue `issue`, and records each override it declares against that issue. */
export function markGateGapFiled(project: string, holder: string, id: string, issue: number): void {
  mutate(project, holder, (ledger) => {
    const gap = current(ledger.gateGaps).find((row) => row.id === id);
    if (gap === undefined) throw new LedgerError("invalid", `no gate gap ${id} in the ledger`);
    if (gap.issue !== null) throw new LedgerError("refused", `gate gap ${id} is already filed as #${gap.issue}`);
    const at = new Date().toISOString();
    gap.issue = issue;
    gap.filedAt = at;
    for (const path of gap.overrides) {
      for (const row of current(ledger.template.overrides)) {
        if (row.path === path) row.superseded = { at, reason: `re-recorded for gate gap #${issue}` };
      }
      ledger.template.overrides.push({ path, gateGap: issue, recordedAt: at, superseded: null });
    }
  });
}

/** Marks the Course build done: refused while a gate gap is unfiled or a wave is still running. */
export function markDone(project: string, holder: string): void {
  mutate(project, holder, (ledger) => {
    const unfiled = unfiledGateGaps(ledger);
    if (unfiled.length > 0)
      throw new LedgerError(
        "refused",
        `the Course can't be marked done while a gate gap is unfiled: ${unfiled.map((g) => g.id).join(", ")} (file each with the gate-gap step)`,
      );
    const running = current(ledger.waves).filter((w) => w.state === "running");
    if (running.length > 0)
      throw new LedgerError(
        "refused",
        `the Course can't be marked done while a wave runs: ${running.map((w) => w.id).join(", ")}`,
      );
    ledger.done = { holder, at: new Date().toISOString() };
  });
}
