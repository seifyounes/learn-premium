// `npm run molecules`: draws the Course's molecules (`molecules/build.py`) with the machine venv's
// Python, which has RDKit: each molecule's 2D structure in graphite, its 3D conformer, and a record.
// LEARN_PREMIUM_PYTHON names another Python; CONTENT_DIR another Course (the Fixture Course by
// default). Arguments pass through (`-- --module 13-cell-potential`).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { buildContentDir } from "../content/layout.ts";
import { INKS } from "../pads/catalogue.ts";

const venv = join(homedir(), ".claude", "learn-premium", "venv");
const python =
  process.env.LEARN_PREMIUM_PYTHON ??
  (process.platform === "win32" ? join(venv, "Scripts", "python.exe") : join(venv, "bin", "python"));
if (!existsSync(python)) {
  console.error(`no Python at ${python}: run the installer for the machine venv, or set LEARN_PREMIUM_PYTHON`);
  process.exit(1);
}
const script = resolve(import.meta.dirname, "..", "..", "molecules", "build.py");
const run = spawnSync(
  python,
  [script, "--content", buildContentDir(), "--graphite", INKS.graphite, ...process.argv.slice(2)],
  { stdio: "inherit" },
);
process.exit(run.status ?? 1);
