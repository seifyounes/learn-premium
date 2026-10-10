// Course overrides at build. A Course project keeps the template layer read-only; a local fix it
// needs before a Template release carries it goes in its overrides area as `overrides/<path>`, which
// the build loads in place of `template/<path>`. Each is tied to a gate gap in the Build ledger, and
// the integrity check holds every file there to a recorded override (skill/scripts/ledger/overrides.ts).
//
// Only site code and styles under `src/` can be shadowed: the gates, deploy scripts, config and
// dependencies verify the Course, so a Course never swaps them. Every override must shadow a file the
// template has, so a renamed template file can't leave an override silently doing nothing.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import type { Plugin } from "vite";

/** What an override can shadow; the same rule as the skill's (skill/scripts/ledger/overrides.ts). */
export const OVERRIDABLE = /^src\/(?:[^/]+\/)*[^/]+\.(?:astro|ts|tsx|js|jsx|mjs|css|json)$/;

/** The overrides area's own placeholder, not an override. */
const PLACEHOLDER = ".gitkeep";

/** The Site template's root: this file is `<template>/src/overrides/plugin.ts`. */
const TEMPLATE_ROOT = resolve(import.meta.dirname, "..", "..");

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

/** The overrides in `dir`, by template path; throws, failing the build, on any that can't be one. */
export function readOverrides(dir: string, templateRoot = TEMPLATE_ROOT): string[] {
  const paths = filesUnder(dir).filter((path) => path !== PLACEHOLDER);
  const template = new Set(filesUnder(join(templateRoot, "src")).map((path) => `src/${path}`));
  const problems = paths.flatMap((path) => {
    if (!OVERRIDABLE.test(path))
      return [`${path}: an override shadows site code or styles under src/, never a gate, a script or the config`];
    if (!template.has(path)) return [`${path} shadows no template file`];
    return [];
  });
  if (problems.length > 0) throw new Error(`Course overrides in ${dir} refused:\n  ${problems.join("\n  ")}`);
  return paths.sort();
}

/** The Vite plugin that loads each Course override in place of the template file it shadows. */
export function courseOverrides(dir = buildOverridesDir(), templateRoot = TEMPLATE_ROOT): Plugin {
  const paths = readOverrides(dir, templateRoot);
  const shadowed = new Map(paths.map((path) => [key(join(templateRoot, path)), join(dir, path)]));
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
      if (file === undefined) return null;
      this.addWatchFile(file);
      return readFileSync(file, "utf8");
    },
  };
}
