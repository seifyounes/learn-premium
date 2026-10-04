// What a Pyodide tool downloads when the student taps Run live: Pyodide's core files, then each
// package the tool names with the packages it depends on, as Pyodide's lock file lists them.
import type { Lockfile } from "pyodide";

export type Lock = Lockfile;

/** Fetched by every Pyodide start: the loader, the runtime, the standard library and the lock. */
export const CORE_FILES = [
  "pyodide.mjs",
  "pyodide.asm.mjs",
  "pyodide.asm.wasm",
  "python_stdlib.zip",
  "pyodide-lock.json",
] as const;

export interface PackageFile {
  name: string;
  /** Its file in Pyodide's distribution, served from `/pyodide/`. */
  file: string;
  sha256: string;
}

/**
 * The packages `names` load, each once, every package after the ones it depends on. A name
 * Pyodide doesn't ship throws; an import name (`sklearn`) is pointed at its package.
 */
export function packageFiles(lock: Lock, names: readonly string[]): PackageFile[] {
  const order: PackageFile[] = [];
  const seen = new Set<string>();
  const visit = (name: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    const entry = lock.packages[name];
    if (!entry) {
      const owner = ownerOf(lock, name);
      throw new Error(
        `"${name}" isn't a Pyodide package${owner ? `: it is imported from "${owner.name}"` : ""} (Pyodide's lock lists every package it ships)`,
      );
    }
    entry.depends.forEach(visit);
    order.push({ name, file: entry.file_name, sha256: entry.sha256 });
  };
  names.forEach(visit);
  return order;
}

/** The package a module is imported from (`sklearn` → `scikit-learn`), if Pyodide ships it. */
export const ownerOf = (lock: Lock, module: string) =>
  Object.values(lock.packages).find((p) => p.imports.includes(module));

/** The Run-live button's size: megabytes to one place, rounded up so it never understates. */
export const sizeLabel = (bytes: number) => `${(Math.ceil(bytes / 100_000) / 10).toFixed(1)} MB`;
