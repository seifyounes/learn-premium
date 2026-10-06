// The hashed Materials inventory and the Module map intake proposes from it. The proposal is only a
// starting point: the agent refines titles from what the Materials say, the Owner confirms or edits
// it, and only then is it written to the Build ledger (`ledger map`), in the same shape.
import { statSync } from "node:fs";
import { join, resolve } from "node:path";
import { LedgerError } from "../ledger/file.ts";
import { hashTree } from "../ledger/hash.ts";
import { kindOf } from "../ledger/materials.ts";
import type { MaterialKind, ModuleMap } from "../ledger/model.ts";

export interface InventoryRow {
  /** Relative to the Materials folder, '/'-separated. */
  path: string;
  kind: MaterialKind;
  hash: string;
  bytes: number;
}

export function requireFolder(path: string, what: string): string {
  const full = resolve(path);
  let isFolder = false;
  try {
    isFolder = statSync(full).isDirectory();
  } catch {
    // reported below
  }
  if (!isFolder) throw new LedgerError("invalid", `the ${what} ${full} isn't a folder`);
  return full;
}

/** Every Materials file with its kind, sha256 and size, in path order. */
export function inventory(materials: string): InventoryRow[] {
  return Object.entries(hashTree(materials)).map(([path, hash]) => ({
    path,
    kind: kindOf(path),
    hash,
    bytes: statSync(join(materials, path)).size,
  }));
}

/** A lecture, week, chapter… number in a file or folder name: `L01`, `Lecture 2`, `Lec_03`, `Week 4`. */
const NUMBERED =
  /(?:^|[^a-z])(?:lecture|lect|lec|l|week|wk|w|chapter|ch|module|mod|unit|topic|session|part)[\s._-]*0*(\d{1,2})(?!\d)/i;

/** The Module number a file belongs to (from its own name first, then its folders), and the name it was read from. */
function numbered(path: string): { id: string; rest: string } | null {
  const segments = path.split("/");
  const named = segments.map((segment, i) => (i === segments.length - 1 ? segment.replace(/\.[^.]+$/, "") : segment));
  for (const segment of named.reverse()) {
    const match = NUMBERED.exec(segment);
    const n = Number(match?.[1]);
    if (match === null || n < 1) continue;
    const rest = segment.slice(0, match.index) + segment.slice(match.index + match[0].length);
    return { id: String(n).padStart(2, "0"), rest };
  }
  return null;
}

function titleOf(rest: string): string {
  const words = rest
    .replace(/[_.]+/g, " ")
    .replace(/^[\s\-–—:,]+|[\s\-–—:,]+$/g, "")
    .replace(/\s+/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function slugOf(title: string): string {
  return title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** One Module per lecture number found in the file names; every other file left unmapped for the Owner. */
export function proposeModuleMap(rows: InventoryRow[]): ModuleMap {
  const modules = new Map<string, { titles: string[]; materials: string[] }>();
  const unmapped: string[] = [];
  for (const { path } of rows) {
    const found = numbered(path);
    if (found === null) {
      unmapped.push(path);
      continue;
    }
    const module = modules.get(found.id) ?? { titles: [], materials: [] };
    module.titles.push(titleOf(found.rest));
    module.materials.push(path);
    modules.set(found.id, module);
  }
  return {
    modules: [...modules.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, { titles, materials }]) => {
        const title = titles.find((t) => slugOf(t) !== "") ?? `Module ${id}`;
        return { id, slug: slugOf(title), title, materials };
      }),
    unmapped,
  };
}

export function propose(materialsPath: string) {
  const materials = requireFolder(materialsPath, "Materials folder");
  const rows = inventory(materials);
  return { materials, inventory: rows, proposal: proposeModuleMap(rows) };
}
