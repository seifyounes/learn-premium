// The pre-commit gate's entry, run by the Course project's hook (`hooks/pre-commit`) from the repo
// root: `node template/gates/pre-commit-cli.ts [--repo DIR]`. Exit 0 lets the commit through; 1
// blocks it, on a finding or when the check can't run.
import { parseArgs } from "node:util";
import { checkCommit } from "./pre-commit.ts";

const { values } = parseArgs({ args: process.argv.slice(2), options: { repo: { type: "string" } } });
const repo = values.repo ?? process.cwd();

try {
  const { coverage, findings } = checkCommit(repo);
  if (findings.length === 0) {
    console.log(
      `pre-commit gate: ${coverage.stagedFiles} staged files clear (no Materials file, no evidence-shaped path)`,
    );
  } else {
    console.error("pre-commit gate: blocked. Nothing was committed.");
    for (const f of findings) console.error(`  ${f.path}: ${f.message}`);
    console.error(
      "Unstage these (git restore --staged <path>); Professor-derived evidence goes in the Private folder.",
    );
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`pre-commit gate: blocked, the check couldn't run: ${(error as Error).message}`);
  process.exitCode = 1;
}
