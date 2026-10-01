// The Agent-built sim gates, per job. `sim-numbers` checks every number a live sim gives three
// ways (`src/sims/three-way.ts`): the engine replayed here in Node, the independent recompute's
// log in the Course's build records, and the Worked example's sheet at its printed precision.
// `tools` holds every sim to the five eligibility checks a tool must pass to ship.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { stringify } from "yaml";
import { SIM_KINDS, sim as simSchema, worked as workedSchema } from "../src/content/contract.ts";
import { moduleOf } from "../src/content/layout.ts";
import { readStructured } from "../src/content/loaders.ts";
import { numbersIn } from "../src/provenance/values.ts";
import { engineQuantities, isLive, type LiveSim, type SimKind } from "../src/sims/kinds.ts";
import { printAt, readPrinted } from "../src/sims/precision.ts";
import { recomputeLog, threeWay } from "../src/sims/three-way.ts";
import { snap } from "../src/sims/tuning.ts";
import { parseCell } from "../src/worked/cells.ts";
import { courseCopy, courseFiles, courseWith, type CourseFile } from "./course-files.ts";
import type { Finding, Gate, GateInput } from "./runner.ts";

const ignoreMath = () => {};
const read = (file: CourseFile) => readStructured(readFileSync(file.path, "utf8"), file.entry, ignoreMath);
const problems = (error: { issues: { path: PropertyKey[]; message: string }[] }) =>
  error.issues.map((i) => `${i.path.join(".") || "(file)"}: ${i.message}`).join("; ");

/** Where the independent recompute logs one sim: in the Course's build records, by Module and name. */
export const recomputeLogEntry = (module: string, name: string) => `build-records/recompute/${module}/${name}.json`;
const nameOf = (entry: string) => basename(entry, extname(entry));

export const simNumbers: Gate = {
  id: "sim-numbers",
  checks:
    "every number a live sim's sheet shows agrees three ways (engine, independent recompute, the sheet at its printed precision)",
  points: ["job", "deploy"],
  async run(input) {
    const files = courseFiles(input);
    const sims = files.filter((f) => f.collection === "sims");
    // A Module with no sim has nothing to check, and passes: the gate still looked in it.
    const modules = files.filter((f) => f.collection === "modules").length;
    const coverage = { modules, sims: sims.length, sheetValues: 0, recomputedValues: 0, stepThroughs: 0 };
    const findings: Finding[] = [];
    for (const file of sims) {
      const block = (message: string) => findings.push({ outcome: "block", at: file.entry, message });
      let parsed;
      try {
        parsed = simSchema.safeParse(read(file));
      } catch (error) {
        block(`can't check the sim: ${(error as Error).message}`);
        continue;
      }
      if (!parsed.success) {
        block(`can't check the sim: the content contract reports ${problems(parsed.error)}`);
        continue;
      }
      const s = parsed.data;
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
      const result = threeWay(s, log.data, example?.sheet);
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
  },
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
          writeFileSync(path, extname(path) === ".json" ? JSON.stringify(example) : stringify(example));
        }),
    },
    {
      defect: "a sim that opens on other inputs than the recompute took from the Materials",
      plant: (good, scratch) =>
        plantInLiveSim(good, scratch, ({ contentDir, simEntry, sim }) => {
          const path = join(contentDir, simEntry);
          const { min, max } = sim.tune.theta0;
          const raw = { ...sim, start: { ...sim.start, theta0: sim.start.theta0 === max ? min : max } };
          writeFileSync(path, extname(path) === ".json" ? JSON.stringify(raw) : stringify(raw));
        }),
    },
    {
      defect: "a live sim with no recompute log",
      plant: (good, scratch) =>
        plantInLiveSim(good, scratch, ({ contentDir, logEntry }) => rmSync(join(contentDir, logEntry))),
    },
  ],
};

const TEMPLATE_DIR = resolve(import.meta.dirname, "..");

/**
 * Each sim kind's view in this template. The step-through every kind falls back to has its own.
 * The tools gate reads them: a view draws only with the pad's tokens, and handles pointers, never
 * a mouse alone.
 */
export const TOOLKIT: Record<SimKind, readonly string[]> = {
  "gradient-descent": ["src/islands/GradientDescentSim.tsx", "src/islands/sim/descent-boards.ts"],
};
const STEP_THROUGH_VIEW = ["src/islands/StepThrough.tsx", "src/islands/worked/PlotFigure.tsx"];

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
    const files = courseFiles(input);
    const sims = files.filter((f) => f.collection === "sims");
    const modules = files.filter((f) => f.collection === "modules").length;
    const coverage = { modules, sims: sims.length, kinds: 0, checks: 0, engineSamples: 0 };
    const findings: Finding[] = [];
    const views = new Map<string, string[]>();
    const viewOf = (key: string, files: readonly string[]) => {
      let found = views.get(key);
      if (!found) {
        found = viewProblems(files);
        views.set(key, found);
        if (key !== "step-through") coverage.kinds += 1;
      }
      return found;
    };
    for (const file of sims) {
      const block = (message: string) => findings.push({ outcome: "block", at: file.entry, message });
      let raw: Record<string, unknown>;
      try {
        raw = read(file);
      } catch (error) {
        block(`can't check the sim: ${(error as Error).message}`);
        continue;
      }
      if (!(SIM_KINDS as readonly unknown[]).includes(raw.kind)) {
        block(
          `${JSON.stringify(raw.kind)} isn't a tool this template ships (it ships: ${SIM_KINDS.join(", ")}); PhET and Falstad appear only as credited links, never as a tool`,
        );
        continue;
      }
      const parsed = simSchema.safeParse(raw);
      if (!parsed.success) {
        block(`can't check the sim: the content contract reports ${problems(parsed.error)}`);
        continue;
      }
      const s = parsed.data;
      const live = isLive(s);
      coverage.checks += 5;
      // 1–3, embeddable, takes the pad frame and touch-usable: properties of the view it ships in.
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
    sheet: { rows: artefact.rows, divergences: provenance.divergences.map((d) => d.value) },
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
function plantInLiveSim(good: GateInput, scratch: string, plant: (site: PlantSite) => void): GateInput {
  const copy = courseCopy(good, scratch);
  const files = courseFiles(copy);
  for (const file of files.filter((f) => f.collection === "sims")) {
    const parsed = simSchema.safeParse(read(file));
    const sim = parsed.success && isLive(parsed.data) ? parsed.data : undefined;
    if (!sim || Object.keys(sim.sheet).length === 0) continue;
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
  throw new Error(`no live sim checking a sheet in ${good.contentDir} to plant a negative control in`);
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
