// The workspace's project catalog: the table under "## Project catalog" in the workspace MEMORY.md,
// one row per project folder (the /newproject convention). A Course project joins it at intake.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LedgerError } from "../ledger/file.ts";

export const MEMORY_FILE = "MEMORY.md";

/** The catalog table's lines, and where a new row goes (after its last row). */
function locate(lines: string[], path: string): number {
  const heading = lines.findIndex((line) => /^#+\s+Project catalog\s*$/i.test(line));
  const first = heading === -1 ? -1 : lines.findIndex((line, i) => i > heading && line.startsWith("|"));
  if (first === -1)
    throw new LedgerError("invalid", `${path} has no Project catalog table to add the Course project to`);
  let last = first;
  while (lines[last + 1]?.startsWith("|")) last++;
  return last + 1;
}

/** Reads the workspace MEMORY.md, refusing one with no catalog to add to. */
export function readCatalog(workspace: string): string {
  const path = join(workspace, MEMORY_FILE);
  let memory: string;
  try {
    memory = readFileSync(path, "utf8");
  } catch {
    throw new LedgerError(
      "invalid",
      `no ${MEMORY_FILE} in the workspace ${workspace}: its Project catalog lists every project`,
    );
  }
  locate(memory.split(/\r?\n/), path);
  return memory;
}

/** `memory` with a row for `folder` added to its catalog; unchanged (`added` false) when the folder has one. */
export function withCatalogRow(memory: string, folder: string, cells: string[]): { memory: string; added: boolean } {
  const eol = memory.includes("\r\n") ? "\r\n" : "\n";
  const lines = memory.split(/\r?\n/);
  if (lines.some((line) => line.startsWith("|") && line.includes(`| \`${folder}\` |`))) return { memory, added: false };
  const at = locate(lines, MEMORY_FILE);
  const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
  lines.splice(at, 0, `| ${cell(cells[0] ?? "")} | \`${folder}\` | ${cells.slice(1).map(cell).join(" | ")} |`);
  return { memory: lines.join(eol), added: true };
}
