// Course overrides at build. A Course project keeps the template layer read-only; a local fix it
// needs before a Template release carries it goes in its overrides area as `overrides/<path>`, which
// the build loads in place of `template/<path>`. Each is tied to a gate gap in the Build ledger, and
// the integrity check holds every file there to a recorded override (skill/scripts/ledger/overrides.ts).
//
// Only site code and styles under `src/` can be shadowed: the gates, deploy scripts, config and
// dependencies verify the Course, so a Course never swaps them. Every override must shadow a file the
// template has, so a renamed template file can't leave an override silently doing nothing.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { Plugin } from "vite";

/** What an override can shadow; the same rule as the skill's (skill/scripts/ledger/overrides.ts). */
export const OVERRIDABLE = /^src\/(?:[^/]+\/)*[^/]+\.(?:astro|ts|tsx|js|jsx|mjs|css|json)$/;

/** The overrides area's own placeholder, not an override. */
const PLACEHOLDER = ".gitkeep";

/** The Site template's root: this file is `<template>/src/overrides/plugin.ts`. */
const TEMPLATE_ROOT = resolve(import.meta.dirname, "..", "..");

/** The stylesheet Tailwind generates from: its sources gain the overrides area. */
const TAILWIND_ENTRY = "src/styles/global.css";

/**
 * The overrides area the build reads: `OVERRIDES_DIR`, else `../overrides` beside the template layer,
 * where a Course project keeps it. The Fixture Course has none.
 */
export const buildOverridesDir = () => resolve(process.cwd(), process.env["OVERRIDES_DIR"] ?? "../overrides");

function filesUnder(root: string): string[] {
  try {
    return readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join("/"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/** A module id as a comparable path: Vite's ids use forward slashes, and Windows paths ignore case. */
function key(path: string): string {
  const absolute = resolve(path).split(sep).join("/");
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

const RELATIVE_IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\.{1,2}\/[^"']+)["']/g;
const IMPORT_EXTENSIONS = ["", ".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.js"];

/**
 * The template files `astro.config.mjs` imports, directly or through others: Node evaluates them
 * while reading the config, before any Vite plugin runs, so an override of one would never apply.
 */
export function configModules(templateRoot = TEMPLATE_ROOT): Set<string> {
  const found = new Set<string>();
  const queue = [join(templateRoot, "astro.config.mjs")];
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    let source: string;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const [, specifier = ""] of source.matchAll(RELATIVE_IMPORT)) {
      const base = resolve(dirname(file), specifier);
      const target = IMPORT_EXTENSIONS.map((ext) => `${base}${ext}`).find((path) => isFile(path));
      if (target === undefined) continue;
      const path = relative(templateRoot, target).split(sep).join("/");
      if (!path.startsWith("src/") || found.has(path)) continue;
      found.add(path);
      queue.push(target);
    }
  }
  return found;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** The overrides in `dir`, by template path; throws, failing the build, on any that can't be one. */
export function readOverrides(dir: string, templateRoot = TEMPLATE_ROOT): string[] {
  const paths = filesUnder(dir).filter((path) => path !== PLACEHOLDER);
  const template = new Set(filesUnder(join(templateRoot, "src")).map((path) => `src/${path}`));
  const config = configModules(templateRoot);
  const problems = paths.flatMap((path) => {
    if (!OVERRIDABLE.test(path))
      return [`${path}: an override shadows site code or styles under src/, never a gate, a script or the config`];
    if (!template.has(path)) return [`${path} shadows no template file`];
    if (config.has(path))
      return [`${path} is read with the build config, before any override applies: it can't be overridden`];
    return [];
  });
  if (problems.length > 0) throw new Error(`Course overrides in ${dir} refused:\n  ${problems.join("\n  ")}`);
  return paths.sort();
}

/** The Vite plugin that loads each Course override in place of the template file it shadows. */
export function courseOverrides(dir = buildOverridesDir(), templateRoot = TEMPLATE_ROOT): Plugin {
  const paths = readOverrides(dir, templateRoot);
  const shadowed = new Map(paths.map((path) => [key(join(templateRoot, path)), join(dir, path)]));
  const tailwindEntry = key(join(templateRoot, TAILWIND_ENTRY));
  let announced = false;
  return {
    name: "learn-premium:course-overrides",
    enforce: "pre",
    buildStart() {
      if (paths.length === 0 || announced) return;
      announced = true;
      this.info(`Course overrides from ${dir}: ${paths.join(", ")}`);
    },
    load(id) {
      // Only a file itself; Astro's and Vite's query ids (`?astro&type=style`…) derive from it.
      if (paths.length === 0 || id.startsWith("\0") || id.includes("?")) return null;
      const file = shadowed.get(key(id));
      if (file !== undefined) this.addWatchFile(file);
      const source = file === undefined ? null : readFileSync(file, "utf8");
      if (key(id) !== tailwindEntry) return source;
      // Tailwind scans the template's own files; the overrides area sits outside it, so name it as a source.
      const css = source ?? readFileSync(id, "utf8");
      return `${css}\n@source ${JSON.stringify(dir.split(sep).join("/"))};\n`;
    },
  };
}
