// A Module's Worked examples and tools, as JSON: what the Module wave's merge gate holds the
// Agent-built tool assignment to (`skill/scripts/wave/assign.ts`). Read here because the content
// is YAML or JSON and the skill's scripts carry no parser (the same reason as `rulings.ts`). Not a
// gate: it checks nothing itself, and a file the contract can't read is listed in `problems`.
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { part as partSchema, pythonTool as pythonSchema, worked as workedSchema } from "../src/content/contract.ts";
import { readStructured } from "../src/content/loaders.ts";
import { isLive, isSchematic, schematicModelOf } from "../src/sims/kinds.ts";
import { courseFiles, type CourseFile } from "./course-files.ts";
import { problems, readSim } from "./sims.ts";
import type { GateInput } from "./runner.ts";

export interface InventoryTool {
  /** The file's name without its folder or extension. */
  name: string;
  /** The content file, relative to the content folder, forward slashes. */
  entry: string;
  collection: "sims" | "python" | "parts";
  /** A sim's kind, `pyodide` for a Pyodide tool, `part` for a machine part. */
  kind: string;
  /** The Worked example it sits in, by its file number; null for a Lab-only tool. */
  worked: string | null;
  /** Whether it ships live: a sim an independent recompute checks; always true for a Pyodide tool or a part. */
  live: boolean;
  /** A schematic sim's parts and nets, as the layout core draws them; null for any other tool. */
  counts: { parts: number; nets: number } | null;
}

export interface ToolInventory {
  module: string;
  worked: { n: string; entry: string; figure: "none" | "static" | "animated" }[];
  tools: InventoryTool[];
  /** `<entry>: <why the contract can't read it>`. */
  problems: string[];
}

const ignoreMath = () => {};
const nameOf = (file: CourseFile) => basename(file.entry, extname(file.entry));
const read = (file: CourseFile) => readStructured(readFileSync(file.path, "utf8"), file.entry, ignoreMath);
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

/** The Module's Worked examples and tools (`input.module` names its folder) as the content contract reads them. */
export function toolInventory(input: GateInput): ToolInventory {
  const files = courseFiles(input);
  const found: ToolInventory = { module: input.module ?? "", worked: [], tools: [], problems: [] };
  const unreadable = (file: CourseFile, why: string) => found.problems.push(`${file.entry}: ${why}`);

  for (const file of files.filter((f) => f.collection === "worked")) {
    let raw: Record<string, unknown>;
    try {
      raw = read(file);
    } catch (error) {
      unreadable(file, `can't read the Worked example: ${(error as Error).message}`);
      continue;
    }
    const parsed = workedSchema.safeParse(raw);
    if (!parsed.success) {
      unreadable(file, `the content contract reports ${problems(parsed.error)}`);
      continue;
    }
    const { figure, steps } = parsed.data;
    // Elements first drawn or ringed at a step move the figure: the Worked example animates.
    const animated = steps.some((s) => (s.figure?.add.length ?? 0) + (s.figure?.ring.length ?? 0) > 0);
    found.worked.push({
      n: nameOf(file),
      entry: file.entry,
      figure: figure === undefined ? "none" : animated ? "animated" : "static",
    });
  }

  for (const file of files.filter((f) => f.collection === "sims")) {
    const sim = readSim(file);
    if (sim.problem !== undefined) {
      unreadable(file, sim.problem);
      continue;
    }
    const model = isSchematic(sim.sim) ? schematicModelOf(sim.sim) : null;
    found.tools.push({
      name: nameOf(file),
      entry: file.entry,
      collection: "sims",
      kind: sim.sim.kind,
      worked: sim.sim.worked ?? null,
      live: isLive(sim.sim),
      counts: model === null ? null : { parts: model.parts.length, nets: model.nets.length },
    });
  }

  for (const [collection, kind, schema] of [
    ["python", "pyodide", pythonSchema],
    ["parts", "part", partSchema],
  ] as const) {
    for (const file of files.filter((f) => f.collection === collection)) {
      let raw: Record<string, unknown>;
      try {
        raw = read(file);
      } catch (error) {
        unreadable(file, `can't read the tool: ${(error as Error).message}`);
        continue;
      }
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        unreadable(file, `the content contract reports ${problems(parsed.error)}`);
        continue;
      }
      found.tools.push({
        name: nameOf(file),
        entry: file.entry,
        collection,
        kind,
        worked: parsed.data.worked ?? null,
        live: true,
        counts: null,
      });
    }
  }

  found.worked.sort((a, b) => Number(a.n) - Number(b.n));
  found.tools.sort(byName);
  return found;
}
