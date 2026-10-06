// Content hashes of a folder tree, keyed by '/'-separated path relative to its root.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** OS clutter that is never Materials or template code. */
const IGNORED = new Set(["Thumbs.db", "desktop.ini", ".DS_Store"]);
/** A git repository's internals: a Materials folder that is also a repo keeps its history there. */
const IGNORED_DIRS = new Set([".git"]);

export function hashFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * Every file under `root` → its sha256, in path order. A missing root has no files. Folders named in
 * `skipDirs` (at any depth) are left out, as git's internals always are.
 */
export function hashTree(root: string, skipDirs: Iterable<string> = []): Record<string, string> {
  const hashes: Record<string, string> = {};
  const skip = new Set([...IGNORED_DIRS, ...skipDirs]);
  for (const path of listFiles(root, skip).sort()) hashes[path] = hashFile(join(root, path));
  return hashes;
}

function listFiles(root: string, skipDirs: Set<string>): string[] {
  let entries;
  try {
    entries = readdirSync(root, { recursive: true, withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile() && !IGNORED.has(entry.name))
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join("/"))
    .filter(
      (path) =>
        !path
          .split("/")
          .slice(0, -1)
          .some((folder) => skipDirs.has(folder)),
    );
}
