// Synthetic Course projects for the Media pass tests, built through the ledger and media commands.
import type { ToolInventory } from "../scripts/wave/assign.ts";
import { must } from "./fake-notebooklm.ts";
import { jsonInput, ledger, media, tempDir, writeFiles } from "./helpers.ts";

export const COMMIT = "0123456789abcdef0123456789abcdef01234567";

/** The inventory of a Module with no Worked example and no tool: what a faked template layer reports by default. */
export const EMPTY_INVENTORY: ToolInventory = { module: "", worked: [], tools: [], problems: [] };

export function sitting(id: string, date: string | null) {
  return { id, name: id, date };
}

/**
 * A synthetic Course project built through the ledger commands: Modules `live` merged, `planned` only
 * mapped, and `liveSittings` with a merged Sitting wave. Module NN is fed by `LNN.pdf` (or by the files
 * `materials` gives it). session-a keeps the ledger lock throughout.
 */
export function fixtureCourse(
  name: string,
  options: {
    sittings?: { id: string; name: string; date: string | null }[];
    live?: string[];
    planned?: string[];
    liveSittings?: string[];
    pad?: string;
    materials?: Record<string, Record<string, string | Buffer>>;
    /** Template-layer files (path under `template/` → content), in place before `init` pins their hashes. */
    template?: Record<string, string>;
    /** The Disciplines the intake lists (default: just maths). */
    disciplines?: string[];
    /** A Module's slug by its number (default: `mNN`). */
    slugs?: Record<string, string>;
  },
): string {
  const { sittings = [], live = [], planned = [], liveSittings = [], pad = "green" } = options;
  const project = tempDir("project");
  writeFiles(project, Object.fromEntries(Object.entries(options.template ?? {}).map(([p, c]) => [`template/${p}`, c])));
  const folder = tempDir("materials");
  const modules = [...live, ...planned];
  const feeds = (id: string) => options.materials?.[id] ?? { [`L${id}.pdf`]: `${name} ${id}` };
  writeFiles(folder, Object.assign({}, ...modules.map(feeds)));
  const intake = {
    courseName: name,
    materialsPath: folder,
    disciplines: options.disciplines ?? ["maths"],
    pad,
    arabicNotes: false,
    sittings,
  };
  must(
    ledger("init", "--project", project, "--holder", "session-a", "--release", "v2.0.0", "--intake", jsonInput(intake)),
  );
  const moduleMap = {
    modules: modules.map((id) => ({
      id,
      slug: options.slugs?.[id] ?? `m${id}`,
      title: `Module ${id}`,
      materials: Object.keys(feeds(id)),
    })),
    unmapped: [],
  };
  must(ledger("map", "--project", project, "--holder", "session-a", "--input", jsonInput(moduleMap)));
  for (const id of live) makeLive(project, id);
  // A Sitting wave starts only on the Owner's word that its sitting is complete.
  for (const id of liveSittings) {
    ownerSaysComplete(project, id, { modules: modules.slice(0, 1) });
    mergeWave(project, "sitting", id);
  }
  return project;
}

/** Records the Owner's word that sitting `id` is complete (`sitting complete`): no past papers, no announced format, unless given. */
export function ownerSaysComplete(
  project: string,
  id: string,
  words: { modules: string[]; papers?: { slug: string; path: string }[]; announced?: string | null } = { modules: [] },
) {
  const { modules, papers = [], announced = null } = words;
  return ledger(
    ...["sitting", "complete", "--project", project, "--holder", "session-a"],
    ...["--input", jsonInput({ sitting: id, modules, papers, announced, answer: `${id} is complete.` })],
  );
}

/** The Course's Materials folder, as its Build ledger records it. */
export function materialsOf(project: string): string {
  return must(ledger("status", "--project", project)).materialsPath as string;
}

export function makeLive(project: string, module: string): void {
  mergeWave(project, "module", module);
}

export function mergeWave(project: string, kind: "module" | "sitting", target: string): void {
  const holder = ["--project", project, "--holder", "session-a"];
  const { wave } = must(
    ledger("wave", "start", ...holder, "--kind", kind, "--target", target, "--branch", `b-${target}`),
  );
  must(ledger("wave", "end", ...holder, "--wave", wave, "--result", "merged", "--commit", COMMIT));
}

export function registered(state: string, ...projects: string[]): void {
  for (const project of projects) must(media("register", "--state", state, "--project", project));
}
