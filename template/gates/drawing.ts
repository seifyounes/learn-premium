// The Drawing gate, per job: every schematic sim's drawing, made by the layout core from the sim's
// model and Layout hints exactly as the page makes it, passes every check against its model and
// against the Blind reader's figure reading (`src/sims/layout/check.ts`). On every build it also
// runs its negative control: each drawing broken eight known ways (`src/sims/layout/mutants.ts`)
// must fail, or the gate can't see what it claims to and blocks. Every check blocks.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { stringify } from "yaml";
import { sim as simSchema } from "../src/content/contract.ts";
import { moduleOf } from "../src/content/layout.ts";
import { readStructured } from "../src/content/loaders.ts";
import { isSchematic, type SchematicSim } from "../src/sims/kinds.ts";
import { checkDrawing, figureReading, type FigureReading } from "../src/sims/layout/check.ts";
import { layOut } from "../src/sims/layout/layout.ts";
import { mutantsOf } from "../src/sims/layout/mutants.ts";
import { courseCopy, courseFiles, type CourseFile } from "./course-files.ts";
import type { Finding, Gate, GateInput } from "./runner.ts";

const ignoreMath = () => {};
const nameOf = (entry: string) => basename(entry, extname(entry));
const problems = (error: { issues: { path: PropertyKey[]; message: string }[] }) =>
  error.issues.map((i) => `${i.path.join(".") || "(file)"}: ${i.message}`).join("; ");

/** Where the Blind reader's account of a sim's figure sits: in the build records, beside its recompute log. */
export const figureReadingEntry = (module: string, name: string) => `build-records/figure/${module}/${name}.json`;

/** A sim file as the content contract reads it, or why it can't be read. */
function readSim(file: CourseFile): { sim: SchematicSim | undefined; raw?: unknown; problem?: string } {
  let raw: unknown;
  try {
    raw = readStructured(readFileSync(file.path, "utf8"), file.entry, ignoreMath);
  } catch (error) {
    return { sim: undefined, problem: `can't check the drawing: ${(error as Error).message}` };
  }
  const parsed = simSchema.safeParse(raw);
  if (!parsed.success) {
    // Only a sim that means to be drawn is this gate's: one with Layout hints.
    const hinted = !!raw && typeof raw === "object" && "layout" in raw;
    return {
      sim: undefined,
      raw,
      ...(hinted ? { problem: `can't check the drawing: the content contract reports ${problems(parsed.error)}` } : {}),
    };
  }
  return { sim: isSchematic(parsed.data) ? parsed.data : undefined, raw };
}

function readReading(contentDir: string, entry: string): FigureReading | string {
  const path = join(contentDir, entry);
  if (!existsSync(path))
    return `no figure reading at ${entry}: a Blind reader reads the Professor's figure for every schematic sim, so the model can be checked against it`;
  try {
    const parsed = figureReading.safeParse(JSON.parse(readFileSync(path, "utf8")));
    return parsed.success ? parsed.data : `the figure reading ${entry} isn't one: ${problems(parsed.error)}`;
  } catch (error) {
    return `can't read the figure reading ${entry}: ${(error as Error).message}`;
  }
}

export const drawingGate: Gate = {
  id: "drawing",
  checks:
    "every schematic sim's drawing matches its model (parts, connectivity from geometry alone, labels, conventions, legibility, tidiness), its model matches the Blind reader's figure, and the drawing matches the figure (arrangement, turn, label side, symbols, junction dots); a negative control of broken drawings is caught on every build",
  points: ["job", "deploy"],
  async run(input) {
    const files = courseFiles(input);
    const sims = files.filter((f) => f.collection === "sims");
    const coverage = {
      modules: files.filter((f) => f.collection === "modules").length,
      drawings: 0,
      checks: 0,
      mutantsCaught: 0,
    };
    const findings: Finding[] = [];
    for (const file of sims) {
      const block = (message: string) => findings.push({ outcome: "block", at: file.entry, message });
      const { sim, problem } = readSim(file);
      if (problem) {
        block(problem);
        continue;
      }
      if (!sim) continue;
      const module = moduleOf(file.entry) ?? "";
      const reading = readReading(input.contentDir, figureReadingEntry(module, nameOf(file.entry)));
      if (typeof reading === "string") {
        block(reading);
        continue;
      }
      coverage.drawings += 1;
      const drawing = layOut(sim.model, sim.layout);
      const verdict = checkDrawing(drawing, sim.model, reading);
      coverage.checks += verdict.checks.length;
      for (const c of verdict.checks) for (const p of c.problems) block(`${c.group}, ${c.id}: ${p}`);
      // The negative control, on this drawing: every mutant must fail the check it breaks.
      const { mutants, skipped } = mutantsOf(drawing, sim.model.nets);
      for (const mutant of mutants) {
        const failed = checkDrawing(mutant.drawing, sim.model, reading).checks.filter((c) => c.problems.length > 0);
        if (failed.some((c) => mutant.expect.includes(c.id))) coverage.mutantsCaught += 1;
        else
          block(
            `the negative control missed a mutant (${mutant.what}): it passed the ${mutant.expect.join(" and ")} check, so the gate can't see what it claims to`,
          );
      }
      // A mutant the drawing can't carry is fine only where the figure has nothing to break.
      for (const why of skipped)
        if (!why.startsWith("no-dot") && !why.startsWith("reversed"))
          block(`the negative control couldn't plant a mutant: ${why}`);
    }
    return { coverage, findings };
  },
  controls: [
    {
      defect: "Layout hints that mirror the figure left to right",
      plant: (good, scratch) =>
        plantInSchematicSim(good, scratch, ({ sim }) => {
          const xs = Object.values(sim.layout.parts).map((h) => h.at[0]);
          const span = Math.min(...xs) + Math.max(...xs);
          const parts = Object.fromEntries(
            Object.entries(sim.layout.parts).map(([id, h]) => [
              id,
              { ...h, at: [Math.round((span - h.at[0]) * 10) / 10, h.at[1]] },
            ]),
          );
          return { ...sim, layout: { ...sim.layout, parts } };
        }),
    },
    {
      defect: "a model that wires two gate inputs to each other's nets, unlike the figure",
      plant: (good, scratch) =>
        plantInSchematicSim(good, scratch, ({ sim }) => {
          // Two pins of different parts, on different nets, change places.
          const ends = sim.model.nets.map((n) => n.pins.at(-1) ?? "");
          const part = (pin: string) => pin.split(".")[0];
          const i = ends.findIndex((a, i) => ends.some((b, j) => j > i && part(a) !== part(b)));
          const a = ends[i];
          const b = ends.find((p, j) => j > i && part(p) !== part(a ?? ""));
          if (!a || !b) throw new Error("the sim's model has no two nets to rewire");
          const nets = sim.model.nets.map((n) => ({
            ...n,
            pins: n.pins.map((p) => (p === a ? b : p === b ? a : p)),
          }));
          return { ...sim, model: { ...sim.model, nets } };
        }),
    },
    {
      defect: "Layout hints that leave undotted a net the figure dots",
      plant: (good, scratch) =>
        plantInSchematicSim(good, scratch, ({ sim }) => ({ ...sim, layout: { ...sim.layout, dots: [] } })),
    },
    {
      defect: "a hand-placed coordinate in the Layout hints",
      plant: (good, scratch) =>
        plantInSchematicSim(good, scratch, ({ sim }) => {
          const [id, hint] = Object.entries(sim.layout.parts)[0] ?? [];
          if (!id || !hint) throw new Error("the sim has no layout hint to plant a coordinate in");
          return {
            ...sim,
            layout: { ...sim.layout, parts: { ...sim.layout.parts, [id]: { ...hint, x: 240, y: 180 } } },
          };
        }),
    },
    {
      defect: "a schematic sim with no figure reading",
      plant: (good, scratch) =>
        plantInSchematicSim(good, scratch, ({ contentDir, readingEntry, sim }) => {
          rmSync(join(contentDir, readingEntry));
          return sim;
        }),
    },
  ],
};

interface PlantSite {
  contentDir: string;
  readingEntry: string;
  sim: SchematicSim;
}

/**
 * A scratch copy of the Course with its first schematic sim rewritten by `plant`. Throws when there
 * is none, so a control can't silently check nothing.
 */
function plantInSchematicSim(good: GateInput, scratch: string, plant: (site: PlantSite) => unknown): GateInput {
  const copy = courseCopy(good, scratch);
  for (const file of courseFiles(copy).filter((f) => f.collection === "sims")) {
    const { sim } = readSim(file);
    if (!sim) continue;
    const module = moduleOf(file.entry) ?? "";
    const written = plant({
      contentDir: copy.contentDir,
      readingEntry: figureReadingEntry(module, nameOf(file.entry)),
      sim,
    });
    writeFileSync(file.path, extname(file.path) === ".json" ? JSON.stringify(written) : stringify(written));
    return copy;
  }
  throw new Error(`no schematic sim in ${good.contentDir} to plant a negative control in`);
}
