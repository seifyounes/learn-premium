// Refreshes the committed Licences file (public/licences.txt, what the Go-public check looks for)
// from the one the build wrote. The `licences-file` gate blocks a deploy whose committed copy is stale.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function commitLicences(distDir: string, templateDir: string): { path: string; changed: boolean } {
  const built = join(distDir, "licences.txt");
  if (!existsSync(built)) throw new Error(`no Licences file at ${built}: build the site first (npm run build)`);
  const path = join(templateDir, "public", "licences.txt");
  const changed = !existsSync(path) || readFileSync(path, "utf8") !== readFileSync(built, "utf8");
  mkdirSync(dirname(path), { recursive: true });
  if (changed) copyFileSync(built, path);
  return { path, changed };
}
