// `npm run parts`: builds the Course's machine parts (`parts/build.py`) with the machine venv's
// Python, which has build123d. LEARN_PREMIUM_PYTHON names another Python; CONTENT_DIR another
// Course (the Fixture Course by default). Arguments pass through (`-- --module 07-flanged-hub`).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { buildContentDir } from "../content/layout.ts";

const venv = join(homedir(), ".claude", "learn-premium", "venv");
const python =
  process.env.LEARN_PREMIUM_PYTHON ??
  (process.platform === "win32" ? join(venv, "Scripts", "python.exe") : join(venv, "bin", "python"));
if (!existsSync(python)) {
  console.error(`no Python at ${python}: run the installer for the machine venv, or set LEARN_PREMIUM_PYTHON`);
  process.exit(1);
}
const script = resolve(import.meta.dirname, "..", "..", "parts", "build.py");
const run = spawnSync(python, [script, "--content", buildContentDir(), ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(run.status ?? 1);
