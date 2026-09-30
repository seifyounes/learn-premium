// A Course's content files as the content gates see them: the same globs the build's content
// collections load (`src/content/layout.ts`), scoped to one Module when the gate input names one.
import { cpSync, globSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { COLLECTIONS, moduleOf } from "../src/content/layout.ts";
import { MODULE_ID } from "../src/content/contract.ts";
import type { GateInput } from "./runner.ts";

export type CollectionName = keyof typeof COLLECTIONS;

export interface CourseFile {
  collection: CollectionName;
  /** Path relative to the content folder, forward slashes: how findings name the file. */
  entry: string;
  path: string;
}

export function courseFiles({ contentDir, module }: GateInput): CourseFile[] {
  return (Object.keys(COLLECTIONS) as CollectionName[]).flatMap((collection) =>
    globSync(COLLECTIONS[collection].pattern, { cwd: contentDir })
      .map((entry) => entry.replace(/\\/g, "/"))
      .filter((entry) => module === undefined || moduleOf(entry) === module)
      .sort()
      .map((entry) => ({ collection, entry, path: join(contentDir, entry) })),
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
