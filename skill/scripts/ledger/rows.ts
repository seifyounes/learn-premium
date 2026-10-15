// The ledger's rows by kind, with the id each goes by on the command line: what `supersede` addresses and
// what the status page lists as superseded.
import type { Ledger } from "./model.ts";

export const ROW_KINDS = ["material", "module", "wave", "job", "checkpoint", "override", "gate-gap"] as const;
export type RowKind = (typeof ROW_KINDS)[number];

/** A row of any kind, with the id it goes by on the command line. */
export interface Entry {
  id: string;
  row: { superseded: { at: string; reason: string } | null };
}

/** Every row of one kind that can be superseded, keyed by its command-line id. */
export const ENTRIES: Record<RowKind, (ledger: Ledger) => Entry[]> = {
  material: (l) => l.materials.map((row) => ({ id: row.path, row })),
  module: (l) => l.modules.map((row) => ({ id: row.id, row })),
  wave: (l) => l.waves.map((row) => ({ id: row.id, row })),
  job: (l) => l.jobs.map((row) => ({ id: `${row.wave}/${row.job}`, row })),
  checkpoint: (l) => l.checkpoints.map((row) => ({ id: row.key, row })),
  override: (l) => l.template.overrides.map((row) => ({ id: row.path, row })),
  "gate-gap": (l) => l.gateGaps.map((row) => ({ id: row.id, row })),
};

/** Every superseded row of the ledger: its kind, id, when it was superseded and why. */
export function supersededRows(ledger: Ledger) {
  return ROW_KINDS.flatMap((kind) =>
    ENTRIES[kind](ledger).flatMap(({ id, row }) =>
      row.superseded === null ? [] : [{ row: kind, id, ...row.superseded }],
    ),
  );
}
