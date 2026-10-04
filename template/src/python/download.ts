// Pyodide served from the Course project: its core from the template's pinned `pyodide` package,
// and the packages a Course's tools load from the Course's own `pyodide/` folder (committed, ADR
// 0003). A tool's Run-live download is the real bytes of those files, read off the disk.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { CORE_FILES, packageFiles, type Lock, type PackageFile } from "./lock.ts";

/** Where the site serves Pyodide: core and packages side by side, as its lock expects. */
export const PYODIDE_PATH = "/pyodide/";

/** The template's pinned Pyodide distribution (core files and lock). */
export const coreDir = () => dirname(createRequire(import.meta.url).resolve("pyodide/package.json"));

/** A Course's Pyodide packages, committed beside its Modules. */
export const packageDir = (contentDir: string) => join(contentDir, "pyodide");

export const readLock = (): Lock => JSON.parse(readFileSync(join(coreDir(), "pyodide-lock.json"), "utf8")) as Lock;

export interface Download {
  /** Every file the tap fetches from `/pyodide/`, in the order Pyodide asks for them. */
  files: { file: string; bytes: number }[];
  bytes: number;
}

/** The SHA-256 Pyodide's lock names a package file by. */
export const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const checked = new Map<string, string>();
/** A package file's SHA-256, read once per build. */
function sha256Of(path: string): string {
  let hash = checked.get(path);
  if (hash === undefined) {
    hash = sha256(readFileSync(path));
    checked.set(path, hash);
  }
  return hash;
}

/**
 * Each package file `packages` load, found in the Course's `pyodide/` folder and matching the
 * lock's hash. A file that is missing or isn't the one Pyodide's lock names throws.
 */
export function coursePackages(contentDir: string, packages: readonly string[]): (PackageFile & { path: string })[] {
  return packageFiles(readLock(), packages).map((p) => {
    const path = join(packageDir(contentDir), p.file);
    if (!existsSync(path))
      throw new Error(
        `the Course's pyodide/ folder has no ${p.file} (package "${p.name}"): run \`npm run wheels\` to fetch the packages its Pyodide tools load`,
      );
    if (sha256Of(path) !== p.sha256)
      throw new Error(`pyodide/${p.file} isn't the file Pyodide's lock names (its SHA-256 differs): fetch it again`);
    return { ...p, path };
  });
}

/** What a Run-live tap downloads for a tool loading `packages`: the core, then each package file. */
export function downloadOf(contentDir: string, packages: readonly string[]): Download {
  const files = [
    ...CORE_FILES.map((file) => ({ file, bytes: statSync(join(coreDir(), file)).size })),
    ...coursePackages(contentDir, packages).map(({ file, path }) => ({ file, bytes: statSync(path).size })),
  ];
  return { files, bytes: files.reduce((sum, f) => sum + f.bytes, 0) };
}
