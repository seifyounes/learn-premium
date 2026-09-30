// Content hashes of a folder tree, keyed by '/'-separated path relative to its root.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** OS clutter that is never Materials or template code. */
const IGNORED = new Set(["Thumbs.db", "desktop.ini", ".DS_Store"]);

export function hashFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Every file under `root` → its sha256, in path order. A missing root has no files. */
export function hashTree(root: string): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const path of listFiles(root).sort()) hashes[path] = hashFile(join(root, path));
  return hashes;
}

function listFiles(root: string): string[] {
  let entries;
  try {
    entries = readdirSync(root, { recursive: true, withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile() && !IGNORED.has(entry.name))
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join("/"));
}
