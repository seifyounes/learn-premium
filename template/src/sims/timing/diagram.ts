// A timing diagram: a sim's run drawn step by step from its engine. Each row is one quantity (a
// cylinder's position, a signal line's level) with a value at every step line or during every step;
// a quantity is named `row[k]`. The engine gives the rows and their levels, the key gives the same
// levels from the Worked example, and a view draws both. Generic: a pneumatic circuit's
// displacement-step diagram first, an FSM's timing strip next.

/** One row of the diagram: a position at each step line, or a level during each step between lines. */
export interface TimingRow {
  id: string;
  label: string;
  /** `travel`: drawn as a slope between positions; `signal`: drawn as a square wave. */
  kind: "travel" | "signal";
  /** Drawn at the step lines (a position) or over the intervals between them (a level). */
  at: "lines" | "intervals";
}

/** The quantity a row has at step `k` (from 1): `A[3]`. */
export const quantityOf = (row: string, k: number) => `${row}[${k}]`;

/** `II[4]` → row `II`, step 4; undefined for a name that isn't a row's quantity. */
export function rowOf(quantity: string): { row: string; k: number } | undefined {
  const m = /^(.+)\[(\d+)\]$/.exec(quantity);
  return m ? { row: m[1] as string, k: Number(m[2]) } : undefined;
}

/** Where a run is now: the step line it left and how far along that movement it is, for the live diagram. */
export interface Now {
  line: number;
  fraction: number;
  /** Each travelling row's position now, 0 … 1. */
  travel: Readonly<Record<string, number>>;
}
