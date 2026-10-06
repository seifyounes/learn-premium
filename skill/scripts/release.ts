// The Template release sequence: `node skill/scripts/release.ts <command> …` from a clone of
// learn-premium. Commands and the sequence they enforce: docs/release.md.
import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { run } from "./release/cli.ts";
import { RepoGit } from "./release/git.ts";
import { GhForge } from "./release/github.ts";

const REPO = resolve(import.meta.dirname, "../..");

/**
 * The Owner answers in their own terminal. With no terminal attached (a script, CI, an agent's
 * shell) nobody can vouch for a phone pass, so the answer is no.
 */
async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write(
      "No terminal to confirm in: the real-phone pass is recorded by the Owner, in their own terminal.\n",
    );
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(`${question}: `)).trim().toLowerCase() === "yes";
  } finally {
    rl.close();
  }
}

try {
  const { code, stdout } = await run(process.argv.slice(2), {
    git: new RepoGit(REPO),
    forge: new GhForge(REPO),
    confirm,
  });
  process.stdout.write(`${stdout}\n`);
  process.exitCode = code;
} catch (error) {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exitCode = 1;
}
