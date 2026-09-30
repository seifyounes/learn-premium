// The files a gate checks: a Course's content files (the same globs the build's content
// collections load, from `src/content/layout.ts`) or a built site's pages, scoped to one Module
// when the gate input names one.
import { cpSync, globSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { MODULE_ID } from "../src/content/contract.ts";
import { COLLECTIONS, moduleOf } from "../src/content/layout.ts";
import type { GateInput } from "./runner.ts";

export const slashes = (path: string) => path.replace(/\\/g, "/");

export interface CheckedFile {
  /** Path relative to the folder checked, forward slashes: how findings name the file. */
  entry: string;
  path: string;
}

/** The files under `dir` matching `pattern` that `keep` accepts, in a stable order. */
export function filesIn(dir: string, pattern: string, keep: (entry: string) => boolean): CheckedFile[] {
  return globSync(pattern, { cwd: dir })
    .map(slashes)
    .filter(keep)
    .sort()
    .map((entry) => ({ entry, path: join(dir, entry) }));
}

export type CollectionName = keyof typeof COLLECTIONS;

export interface CourseFile extends CheckedFile {
  collection: CollectionName;
}

export function courseFiles({ contentDir, module }: GateInput): CourseFile[] {
  const inScope = (entry: string) => module === undefined || moduleOf(entry) === module;
  return (Object.keys(COLLECTIONS) as CollectionName[]).flatMap((collection) =>
    filesIn(contentDir, COLLECTIONS[collection].pattern, inScope).map((file) => ({ collection, ...file })),
  );
}

// Negative-control helpers: they plant a defect in a copy, never in the Course itself, and throw
// when there is nothing to plant it in, so a control can't silently check nothing.

/**
 * A scratch copy of the Course's content with `files` (path within the Module → text) added to the
 * gate input's Module, or to the first Module when the input names none.
 */
export function courseWith(good: GateInput, scratch: string, files: Record<string, string>): GateInput {
  const contentDir = join(scratch, "course");
  cpSync(good.contentDir, contentDir, { recursive: true });
  const module = good.module ?? firstModule(contentDir);
  for (const [entry, text] of Object.entries(files)) {
    const path = join(contentDir, "modules", module, entry);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  return { ...good, contentDir };
}

function firstModule(contentDir: string): string {
  const module = readdirSync(join(contentDir, "modules"))
    .filter((name) => MODULE_ID.test(name))
    .sort()[0];
  if (!module) throw new Error(`no Module in ${contentDir} to plant a negative control in`);
  return module;
}
