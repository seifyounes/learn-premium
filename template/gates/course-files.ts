// The files a gate checks: a Course's content files (the same globs the build's content
// collections load, from `src/content/layout.ts`) or a built site's pages, scoped to one Module
// when the gate input names one.
import { cpSync, existsSync, globSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { MODULE_ID } from "../src/content/contract.ts";
import { COLLECTIONS, moduleOf } from "../src/content/layout.ts";
import { COMMITTED_LICENCES } from "../src/licences/file.ts";
import { VERCEL_CONFIG } from "./vercel-config.ts";
import type { GateInput } from "./runner.ts";

export const slashes = (path: string) => path.replace(/\\/g, "/");

/** The Site template the gates belong to: what `GateInput.templateDir` defaults to. */
const OWN_TEMPLATE = resolve(import.meta.dirname, "..");

/** The Site template the site was built with. */
export const templateOf = (input: GateInput) => input.templateDir ?? OWN_TEMPLATE;

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

/** Every file under `dir`, in a stable order. */
export function allFiles(dir: string): CheckedFile[] {
  // Not a glob: `**/*` skips dot-prefixed files and folders, and a privacy scan must see them.
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map(slashes)
    .sort()
    .map((entry) => ({ entry, path: join(dir, entry) }))
    .filter((file) => statSync(file.path).isFile());
}

/** `dir` and each folder above it, nearest first. */
export function* foldersUp(dir: string): Generator<string> {
  for (let at = resolve(dir); ; at = dirname(at)) {
    yield at;
    if (dirname(at) === at) return;
  }
}

/** The git repo a folder sits in (its `.git` may be a worktree's file), if any. */
export function gitRoot(dir: string): string | undefined {
  for (const at of foldersUp(dir)) if (existsSync(join(at, ".git"))) return at;
  return undefined;
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
  const copy = courseCopy(good, scratch);
  const { contentDir } = copy;
  const module = good.module ?? firstModule(contentDir);
  for (const [entry, text] of Object.entries(files)) {
    const path = join(contentDir, "modules", module, entry);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  return copy;
}

/** A scratch copy of the Course's content, to plant a defect in. */
export function courseCopy(good: GateInput, scratch: string): GateInput {
  const contentDir = join(scratch, "course");
  cpSync(good.contentDir, contentDir, { recursive: true });
  return { ...good, contentDir };
}

/**
 * A scratch Site template for the gates that read from it: its vercel.json changed by `config`, and
 * its committed Licences file copied, or replaced by `licences`.
 */
export function templateWith(
  good: GateInput,
  scratch: string,
  {
    config = (c) => c,
    licences,
  }: { config?: (config: Record<string, unknown>) => Record<string, unknown>; licences?: string },
): GateInput {
  const from = templateOf(good);
  const templateDir = join(scratch, "template");
  const committed = join(templateDir, COMMITTED_LICENCES);
  mkdirSync(dirname(committed), { recursive: true });
  const vercel = JSON.parse(readFileSync(join(from, VERCEL_CONFIG), "utf8")) as Record<string, unknown>;
  writeFileSync(join(templateDir, VERCEL_CONFIG), JSON.stringify(config(vercel), null, 2));
  if (licences !== undefined) writeFileSync(committed, licences);
  else if (existsSync(join(from, COMMITTED_LICENCES))) cpSync(join(from, COMMITTED_LICENCES), committed);
  return { ...good, templateDir };
}

function firstModule(contentDir: string): string {
  const module = readdirSync(join(contentDir, "modules"))
    .filter((name) => MODULE_ID.test(name))
    .sort()[0];
  if (!module) throw new Error(`no Module in ${contentDir} to plant a negative control in`);
  return module;
}
