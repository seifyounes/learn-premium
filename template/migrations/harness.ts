// The migration harness. A Template release must carry every Course from the release before it:
// CI takes the previous release's Fixture Course (the latest release tag behind HEAD), copies it
// out of git, runs every newer major's migration on the copy in order, and checks the result with
// this template. Within one major no migration runs, so the old content must pass as it is: a
// content-contract change that breaks it needs a major release and its migration.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contentContract } from "../gates/content.ts";
import { MigrationError, RELEASE_TAG, runMigrations, type MigrationRun } from "./runner.ts";

/** Where the Fixture Course sits in the learn-premium repo. */
export const FIXTURE_PATH = "fixture-course";

/** Checks an upgraded Course's content; returns one line per problem, none when it passes. */
export type Prover = (contentDir: string) => Promise<string[]>;

export interface UpgradeProof {
  /** The release whose Fixture Course was upgraded; null before the first release. */
  previous: string | null;
  migrations: MigrationRun[];
  problems: string[];
  /** The upgraded copy, when there was one. */
  contentDir?: string;
}

function git(repo: string, args: string[], env: NodeJS.ProcessEnv = {}): string {
  const child = spawnSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env, GIT_TERMINAL_PROMPT: "0" },
  });
  if (child.error) throw child.error;
  if (child.status !== 0) throw new Error(`git ${args[0]}: ${child.stderr.trim()}`);
  return child.stdout.trim();
}

const version = (tag: string) => (RELEASE_TAG.exec(tag) ?? []).slice(1).map(Number);

function newer(a: string, b: string): number {
  const [x, y] = [version(a), version(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}

/** The latest Template release behind `head`: reachable from it, and not on `head` itself. */
export function previousRelease(repo: string, head = "HEAD"): string | null {
  const headCommit = git(repo, ["rev-parse", `${head}^{commit}`]);
  const tags = git(repo, ["tag", "--merged", headCommit, "--list", "v*"])
    .split("\n")
    .filter((tag) => RELEASE_TAG.test(tag))
    .filter((tag) => git(repo, ["rev-parse", `${tag}^{commit}`]) !== headCommit)
    .sort(newer);
  return tags.at(-1) ?? null;
}

/** Copies the Fixture Course as it was at `tag` into a fresh folder, through a throwaway index. */
export function fixtureAt(repo: string, tag: string): string {
  const scratch = mkdtempSync(join(tmpdir(), "lp-upgrade-"));
  const course = join(scratch, FIXTURE_PATH);
  mkdirSync(course);
  const env = { GIT_INDEX_FILE: join(scratch, "index") };
  git(repo, ["read-tree", `${tag}:${FIXTURE_PATH}`], env);
  git(repo, ["checkout-index", "--all", `--prefix=${course.replaceAll("\\", "/")}/`], env);
  return course;
}

/** The content contract (the Zod schemas) on the whole Course: the content-contract gate's findings. */
export const contractProblems: Prover = async (contentDir) => {
  const run = await contentContract.run({ contentDir });
  return run.findings.map((f) => `${f.at ?? "(course)"}: ${f.message}`);
};

/**
 * Upgrades a copy of the previous release's Fixture Course with the migrations in `dir` (the
 * template's own by default) and checks it with `prove`. Before the first release there is
 * nothing to upgrade.
 */
export async function proveUpgrade(options: {
  repo: string;
  head?: string;
  dir?: string;
  prove: Prover;
}): Promise<UpgradeProof> {
  const previous = previousRelease(options.repo, options.head);
  if (previous === null) return { previous, migrations: [], problems: [] };
  const contentDir = fixtureAt(options.repo, previous);
  let migrations: MigrationRun[];
  try {
    migrations = await runMigrations({ contentDir, from: previous, ...(options.dir ? { dir: options.dir } : {}) });
  } catch (error) {
    if (!(error instanceof MigrationError)) throw error;
    return { previous, migrations: [], problems: [error.message], contentDir };
  }
  return { previous, migrations, problems: await options.prove(contentDir), contentDir };
}
