// The Worked examples' numbers, per job: every number a Worked example's sheet works out is
// checked against the independent recompute (which never sees the writer's work) at the sheet's
// printed precision. A cell a live sim maps is the sim-numbers gate's, three ways with the engine;
// every other worked-out number is checked here, against the recompute's log for that example.
// A missing recompute blocks (the recompute job didn't run); a sheet value the recompute disagrees
// with is the Professor's call, so it goes to the Owner as a Checkpoint item, unless the Owner has
// ruled it: a Divergence ships as printed, and a Slip the sheet still prints blocks, since the site
// ships the corrected value.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "astro/zod";
import { sim as simSchema, worked as workedSchema } from "../src/content/contract.ts";
import { moduleOf } from "../src/content/layout.ts";
import { readStructured } from "../src/content/loaders.ts";
import { numbersIn } from "../src/provenance/values.ts";
import { isLive } from "../src/sims/kinds.ts";
import { agreesAtPrint, printAt, readPrinted, rulingValues } from "../src/sims/precision.ts";
import { cellAt, CELL_REF } from "../src/worked/cells.ts";
import { courseCopy, courseFiles, type CourseFile } from "./course-files.ts";
import { nameOf, problems, recomputeLogEntry } from "./sims.ts";
import type { Finding, Gate, GateInput, GateRun } from "./runner.ts";

export const WORKED_RECOMPUTE_LOG = "learn-premium worked recompute v1";

/** What the independent recompute leaves in the Course's build records for one Worked example. */
export const workedRecomputeLog = z.strictObject({
  recompute: z.literal(WORKED_RECOMPUTE_LOG),
  /** Who or what recomputed it, and how. */
  by: z.string().min(1),
  /** Every worked-out number it recomputed, by sheet cell (`D2`). */
  cells: z.record(z.string().regex(CELL_REF, "a sheet cell, e.g. D2"), z.number()),
});

/** Where the independent recompute logs one Worked example: beside the sims' logs, as `worked-<n>.json`. */
export const workedLogEntry = (module: string, number: string) =>
  `build-records/recompute/${module}/worked-${number}.json`;

const ignoreMath = () => {};
const read = (file: CourseFile) => readStructured(readFileSync(file.path, "utf8"), file.entry, ignoreMath);

/** The sheet cells each Worked example's live sims map (the sim-numbers gate checks those), by example. */
function simCells(files: CourseFile[], contentDir: string): Map<string, Map<string, number | undefined>> {
  const mapped = new Map<string, Map<string, number | undefined>>();
  for (const file of files.filter((f) => f.collection === "sims")) {
    let parsed;
    try {
      parsed = simSchema.safeParse(read(file));
    } catch {
      continue; // the content gates report an unreadable sim
    }
    if (!parsed.success || !isLive(parsed.data) || parsed.data.worked === undefined) continue;
    const module = moduleOf(file.entry) ?? "";
    // The sim's own recompute log, for each cell it maps (sim-numbers checks the log is sound).
    let values: Record<string, unknown> = {};
    try {
      const logPath = join(contentDir, recomputeLogEntry(module, nameOf(file.entry)));
      values = (JSON.parse(readFileSync(logPath, "utf8")) as { values?: Record<string, unknown> }).values ?? {};
    } catch {
      // no log: sim-numbers blocks the sim
    }
    const key = `${module}/${parsed.data.worked}`;
    const cells = mapped.get(key) ?? new Map<string, number | undefined>();
    for (const [cell, quantity] of Object.entries(parsed.data.sheet)) {
      const value = values[quantity];
      cells.set(cell, typeof value === "number" ? value : undefined);
    }
    mapped.set(key, cells);
  }
  return mapped;
}

/** How many rulings name each magnitude. */
function countsOf(written: readonly string[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const n of written.flatMap(rulingValues)) counts.set(n, (counts.get(n) ?? 0) + 1);
  return counts;
}

/** Uses up one ruling on `value`, if one is left. */
function take(counts: Map<number, number>, value: number): boolean {
  const remaining = counts.get(value) ?? 0;
  if (remaining === 0) return false;
  counts.set(value, remaining - 1);
  return true;
}

async function run(input: GateInput): Promise<GateRun> {
  const files = courseFiles(input);
  const bySims = simCells(files, input.contentDir);
  // A Module with no Worked example has nothing to check and passes, the gate having looked in it.
  const coverage = {
    modules: files.filter((f) => f.collection === "modules").length,
    workedExamples: 0,
    cells: 0,
    simCells: 0,
  };
  const findings: Finding[] = [];
  for (const file of files.filter((f) => f.collection === "worked")) {
    const block = (message: string, at = file.entry) => findings.push({ outcome: "block", at, message });
    let parsed;
    try {
      parsed = workedSchema.safeParse(read(file));
    } catch (error) {
      block(`can't read the Worked example, so its numbers can't be checked: ${(error as Error).message}`);
      continue;
    }
    if (!parsed.success) {
      block(`can't check the Worked example's numbers: the content contract reports ${problems(parsed.error)}`);
      continue;
    }
    coverage.workedExamples += 1;
    const { artefact, provenance } = parsed.data;
    const module = moduleOf(file.entry) ?? "";
    const number = nameOf(file.entry);
    const fromSims = bySims.get(`${module}/${number}`) ?? new Map<string, number | undefined>();
    // A Slip ships its corrected value to students: it must be the recompute of the cell it corrects
    // (from this example's log, or the live sim's for a cell the sim maps), sign included.
    const checkSlips = (logged: Record<string, number>) => {
      for (const slip of provenance.slips) {
        const on = rulingValues(slip.sheet).join(", ");
        if (slip.cell === undefined) {
          block(
            `the Slip on ${on} names no cell: give the sheet cell it corrects (cell), so its corrected value can be checked`,
          );
          continue;
        }
        const recomputed = logged[slip.cell] ?? fromSims.get(slip.cell);
        if (recomputed === undefined) {
          // A sim cell with no log is sim-numbers' to block; any other cell has no recompute.
          if (!fromSims.has(slip.cell))
            block(`the Slip on ${on} corrects cell ${slip.cell}, which no recompute log gives`);
          continue;
        }
        const shipped = readPrinted(slip.value);
        if (typeof shipped === "string") {
          block(`the Slip on ${on} (cell ${slip.cell}) must print its corrected value as one number: ${shipped}`);
          continue;
        }
        if (!agreesAtPrint(recomputed, shipped))
          block(
            `the Slip on ${on} (cell ${slip.cell}) ships ${shipped.written} as the corrected value, but the independent recompute gives ${printAt(recomputed, shipped.decimals).replace("−", "-")} for ${slip.cell}`,
          );
      }
    };
    // Every cell the sheet works out (not a given column) that prints one number.
    const worked = new Map<string, ReturnType<typeof readPrinted>>();
    artefact.rows.forEach((row, r) =>
      row.forEach((text, c) => {
        if (artefact.columns[c]?.given || numbersIn(text).length === 0) return;
        const cell = cellAt(r, c);
        if (fromSims.has(cell)) coverage.simCells += 1;
        else worked.set(cell, readPrinted(text));
      }),
    );
    if (worked.size === 0) {
      checkSlips({});
      continue;
    }
    const logEntry = workedLogEntry(module, number);
    const logPath = join(input.contentDir, logEntry);
    if (!existsSync(logPath)) {
      block(
        `no recompute log at ${logEntry}: every number a Worked example works out is checked against an independent recompute (${[...worked.keys()].join(", ")})`,
      );
      continue;
    }
    let log;
    try {
      log = workedRecomputeLog.safeParse(JSON.parse(readFileSync(logPath, "utf8")));
    } catch (error) {
      block(`can't read the recompute log ${logEntry}: ${(error as Error).message}`);
      continue;
    }
    if (!log.success) {
      block(`the recompute log ${logEntry} isn't one: ${problems(log.error)}`);
      continue;
    }
    // Each ruling covers one cell: a value ruled once doesn't also cover another cell printing it.
    const divergences = countsOf(provenance.divergences.map((d) => d.value));
    const slips = countsOf(provenance.slips.map((s) => s.sheet));
    for (const cell of Object.keys(log.data.cells)) {
      if (!worked.has(cell))
        block(`the recompute log ${logEntry} gives ${cell}, which isn't a number the sheet works out`);
    }
    checkSlips(log.data.cells);
    for (const [cell, printed] of worked) {
      if (typeof printed === "string") {
        block(`sheet cell ${cell} can't be compared with the recompute: ${printed}`);
        continue;
      }
      const recomputed = log.data.cells[cell];
      if (recomputed === undefined) {
        block(`the recompute log ${logEntry} doesn't give sheet cell ${cell}: the recompute works out every number`);
        continue;
      }
      coverage.cells += 1;
      if (agreesAtPrint(recomputed, printed) || take(divergences, Math.abs(printed.value))) continue;
      const computed = printAt(recomputed, printed.decimals);
      findings.push(
        take(slips, Math.abs(printed.value))
          ? {
              outcome: "block",
              at: file.entry,
              message: `sheet cell ${cell} prints ${printed.written}, which the Owner ruled a Slip: the site ships the corrected value, ${computed}`,
            }
          : {
              outcome: "checkpoint",
              at: file.entry,
              message: `sheet cell ${cell} prints ${printed.written}, but the independent recompute gives ${computed}: rule it a Slip or a Divergence`,
            },
      );
    }
  }
  return { coverage, findings };
}

/** A scratch copy of the Course with `plant` run on the first Worked example in scope that has a recompute log. */
function plantInLoggedExample(
  good: GateInput,
  scratch: string,
  plant: (site: { contentDir: string; workedEntry: string; logPath: string; cells: Record<string, number> }) => void,
): GateInput {
  const copy = courseCopy(good, scratch);
  for (const file of courseFiles(copy).filter((f) => f.collection === "worked")) {
    const logPath = join(copy.contentDir, workedLogEntry(moduleOf(file.entry) ?? "", nameOf(file.entry)));
    if (!existsSync(logPath)) continue;
    const { cells } = JSON.parse(readFileSync(logPath, "utf8")) as { cells: Record<string, number> };
    plant({ contentDir: copy.contentDir, workedEntry: file.entry, logPath, cells });
    return copy;
  }
  throw new Error("no Worked example in scope has a recompute log to plant a defect in");
}

/** Writes `log` with one cell's value changed. */
function withCell(logPath: string, cell: string, value: number): void {
  const log = JSON.parse(readFileSync(logPath, "utf8")) as { cells: Record<string, number> };
  writeFileSync(logPath, JSON.stringify({ ...log, cells: { ...log.cells, [cell]: value } }));
}

const firstCell = (cells: Record<string, number>) => {
  const entry = Object.entries(cells)[0];
  if (!entry) throw new Error("the recompute log gives no cell");
  return entry;
};

export const workedNumbers: Gate = {
  id: "worked-numbers",
  checks:
    "every number a Worked example's sheet works out agrees with the independent recompute at its printed precision (cells a live sim maps are sim-numbers')",
  points: ["job", "deploy"],
  run,
  controls: [
    {
      defect: "a Worked example whose recompute log is missing",
      plant: (good, scratch) => plantInLoggedExample(good, scratch, ({ logPath }) => rmSync(logPath)),
    },
    {
      defect: "a recompute log that leaves out one worked-out cell",
      plant: (good, scratch) =>
        plantInLoggedExample(good, scratch, ({ logPath, cells }) => {
          const [cell] = firstCell(cells);
          const log = JSON.parse(readFileSync(logPath, "utf8")) as { cells: Record<string, number> };
          const kept = Object.fromEntries(Object.entries(log.cells).filter(([c]) => c !== cell));
          writeFileSync(logPath, JSON.stringify({ ...log, cells: kept }));
        }),
    },
    {
      defect: "a sheet value the independent recompute disagrees with, which only the Owner can rule",
      expect: "checkpoint",
      plant: (good, scratch) =>
        plantInLoggedExample(good, scratch, ({ logPath, cells }) => {
          const [cell, value] = firstCell(cells);
          // Five whole units off: past the ±1 in the last digit of even a sheet that prints integers.
          withCell(logPath, cell, value + 5 * Math.max(1, Math.abs(value)));
        }),
    },
    {
      defect: "a sheet that still prints a value the Owner ruled a Slip",
      plant: (good, scratch) =>
        plantInLoggedExample(good, scratch, ({ contentDir, workedEntry, logPath, cells }) => {
          const [cell, value] = firstCell(cells);
          const off = value + 5 * Math.max(1, Math.abs(value));
          withCell(logPath, cell, off);
          // The sheet keeps printing its value, which the Owner ruled a Slip in favour of the recompute's.
          const path = join(contentDir, workedEntry);
          const example = read({ path, entry: workedEntry, collection: "worked" }) as {
            artefact: { rows: string[][] };
            provenance?: { slips?: unknown[] };
          };
          const { row, col } = { row: Number(cell.slice(1)) - 1, col: cell.charCodeAt(0) - 65 };
          const printed = example.artefact.rows[row]?.[col] ?? "";
          example.provenance = {
            ...example.provenance,
            slips: [...(example.provenance?.slips ?? []), { value: String(off), sheet: printed }],
          };
          writeFileSync(path, JSON.stringify(example));
        }),
    },
  ],
};
