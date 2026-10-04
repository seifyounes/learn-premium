// Refreshes the committed Licences file (what the Go-public check looks for) from the one the
// build wrote. The `licences-file` gate blocks a deploy whose committed copy is stale.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { COMMITTED_LICENCES, LICENCES_FILE } from "../src/licences/file.ts";

export function commitLicences(distDir: string, templateDir: string): { path: string; changed: boolean } {
  const built = join(distDir, LICENCES_FILE);
  if (!existsSync(built)) throw new Error(`no Licences file at ${built}: build the site first (npm run build)`);
  const path = join(templateDir, COMMITTED_LICENCES);
  const changed = !existsSync(path) || readFileSync(path, "utf8") !== readFileSync(built, "utf8");
  mkdirSync(dirname(path), { recursive: true });
  if (changed) copyFileSync(built, path);
  return { path, changed };
}
