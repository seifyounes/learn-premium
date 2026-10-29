// The Nernst gate, per job: every live Nernst sim checked three ways at the sheet (`sim-numbers`'
// way, at the sheet's printed precision), and then its whole slider grid, 9 points on each slider,
// against the independent recompute: the cell's potential at every state, and which electrode is
// the anode, which the 3D cell draws (and turns round) by the same rule (`src/sims/nernst/apparatus.ts`).
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { moduleOf } from "../src/content/layout.ts";
import { readStructured } from "../src/content/loaders.ts";
import { isLive, type LiveSim } from "../src/sims/kinds.ts";
import { cellState, type CellState } from "../src/sims/nernst/apparatus.ts";
import { cellPotential, type Cell, type Inputs, type Model } from "../src/sims/nernst/engine.ts";
import { nernstLog, SWEEP_POINTS, sweepGrid, sweepOrder, type NernstLog } from "../src/sims/nernst/log.ts";
import { printAt, readPrinted } from "../src/sims/precision.ts";
import { threeWay } from "../src/sims/three-way.ts";
import type { Range } from "../src/sims/tuning.ts";
import { parseCell } from "../src/worked/cells.ts";
import { courseCopy, courseFiles } from "./course-files.ts";
import type { Finding, Gate, GateInput } from "./runner.ts";
import { nameOf, problems, readSim, recomputeLogEntry, workedExample } from "./sims.ts";

/** What the recompute's sweep may differ from the engine by: float rounding of a log written to 12 decimals. */
const RELATIVE = 1e-9;
const ignoreMath = () => {};

const OF = { first: "the first electrode", second: "the second electrode", none: "none (no current)" } as const;
type Sweep = NernstLog["sweep"];

/** The sweep as a function, so a test can hand it a mutant potential or state rule. */
export interface SweepRules {
  potential: (model: Model, inputs: Inputs) => Cell;
  state: (model: Model, inputs: Inputs) => CellState;
}

const short = (n: number) => String(Number(n.toPrecision(6)));
const named = (names: readonly string[]) =>
  names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

/**
 * Every finding the recompute's sweep has against the engine: not the 9-point grid of every
 * slider, a state off the grid, a potential off the engine's, an anode the 3D cell would not draw.
 */
export function compareSweep(
  model: Model,
  tune: Record<string, Range>,
  sweep: Sweep,
  rules: Partial<SweepRules> = {},
): string[] {
  const use: SweepRules = { potential: cellPotential, state: cellState, ...rules };
  const names = sweepOrder(tune);
  const grid = sweepGrid(tune);
  if (sweep.length !== grid.length)
    return [
      `the sweep has ${sweep.length} states; the ${SWEEP_POINTS}-point grid over ${named(names)} has ${grid.length}`,
    ];
  const found: string[] = [];

  // Each state sits on the grid: the recompute swept every slider, min to max.
  let off = 0;
  let firstOff = "";
  sweep.forEach((state, i) => {
    const expected = grid[i] as Record<string, number>;
    const wrong = names.find((name) => {
      const v = expected[name] as number;
      const got = state.inputs[name];
      return got === undefined || Math.abs(got - v) > RELATIVE * Math.max(1, Math.abs(v));
    });
    if (wrong === undefined) return;
    off += 1;
    if (!firstOff)
      firstOff = `sweep state ${i} isn't on the grid: ${wrong} = ${short(state.inputs[wrong] ?? NaN)} where the grid has ${short(expected[wrong] as number)}`;
  });
  if (off > 0) found.push(off > 1 ? `${firstOff} (and ${off - 1} more)` : firstOff);

  // The cell's potential at every state.
  let wrongE = 0;
  const worst = { diff: 0, i: 0, engine: 0 };
  sweep.forEach((state, i) => {
    const inputs = state.inputs as unknown as Inputs;
    const engine = use.potential(model, inputs).E;
    const diff = Math.abs(state.E - engine);
    if (!(diff <= RELATIVE * Math.max(1, Math.abs(engine)))) {
      wrongE += 1;
      if (!(diff <= worst.diff)) Object.assign(worst, { diff, i, engine });
    }
  });
  if (wrongE > 0) {
    const at = (sweep[worst.i] as Sweep[number]).inputs;
    found.push(
      `the recompute's E is off the engine's at ${wrongE} of ${sweep.length} states, worst at sweep state ${worst.i} (${names.map((n) => `${n} = ${short(at[n] ?? NaN)}`).join(", ")}): ${short((sweep[worst.i] as Sweep[number]).E)} V against ${short(worst.engine)} V`,
    );
  }

  // The anode, which the 3D cell draws: by the recompute's own reasoning, the electrode with the lower reduction potential.
  const disagree = new Map<string, number>();
  sweep.forEach((state) => {
    const expected = use.state(model, state.inputs as unknown as Inputs).anode;
    if (state.anode === expected) return;
    const key = `${state.anode ?? "none"}|${expected ?? "none"}`;
    disagree.set(key, (disagree.get(key) ?? 0) + 1);
  });
  for (const [key, count] of disagree) {
    const [got, expected] = key.split("|") as [keyof typeof OF, keyof typeof OF];
    const where =
      expected === "second"
        ? "the cell reverses (E < 0)"
        : expected === "first"
          ? "the cell runs as written (E > 0)"
          : "no current flows (E = 0)";
    found.push(
      `the recompute's anode is ${OF[got]} at ${count} states where ${where}: the 3D cell would draw the wrong polarity`,
    );
  }
  return found;
}

/** The Nernst sims in scope, each read once, and how many Modules were looked in. */
function nernstInScope(input: GateInput) {
  const files = courseFiles(input);
  return {
    files,
    sims: files
      .filter((f) => f.collection === "sims")
      .map((file) => ({ file, read: readSim(file) }))
      .filter(({ read }) => read.raw?.kind === "nernst"),
    modules: files.filter((f) => f.collection === "modules").length,
  };
}

async function nernstRun(input: GateInput) {
  const { files, sims, modules } = nernstInScope(input);
  const coverage = {
    modules,
    nernstSims: sims.length,
    stepThroughs: 0,
    states: 0,
    reversed: 0,
    sheetValues: 0,
    recomputedValues: 0,
  };
  const findings: Finding[] = [];
  for (const { file, read } of sims) {
    const block = (message: string) => findings.push({ outcome: "block", at: file.entry, message });
    const { sim: s, problem } = read;
    if (!s) {
      block(problem);
      continue;
    }
    if (!isLive(s)) {
      coverage.stepThroughs += 1;
      continue;
    }
    if (s.kind !== "nernst") continue;
    const module = moduleOf(file.entry) ?? "";
    const logEntry = recomputeLogEntry(module, nameOf(file.entry));
    const logPath = join(input.contentDir, logEntry);
    if (!existsSync(logPath)) {
      block(
        `no recompute log at ${logEntry}: a sim ships live only when an independent recompute checks it; if its model can't be recomputed, mark it recompute: none`,
      );
      continue;
    }
    let log;
    try {
      log = nernstLog.safeParse(JSON.parse(readFileSync(logPath, "utf8")));
    } catch (error) {
      block(`can't read the recompute log ${logEntry}: ${(error as Error).message}`);
      continue;
    }
    if (!log.success) {
      block(`the recompute log ${logEntry} isn't one: ${problems(log.error)}`);
      continue;
    }
    const example = s.worked === undefined ? undefined : workedExample(files, module, s.worked);
    if (typeof example === "string") {
      block(example);
      continue;
    }
    // The sheet, three ways, with the sweep left out of it.
    const { sweep, ...recompute } = log.data;
    const sheet = threeWay(s as LiveSim, recompute, example?.sheet);
    coverage.sheetValues += sheet.sheetValues;
    coverage.recomputedValues += sheet.recomputedValues;
    for (const p of sheet.problems)
      findings.push({
        outcome: p.outcome,
        at: p.on === "sheet" && example ? example.entry : file.entry,
        message: p.message,
      });
    // The whole slider grid.
    coverage.states += sweep.length;
    coverage.reversed += sweep.filter(
      (state) => cellPotential(s.model, state.inputs as unknown as Inputs).E < 0,
    ).length;
    for (const message of compareSweep(s.model, s.tune, sweep)) block(message);
  }
  return { coverage, findings };
}

interface NernstSite {
  contentDir: string;
  simEntry: string;
  logEntry: string;
  workedEntry?: string;
  sim: LiveSim & { kind: "nernst" };
}

/** A scratch copy of the Course with `plant` run on its first live Nernst sim. Throws when there is none. */
function plantInNernst(good: GateInput, scratch: string, plant: (site: NernstSite) => void): GateInput {
  const copy = courseCopy(good, scratch);
  const { files, sims } = nernstInScope(copy);
  for (const { file, read } of sims) {
    const { sim } = read;
    if (!sim || !isLive(sim) || sim.kind !== "nernst") continue;
    const module = moduleOf(file.entry) ?? "";
    const example = sim.worked && workedExample(files, module, sim.worked);
    plant({
      contentDir: copy.contentDir,
      simEntry: file.entry,
      logEntry: recomputeLogEntry(module, nameOf(file.entry)),
      ...(example && typeof example !== "string" ? { workedEntry: example.entry } : {}),
      sim: sim as LiveSim & { kind: "nernst" },
    });
    return copy;
  }
  throw new Error(`no live Nernst sim in ${good.contentDir} to plant a negative control in`);
}

const readLog = (site: NernstSite) =>
  JSON.parse(readFileSync(join(site.contentDir, site.logEntry), "utf8")) as NernstLog;
const writeLog = (site: NernstSite, log: unknown) =>
  writeFileSync(join(site.contentDir, site.logEntry), JSON.stringify(log));

export const nernstGate: Gate = {
  id: "nernst",
  checks:
    "every live Nernst sim three ways at the sheet, its whole slider grid (9 points each) against the independent recompute, and the cell's polarity (anode, electron flow) against the recompute's own",
  points: ["job", "deploy"],
  run: nernstRun,
  controls: [
    {
      defect: "a recompute that disagrees with the engine on a sheet value",
      plant: (good, scratch) =>
        plantInNernst(good, scratch, (site) => {
          const log = readLog(site);
          // Five whole units off: past the ±1 in the last digit of even a sheet that prints integers.
          log.values["E"] = (log.values["E"] ?? 0) + 5 * Math.max(1, Math.abs(log.values["E"] ?? 0));
          writeLog(site, log);
        }),
    },
    {
      defect: "a sheet value the engine and the recompute agree against, which only the Owner can rule",
      expect: "checkpoint",
      plant: (good, scratch) =>
        plantInNernst(good, scratch, ({ contentDir, workedEntry, sim }) => {
          if (!workedEntry) throw new Error("the live sim names no Worked example to plant a sheet value in");
          const path = join(contentDir, workedEntry);
          const example = readStructured(readFileSync(path, "utf8"), workedEntry, ignoreMath) as {
            artefact: { rows: string[][] };
          };
          const cell = Object.entries(sim.sheet).find(([, quantity]) => quantity === "E")?.[0];
          if (!cell) throw new Error("the live sim maps no sheet cell to E");
          const { row, col } = parseCell(cell);
          const printed = readPrinted(example.artefact.rows[row]?.[col] ?? "");
          if (typeof printed === "string") throw new Error(`sheet cell ${cell}: ${printed}`);
          // Five in the last printed digit: past the ±1 a hand may round by.
          const off = printed.value + 5 * 10 ** -printed.decimals;
          (example.artefact.rows[row] as string[])[col] = printAt(off, printed.decimals).replace("−", "-");
          writeFileSync(path, JSON.stringify(example));
        }),
    },
    {
      defect: "a recompute sweep 1 mV off the engine at one state",
      plant: (good, scratch) =>
        plantInNernst(good, scratch, (site) => {
          const log = readLog(site);
          const state = log.sweep[400];
          if (!state) throw new Error("the recompute's sweep has no state 400");
          state.E += 0.001;
          writeLog(site, log);
        }),
    },
    {
      defect: "a recompute whose anode never leaves the first electrode",
      plant: (good, scratch) =>
        plantInNernst(good, scratch, (site) => {
          const log = readLog(site);
          if (!log.sweep.some((state) => state.E < 0))
            throw new Error("the sweep has no state where the cell reverses");
          for (const state of log.sweep) if (state.E < 0) state.anode = "first";
          writeLog(site, log);
        }),
    },
    {
      defect: "a sweep that leaves out the temperature slider",
      plant: (good, scratch) =>
        plantInNernst(good, scratch, (site) => {
          const log = readLog(site);
          // Only the states at the temperature nearest the example's: 81 of the 729.
          const open = site.sim.start["T"];
          const nearest = log.sweep.reduce((best, s) => {
            const t = s.inputs["T"] as number;
            return Math.abs(t - open) < Math.abs(best - open) ? t : best;
          }, Infinity);
          log.sweep = log.sweep.filter((s) => s.inputs["T"] === nearest);
          writeLog(site, log);
        }),
    },
    {
      defect: "a live Nernst sim with no recompute log",
      plant: (good, scratch) =>
        plantInNernst(good, scratch, ({ contentDir, logEntry }) => rmSync(join(contentDir, logEntry))),
    },
  ],
};
