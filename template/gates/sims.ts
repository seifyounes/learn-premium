// The Agent-built sim gates, per job. `sim-numbers` checks every number a live sim gives three
// ways (`src/sims/three-way.ts`): the engine replayed here in Node, the independent recompute's
// log in the Course's build records, and the Worked example's sheet at its printed precision.
// `truth-table` does the same for a logic sim, bit for bit over every row of its truth table.
// `tools` holds every sim to the five eligibility checks a tool must pass to ship.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { stringify } from "yaml";
import { SIM_KINDS, sim as simSchema, worked as workedSchema } from "../src/content/contract.ts";
import { moduleOf } from "../src/content/layout.ts";
import { readStructured } from "../src/content/loaders.ts";
import { numbersIn } from "../src/provenance/values.ts";
import { engineQuantities, isLive, KINDS, type LiveSim, type Sim, type SimKind } from "../src/sims/kinds.ts";
import { printAt, readPrinted } from "../src/sims/precision.ts";
import { recomputeLog, threeWay } from "../src/sims/three-way.ts";
import { snap } from "../src/sims/tuning.ts";
import { parseCell } from "../src/worked/cells.ts";
import { courseCopy, courseFiles, courseWith, type CourseFile } from "./course-files.ts";
import type { Finding, Gate, GateInput } from "./runner.ts";

const ignoreMath = () => {};
const read = (file: CourseFile) => readStructured(readFileSync(file.path, "utf8"), file.entry, ignoreMath);
/** A Zod error's issues, one `path: message` each. */
export const problems = (error: { issues: { path: PropertyKey[]; message: string }[] }) =>
  error.issues.map((i) => `${i.path.join(".") || "(file)"}: ${i.message}`).join("; ");

/** Where the independent recompute logs one sim: in the Course's build records, by Module and name. */
export const recomputeLogEntry = (module: string, name: string) => `build-records/recompute/${module}/${name}.json`;
/** A content file's name without its folder or extension: a sim's name. */
export const nameOf = (entry: string) => basename(entry, extname(entry));

/**
 * The sims in scope, and how many Modules were looked in. A Module with no sim has nothing to
 * check and passes, the gate having looked in it; a Module that doesn't exist covers nothing.
 */
function simsInScope(input: GateInput) {
  const files = courseFiles(input);
  return {
    files,
    sims: files.filter((f) => f.collection === "sims"),
    modules: files.filter((f) => f.collection === "modules").length,
  };
}

/** A sim file as written, and as the content contract reads it, or why it can't be checked. */
function readSim(
  file: CourseFile,
):
  | { raw: Record<string, unknown>; sim: Sim; problem?: never }
  | { raw?: Record<string, unknown>; sim?: never; problem: string } {
  let raw: Record<string, unknown>;
  try {
    raw = read(file);
  } catch (error) {
    return { problem: `can't check the sim: ${(error as Error).message}` };
  }
  const parsed = simSchema.safeParse(raw);
  return parsed.success
    ? { raw, sim: parsed.data }
    : { raw, problem: `can't check the sim: the content contract reports ${problems(parsed.error)}` };
}

/** Writes structured content back the way its file is written, JSON or YAML. */
const writeStructured = (path: string, data: unknown) =>
  writeFileSync(path, extname(path) === ".json" ? JSON.stringify(data) : stringify(data));

type ThreeWayGate = (typeof KINDS)[SimKind]["checkedBy"];

/**
 * The three-way check over the sims `gate` checks: each live one's engine against its recompute
 * log and its Worked example's sheet. A sim no recompute can check ships as its step-through.
 */
async function threeWayRun(input: GateInput, gate: ThreeWayGate) {
  const { files, sims: all, modules } = simsInScope(input);
  // Each file is read once. One whose kind can't be read is the number gate's to report, once.
  const sims = all
    .map((file) => ({ file, read: readSim(file) }))
    .filter(({ read }) => {
      const kind = read.raw?.kind;
      const known = typeof kind === "string" && kind in KINDS;
      return known ? KINDS[kind as SimKind].checkedBy === gate : gate === "sim-numbers";
    });
  const coverage = { modules, sims: sims.length, sheetValues: 0, recomputedValues: 0, stepThroughs: 0 };
  const findings: Finding[] = [];
  for (const { file, read } of sims) {
    const block = (message: string) => findings.push({ outcome: "block", at: file.entry, message });
    const { sim: s, problem } = read;
    if (!s) {
      block(problem);
      continue;
    }
    // A sim no recompute can check never ships live: the page shows its step-through.
    if (!isLive(s)) {
      coverage.stepThroughs += 1;
      continue;
    }
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
      log = recomputeLog.safeParse(JSON.parse(readFileSync(logPath, "utf8")));
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
    const result = threeWay(s, log.data, example?.sheet, { exact: gate === "truth-table" });
    coverage.sheetValues += result.sheetValues;
    coverage.recomputedValues += result.recomputedValues;
    for (const p of result.problems) {
      findings.push({
        outcome: p.outcome,
        at: p.on === "sheet" && example ? example.entry : file.entry,
        message: p.message,
      });
    }
  }
  return { coverage, findings };
}

export const simNumbers: Gate = {
  id: "sim-numbers",
  checks:
    "every number a live sim's sheet shows agrees three ways (engine, independent recompute, the sheet at its printed precision)",
  points: ["job", "deploy"],
  run: (input) => threeWayRun(input, "sim-numbers"),
  controls: [
    {
      defect: "a recompute log that disagrees with the engine on a sheet value",
      plant: (good, scratch) =>
        plantInLiveSim(good, scratch, ({ contentDir, logEntry, sim }) => {
          const path = join(contentDir, logEntry);
          const log = JSON.parse(readFileSync(path, "utf8")) as { values: Record<string, number> };
          const quantity = firstSheetQuantity(sim);
          // Five whole units off: past the ±1 in the last digit of even a sheet that prints integers.
          const value = log.values[quantity] ?? 0;
          log.values[quantity] = value + 5 * Math.max(1, Math.abs(value));
          writeFileSync(path, JSON.stringify(log));
        }),
    },
    {
      defect: "a sheet value the engine and the recompute agree against, which only the Owner can rule",
      expect: "checkpoint",
      plant: (good, scratch) =>
        plantInLiveSim(good, scratch, ({ contentDir, workedEntry, sim }) => {
          if (!workedEntry) throw new Error("the live sim names no Worked example to plant a sheet value in");
          const path = join(contentDir, workedEntry);
          const example = readStructured(readFileSync(path, "utf8"), workedEntry, ignoreMath) as {
            artefact: { rows: string[][] };
          };
          const [cell] = Object.keys(sim.sheet);
          if (!cell) throw new Error("the live sim maps no sheet cell");
          const { row, col } = parseCell(cell);
          const printed = readPrinted(example.artefact.rows[row]?.[col] ?? "");
          if (typeof printed === "string") throw new Error(`sheet cell ${cell}: ${printed}`);
          // Five in the last printed digit: past the ±1 a hand may round by.
          const off = printed.value + 5 * 10 ** -printed.decimals;
          (example.artefact.rows[row] as string[])[col] = printAt(off, printed.decimals).replace("−", "-");
          writeStructured(path, example);
        }),
    },
    {
      defect: "a sim that opens on other inputs than the recompute took from the Materials",
      plant: (good, scratch) =>
        plantInLiveSim(good, scratch, ({ contentDir, simEntry, sim }) => {
          const path = join(contentDir, simEntry);
          const [input, range] = Object.entries(sim.tune)[0] ?? [];
          if (!input || !range) throw new Error("the live sim tunes nothing");
          const opens = (sim.start as Record<string, number>)[input];
          const raw = { ...sim, start: { ...sim.start, [input]: opens === range.max ? range.min : range.max } };
          writeStructured(path, raw);
        }),
    },
    {
      defect: "a live sim with no recompute log",
      plant: (good, scratch) =>
        plantInLiveSim(good, scratch, ({ contentDir, logEntry }) => rmSync(join(contentDir, logEntry))),
    },
  ],
};

/** A truth table's sheet cell, read back as the bit it prints. */
const bitIn = (text: string) => {
  const printed = readPrinted(text);
  if (typeof printed === "string") throw new Error(printed);
  return printed.value;
};

export const truthTableGate: Gate = {
  id: "truth-table",
  checks:
    "every row of a logic sim's truth table agrees bit for bit three ways (engine, independent recompute, the Worked example's sheet)",
  points: ["job", "deploy"],
  run: (input) => threeWayRun(input, "truth-table"),
  controls: [
    {
      defect: "a recompute log that disagrees with the engine on one row of the sheet",
      plant: (good, scratch) =>
        plantInLiveSim(
          good,
          scratch,
          ({ contentDir, logEntry, sim }) => {
            const path = join(contentDir, logEntry);
            const log = JSON.parse(readFileSync(path, "utf8")) as { values: Record<string, number> };
            const quantity = firstSheetQuantity(sim);
            log.values[quantity] = 1 - (log.values[quantity] ?? 0);
            writeFileSync(path, JSON.stringify(log));
          },
          "truth-table",
        ),
    },
    {
      defect: "a sheet bit the engine and the recompute agree against, which only the Owner can rule",
      expect: "checkpoint",
      plant: (good, scratch) =>
        plantInLiveSim(
          good,
          scratch,
          ({ contentDir, workedEntry, sim }) => {
            if (!workedEntry) throw new Error("the live sim names no Worked example to plant a sheet bit in");
            const path = join(contentDir, workedEntry);
            const example = readStructured(readFileSync(path, "utf8"), workedEntry, ignoreMath) as {
              artefact: { rows: string[][] };
            };
            const [cell] = Object.keys(sim.sheet);
            if (!cell) throw new Error("the live sim maps no sheet cell");
            const { row, col } = parseCell(cell);
            const rowCells = example.artefact.rows[row] as string[];
            rowCells[col] = String(1 - bitIn(rowCells[col] ?? ""));
            writeStructured(path, example);
          },
          "truth-table",
        ),
    },
    {
      defect: "a recompute log that leaves out a row of the truth table",
      plant: (good, scratch) =>
        plantInLiveSim(
          good,
          scratch,
          ({ contentDir, logEntry, sim }) => {
            const path = join(contentDir, logEntry);
            const log = JSON.parse(readFileSync(path, "utf8")) as { values: Record<string, number> };
            // A row off the sheet, so only the completeness check can catch it.
            const onSheet = new Set(Object.values(sim.sheet));
            const dropped = Object.keys(log.values).find((q) => !onSheet.has(q));
            if (!dropped) throw new Error("every row of the recompute log is on the sheet");
            const values = Object.fromEntries(Object.entries(log.values).filter(([q]) => q !== dropped));
            writeFileSync(path, JSON.stringify({ ...log, values }));
          },
          "truth-table",
        ),
    },
    {
      defect: "a live logic sim with no recompute log",
      plant: (good, scratch) =>
        plantInLiveSim(good, scratch, ({ contentDir, logEntry }) => rmSync(join(contentDir, logEntry)), "truth-table"),
    },
  ],
};

const TEMPLATE_DIR = resolve(import.meta.dirname, "..");

/**
 * Each sim kind's view in this template. The step-through every kind falls back to has its own.
 * The tools gate reads them: a view draws only with the pad's tokens, and handles pointers, never
 * a mouse alone.
 */
const SHARED_VIEW = ["src/islands/sim/board.ts", "src/islands/sim/controls.tsx"];
export const TOOLKIT: Record<SimKind, readonly string[]> = {
  "gradient-descent": ["src/islands/GradientDescentSim.tsx", "src/islands/sim/descent-boards.ts", ...SHARED_VIEW],
  logic: ["src/islands/LogicSim.tsx", "src/islands/sim/Schematic.tsx"],
  tangent: ["src/islands/TangentSim.tsx", "src/islands/sim/tangent-board.ts", ...SHARED_VIEW],
  "plane-wall": [
    "src/islands/PlaneWallSim.tsx",
    "src/islands/sim/wall-board.ts",
    "src/islands/sim/heatmap.ts",
    ...SHARED_VIEW,
  ],
};
const STEP_THROUGH_VIEW = ["src/islands/StepThrough.tsx", "src/islands/worked/PlotFigure.tsx"];
/** A Pyodide tool's view: its preview and live plot draw on the sheet's plotted figure. */
const PYTHON_VIEW = ["src/islands/PythonTool.tsx", "src/islands/worked/PlotFigure.tsx"];

const COLOUR_LITERAL = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/gi;
const MOUSE_ONLY =
  /\bon(?:Mouse|mouse)(?:Down|Move|Up|Enter|Leave|Over|Out)\b|["']mouse(?:down|move|up|enter|leave|over|out)["']/g;

/** What a view's source breaks of the pad-frame and touch checks, one problem each. */
export function eligibilityOfSource(source: string): string[] {
  const found: string[] = [];
  for (const [colour] of source.matchAll(COLOUR_LITERAL))
    found.push(`doesn't take the pad frame: it names the colour ${colour} instead of reading the pad's tokens`);
  for (const [handler] of source.matchAll(MOUSE_ONLY))
    found.push(`isn't touch-usable: ${handler} handles a mouse only (use pointer events)`);
  return found;
}

/** A view's problems: a file the template lacks (not embeddable), or what its source breaks. */
function viewProblems(files: readonly string[]): string[] {
  return files.flatMap((file) => {
    const path = join(TEMPLATE_DIR, file);
    if (!existsSync(path)) return [`isn't embeddable: the template has no view ${file}`];
    return eligibilityOfSource(readFileSync(path, "utf8")).map((p) => `${file} ${p}`);
  });
}

/** Where the engine is run headlessly: the example's values, then each slider alone at its min, mid and max. */
function samples(s: LiveSim): { where: string; inputs: Record<string, number> }[] {
  const all = [{ where: "the example's values", inputs: {} }];
  for (const [input, range] of Object.entries(s.tune)) {
    const ends = { min: range.min, mid: snap((range.min + range.max) / 2, range), max: range.max };
    for (const [end, value] of Object.entries(ends))
      all.push({ where: `${input} = ${value} (its slider's ${end})`, inputs: { [input]: value } });
  }
  return all;
}

/** Every number in a model, however it nests. */
const numbersOf = (value: unknown): number[] => {
  if (Array.isArray(value)) return value.flatMap(numbersOf);
  if (value && typeof value === "object") return Object.values(value).flatMap(numbersOf);
  return typeof value === "number" ? [value] : [];
};

export const toolsGate: Gate = {
  id: "tools",
  checks:
    "every sim is a Toolkit tool that passes the five eligibility checks: embeddable, takes the pad frame, touch-usable, writable from the Materials, checkable headlessly",
  points: ["job", "deploy"],
  async run(input) {
    const { files, sims, modules } = simsInScope(input);
    const python = files.filter((f) => f.collection === "python");
    const coverage = { modules, sims: sims.length, pythonTools: python.length, kinds: 0, checks: 0, engineSamples: 0 };
    const findings: Finding[] = [];
    const views = new Map<string, string[]>();
    /** The sim kinds checked live: a step-through or a Pyodide tool is no kind. */
    const kinds = new Set<string>();
    const viewOf = (key: string, files: readonly string[]) => {
      let found = views.get(key);
      if (!found) {
        found = viewProblems(files);
        views.set(key, found);
      }
      return found;
    };
    for (const file of sims) {
      const block = (message: string) => findings.push({ outcome: "block", at: file.entry, message });
      const { raw, sim: s, problem } = readSim(file);
      // A kind this template doesn't ship is the tools gate's to name, before the contract's verdict.
      if (raw && !(SIM_KINDS as readonly unknown[]).includes(raw.kind)) {
        block(
          `${JSON.stringify(raw.kind)} isn't a tool this template ships (it ships: ${SIM_KINDS.join(", ")}); PhET and Falstad appear only as credited links, never as a tool`,
        );
        continue;
      }
      if (!s) {
        block(problem);
        continue;
      }
      const live = isLive(s);
      coverage.checks += 5;
      // 1–3, embeddable, takes the pad frame and touch-usable: properties of the view it ships in.
      if (live) kinds.add(s.kind);
      (live ? viewOf(s.kind, TOOLKIT[s.kind]) : viewOf("step-through", STEP_THROUGH_VIEW)).forEach(block);
      // 4, writable by the builder from the Materials: the model's numbers are the Materials' own.
      const fromMaterials = new Set(
        [...s.provenance.stated, ...s.provenance.scaled].flatMap((v) => numbersIn(v).map((n) => n.value)),
      );
      const invented = [...new Set(numbersOf(s.model))].filter((n) => !fromMaterials.has(Math.abs(n)));
      if (invented.length > 0) {
        block(
          `not writable from the Materials: the model's ${invented.join(", ")} are not tagged stated or scaled, so they don't come from the Materials`,
        );
      }
      // 5, checkable headlessly: the engine runs here, in Node, to finite numbers wherever a
      // student can take it. A step-through runs no engine.
      if (!live) continue;
      for (const { where, inputs } of samples(s)) {
        coverage.engineSamples += 1;
        let values: Record<string, number>;
        try {
          values = engineQuantities(s, inputs);
        } catch (error) {
          block(`not checkable headlessly: at ${where} the engine throws: ${(error as Error).message}`);
          break;
        }
        const broken = Object.entries(values).filter(([, v]) => !Number.isFinite(v));
        if (broken.length > 0) {
          block(
            `not checkable headlessly: at ${where} the engine gives ${broken.map(([q, v]) => `${q} = ${v}`).join(", ")}`,
          );
          break;
        }
      }
    }
    // A Pyodide tool runs real Python, checked headlessly by its build-time preview; its view must
    // take the pad frame and answer touch like a sim's.
    if (python.length > 0) {
      const problems = viewOf("python", PYTHON_VIEW);
      for (const file of python) {
        coverage.checks += 2;
        problems.forEach((message) => findings.push({ outcome: "block", at: file.entry, message }));
      }
    }
    coverage.kinds = kinds.size;
    return { coverage, findings };
  },
  controls: [
    {
      defect: "a PhET simulation used as a tool",
      plant: (good, scratch) =>
        courseWith(good, scratch, { "sims/900.json": JSON.stringify({ ...plantedSim(), kind: "phet" }) }),
    },
    {
      defect: "a sim whose model the Materials don't give",
      plant: (good, scratch) =>
        courseWith(good, scratch, {
          "sims/900.json": JSON.stringify({
            ...plantedSim(),
            provenance: { assumed: ["$(0, 1)$, $(1, 3)$, $(2, 4)$"] },
          }),
        }),
    },
    {
      defect: "a sim whose engine gives no finite numbers (its data has a single x)",
      plant: (good, scratch) =>
        courseWith(good, scratch, {
          "sims/900.json": JSON.stringify({
            ...plantedSim(),
            model: {
              data: [
                [1, 1],
                [1, 2],
                [1, 3],
              ],
            },
            provenance: { stated: ["$(1, 1)$, $(1, 2)$, $(1, 3)$"] },
          }),
        }),
    },
  ],
};

/** The Worked example a sim names in its Module, with its sheet, or why it can't be read. */
function workedExample(files: CourseFile[], module: string, number: string) {
  const file = files.find(
    (f) => f.collection === "worked" && moduleOf(f.entry) === module && nameOf(f.entry) === number,
  );
  if (!file) return `the sim names Worked example ${number}, which Module ${module} doesn't have`;
  const parsed = workedSchema.safeParse(read(file));
  if (!parsed.success)
    return `can't read Worked example ${file.entry}, so the sheet can't be checked: ${problems(parsed.error)}`;
  const { artefact, provenance } = parsed.data;
  return {
    entry: file.entry,
    sheet: {
      rows: artefact.rows,
      divergences: provenance.divergences.map((d) => d.value),
      slips: provenance.slips.map((s) => s.sheet),
    },
  };
}

const firstSheetQuantity = (s: LiveSim) => {
  const [quantity] = Object.values(s.sheet);
  if (!quantity) throw new Error("the live sim maps no sheet cell");
  return quantity;
};

/** Where a negative control plants its defect: a live sim's files in a scratch copy of the Course. */
interface PlantSite {
  contentDir: string;
  simEntry: string;
  logEntry: string;
  workedEntry?: string;
  sim: LiveSim;
}

/**
 * A scratch copy of the Course with `plant` run on its first live sim that checks a sheet. Throws
 * when there is none, so a control can't silently check nothing.
 */
function plantInLiveSim(
  good: GateInput,
  scratch: string,
  plant: (site: PlantSite) => void,
  gate: ThreeWayGate = "sim-numbers",
): GateInput {
  const copy = courseCopy(good, scratch);
  const { files, sims } = simsInScope(copy);
  for (const file of sims) {
    const { sim } = readSim(file);
    if (!sim || !isLive(sim) || Object.keys(sim.sheet).length === 0 || KINDS[sim.kind].checkedBy !== gate) continue;
    const module = moduleOf(file.entry) ?? "";
    const example = sim.worked && workedExample(files, module, sim.worked);
    plant({
      contentDir: copy.contentDir,
      simEntry: file.entry,
      logEntry: recomputeLogEntry(module, nameOf(file.entry)),
      ...(example && typeof example !== "string" ? { workedEntry: example.entry } : {}),
      sim,
    });
    return copy;
  }
  throw new Error(
    `no live sim the ${gate} gate checks on a sheet in ${good.contentDir} to plant a negative control in`,
  );
}

/** A small gradient-descent sim that keeps the contract; tests and controls break one rule of it. */
export function plantedSim(): Record<string, unknown> & {
  recompute: string;
  worked?: string;
  start?: unknown;
  tune?: unknown;
} {
  return {
    kind: "gradient-descent",
    title: "Planted descent",
    caption: "Planted line fit",
    recompute: "independent",
    worked: "1",
    sheet: { B2: "theta0[1]" },
    model: {
      data: [
        [0, 1],
        [1, 3],
        [2, 4],
      ],
    },
    start: { theta0: 0, theta1: 0, alpha: 0.1, iterations: 2 },
    tune: {
      theta0: { min: -1, max: 3, step: 0.1 },
      theta1: { min: -1, max: 3, step: 0.1 },
      alpha: { min: 0.01, max: 1, step: 0.01 },
      iterations: { min: 0, max: 20, step: 1 },
    },
  };
}
