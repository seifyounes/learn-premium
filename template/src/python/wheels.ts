// `npm run wheels`: fetches the Pyodide packages a Course's tools load (with what they depend on)
// into the Course's `pyodide/` folder, from Pyodide's CDN at the template's pinned version, each
// checked against the SHA-256 in Pyodide's lock. The Course commits them (ADR 0003): the site
// serves them itself and never asks the CDN.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildContentDir } from "../content/layout.ts";
import { coreDir, packageDir, readLock, sha256 } from "./download.ts";
import { packageFiles } from "./lock.ts";
import { toolPackages } from "./tools.ts";

const contentDir = process.argv[2] ?? buildContentDir();
const version = (JSON.parse(readFileSync(join(coreDir(), "package.json"), "utf8")) as { version: string }).version;
const cdn = `https://cdn.jsdelivr.net/pyodide/v${version}/full/`;

const wanted = packageFiles(readLock(), toolPackages(contentDir).packages);
const dir = packageDir(contentDir);
mkdirSync(dir, { recursive: true });

for (const { name, file, sha256: expected } of wanted) {
  const path = join(dir, file);
  if (existsSync(path) && sha256(readFileSync(path)) === expected) {
    console.log(`have ${file}`);
    continue;
  }
  const response = await fetch(cdn + file);
  if (!response.ok) throw new Error(`${cdn + file}: ${response.status} ${response.statusText}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (sha256(bytes) !== expected) throw new Error(`${file} (package "${name}") doesn't match Pyodide's lock`);
  writeFileSync(path, bytes);
  console.log(`fetched ${file} (${(bytes.length / 1_000_000).toFixed(1)} MB)`);
}
console.log(`${wanted.length} package file(s) in ${dir}`);
