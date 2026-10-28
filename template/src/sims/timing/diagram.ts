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

/** The diagram's metrics, in px: it is drawn at this size and never scaled, so its text stays legible. */
export const DIAGRAM = { labelW: 80, stepW: 72, rowH: 40, axisH: 34 } as const;

/** The x of step line `k` (from 1). */
export const lineX = (k: number) => DIAGRAM.labelW + (k - 1) * DIAGRAM.stepW;

const num = (v: number) => String(Math.round(v * 100) / 100);

/** The y of level `v` (0 … 1) in the band at `index`. */
const levelY = (index: number, v: number) =>
  DIAGRAM.axisH + index * DIAGRAM.rowH + DIAGRAM.rowH - 8 - v * (DIAGRAM.rowH - 16);

/**
 * A row's path, drawn from the levels it has (`levels` by quantity name). A travel row goes through
 * each step line at its level, a movement a slope and a hold flat; a signal row is a square wave over
 * its intervals with a riser where it changes. A missing level breaks the path. With `now`, the
 * movement under way is drawn only as far as it has got.
 */
export function rowPath(
  row: TimingRow,
  index: number,
  lines: number,
  levels: Readonly<Record<string, number>>,
  now?: Now,
): string {
  const at = (k: number) => levels[quantityOf(row.id, k)];
  let d = "";
  if (row.kind === "travel") {
    let drawing = false;
    for (let k = 1; k <= lines; k++) {
      const v = at(k);
      if (v === undefined) {
        drawing = false;
        continue;
      }
      d += `${drawing ? "L" : "M"}${lineX(k)} ${num(levelY(index, v))}`;
      drawing = true;
    }
    const tip = now?.travel[row.id];
    if (now && tip !== undefined && at(now.line) !== undefined)
      d += `L${num(lineX(now.line) + now.fraction * DIAGRAM.stepW)} ${num(levelY(index, tip))}`;
    return d;
  }
  let previous: number | undefined;
  for (let k = 1; k < lines; k++) {
    const v = at(k);
    if (v === undefined) {
      previous = undefined;
      continue;
    }
    const end = now && now.line === k ? lineX(k) + now.fraction * DIAGRAM.stepW : lineX(k + 1);
    if (previous === undefined) d += `M${lineX(k)} ${num(levelY(index, v))}`;
    else if (previous !== v) d += `V${num(levelY(index, v))}`;
    d += `H${num(end)}`;
    previous = v;
  }
  return d;
}

/** The size the diagram is drawn at for `rows` rows over `lines` step lines. */
export function diagramSize(rows: number, lines: number): { width: number; height: number } {
  return {
    width: DIAGRAM.labelW + (lines - 1) * DIAGRAM.stepW + 24,
    height: DIAGRAM.axisH + rows * DIAGRAM.rowH + 12,
  };
}

const steps = (ks: readonly number[]) => ks.join(", ");
const span = (ks: readonly number[]) =>
  ks.length > 1 && ks.every((k, i) => i === 0 || k === (ks[i - 1] ?? 0) + 1) ? `${ks[0]}–${ks.at(-1)}` : steps(ks);

/**
 * A key checks whole rows: every row the sheet maps, at every step the diagram draws it. `engine` is
 * the diagram's quantities; a key that maps a row at only some of its steps would let the rest go
 * unchecked, so it blocks, and a key that maps no row of the diagram checks nothing.
 */
export function keyRows(
  sheet: Readonly<Record<string, string>>,
  engine: Readonly<Record<string, number>>,
): { rows: number; problems: string[] } {
  const drawn = (id: string) =>
    Object.keys(engine)
      .flatMap((q) => (rowOf(q)?.row === id ? [rowOf(q)?.k ?? 0] : []))
      .sort((a, b) => a - b);
  const mapped = new Map<string, number[]>();
  for (const quantity of Object.values(sheet)) {
    const found = rowOf(quantity);
    if (found && drawn(found.row).length > 0) mapped.set(found.row, [...(mapped.get(found.row) ?? []), found.k]);
  }
  if (mapped.size === 0) return { rows: 0, problems: ["the key maps no row of the timing diagram"] };
  let rows = 0;
  const problems: string[] = [];
  for (const [id, ks] of mapped) {
    const have = [...new Set(ks)].sort((a, b) => a - b);
    const want = drawn(id);
    if (have.join() === want.join()) rows += 1;
    else
      problems.push(
        `the key maps ${id} at steps ${steps(have)} only, but the timing diagram draws it at steps ${span(want)}: a key row is checked whole`,
      );
  }
  return { rows, problems };
}
