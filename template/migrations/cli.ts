// Content migrations and the migration harness: `npm run migrations -- <command> …` from the
// template folder.
//
//   run    --content DIR --from vX.Y.Z [--to vX.Y.Z]
//          Runs every shipped migration newer than the release the content was written at (up to
//          --to), oldest first, rewriting DIR in place. The Upgrade wave runs it on its branch.
//   prove  [--repo DIR]
//          The migration harness: upgrades a copy of the Fixture Course of every release behind
//          HEAD through the remaining migrations and checks each against the content contract;
//          the last release of each major (the previous release among them) is also built.
//
// Exit codes: 0 green, 1 red, 2 bad usage.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { contractProblems, proveAllUpgrades, type Prover } from "./harness.ts";
import { runMigrations } from "./runner.ts";

const TEMPLATE_DIR = resolve(import.meta.dirname, "..");

class UsageError extends Error {}

/** The Site template builds the Course, the way `npm run build` does. */
const builds: Prover = async (contentDir) => {
  // Astro moves its output with rename(), so the output sits on the template's own drive.
  mkdirSync(join(TEMPLATE_DIR, ".test-out"), { recursive: true });
  const outDir = mkdtempSync(join(TEMPLATE_DIR, ".test-out", "upgrade-"));
  try {
    const build = spawnSync(process.execPath, ["node_modules/astro/bin/astro.mjs", "build", "--outDir", outDir], {
      cwd: TEMPLATE_DIR,
      env: { ...process.env, CONTENT_DIR: contentDir, FORCE_COLOR: "0", NO_COLOR: "1" },
      encoding: "utf8",
    });
    if (build.status === 0) return [];
    const tail = `${build.stdout}\n${build.stderr}`.trim().split("\n").slice(-30).join("\n");
    return [`the Site template doesn't build the upgraded Course:\n${tail}`];
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
};

/** The content contract first (it names each file and field), then the build. */
const contractThenBuild: Prover = async (contentDir) => {
  const problems = await contractProblems(contentDir);
  return problems.length > 0 ? problems : builds(contentDir);
};

async function main(argv: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      content: { type: "string" },
      from: { type: "string" },
      to: { type: "string" },
      repo: { type: "string" },
    },
  });
  switch (positionals[0]) {
    case "run": {
      if (values.content === undefined || values.from === undefined)
        throw new UsageError("run takes --content DIR and --from vX.Y.Z");
      const ran = await runMigrations({
        contentDir: resolve(values.content),
        from: values.from,
        ...(values.to === undefined ? {} : { to: values.to }),
      });
      if (ran.length === 0) console.log(`no migration to run from ${values.from}`);
      for (const m of ran) console.log(`ran v${m.major}: ${m.describe}`);
      return 0;
    }
    case "prove": {
      const proofs = await proveAllUpgrades({
        repo: resolve(values.repo ?? join(TEMPLATE_DIR, "..")),
        prove: contractThenBuild,
        quickProve: contractProblems,
      });
      if (proofs.length === 0) {
        console.log("green: no Template release yet, so no earlier Fixture Course to upgrade");
        return 0;
      }
      for (const proof of proofs) {
        console.log(`upgraded the Fixture Course of ${proof.previous} (copy at ${proof.contentDir})`);
        if (proof.migrations.length === 0) console.log("  no migration: the same major, so it must pass as it is");
        for (const m of proof.migrations) console.log(`  ran v${m.major}: ${m.describe}`);
        for (const problem of proof.problems) console.log(`  block: ${problem}`);
      }
      const red = proofs.filter((p) => p.problems.length > 0).map((p) => p.previous);
      console.log(
        red.length === 0 ? "green: every upgrade passes this template" : `red: ${red.join(", ")} don't upgrade`,
      );
      return red.length === 0 ? 0 : 1;
    }
    default:
      throw new UsageError(`unknown command "${positionals[0] ?? ""}"; use run or prove`);
  }
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = error instanceof UsageError ? 2 : 1;
}
