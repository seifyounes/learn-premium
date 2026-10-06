// The release sequence's view of the learn-premium repo, through git itself. A release is what
// reached origin: tags are read from origin, never from the local clone.
import { spawnSync } from "node:child_process";

export class GitError extends Error {}

/** The migration file a major release ships: `template/migrations/v<major>.ts`. */
export const MIGRATIONS_PATH = "template/migrations";
const MIGRATION_FILE = /^v(\d+)\.ts$/;

export interface Git {
  /** The branch releases are cut from, as fetched from origin. */
  readonly mainRef: string;
  fetch(): void;
  /** Origin's tags, name → the commit each points at. */
  originTags(): Map<string, string>;
  /** A revision's commit SHA; throws when it names no commit. */
  resolve(rev: string): string;
  isAncestor(ancestor: string, descendant: string): boolean;
  /** Every commit message in `from..to` (all of `to`'s history when `from` is null). */
  messages(from: string | null, to: string): string[];
  /** The migrations the commit ships, with each one's `describe` line. */
  migrations(sha: string): { major: number; file: string; describe: string }[];
  /** Creates an annotated tag and pushes it to origin. */
  tag(name: string, sha: string, message: string): void;
}

export class RepoGit implements Git {
  readonly mainRef = "origin/main";
  readonly repo: string;

  constructor(repo: string) {
    this.repo = repo;
  }

  #git(args: string[], input?: string): string {
    const child = spawnSync("git", ["-C", this.repo, ...args], {
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      maxBuffer: 1 << 28,
      ...(input === undefined ? {} : { input }),
    });
    if (child.error) throw child.error;
    if (child.status !== 0) throw new GitError(child.stderr.trim() || `git ${args[0]} exited ${child.status}`);
    return child.stdout;
  }

  fetch(): void {
    this.#git(["fetch", "--quiet", "origin"]);
  }

  originTags(): Map<string, string> {
    const tags = new Map<string, string>();
    const peeled = new Map<string, string>();
    for (const line of this.#git(["ls-remote", "--tags", "origin"]).split("\n")) {
      const [sha, ref] = line.trim().split(/\s+/);
      if (!sha || !ref?.startsWith("refs/tags/")) continue;
      const name = ref.slice("refs/tags/".length);
      if (name.endsWith("^{}")) peeled.set(name.slice(0, -3), sha);
      else tags.set(name, sha);
    }
    // An annotated tag's own object isn't a commit; its peeled line names the commit.
    for (const [name, sha] of peeled) tags.set(name, sha);
    return tags;
  }

  resolve(rev: string): string {
    return this.#git(["rev-parse", "--verify", "--quiet", `${rev}^{commit}`]).trim();
  }

  isAncestor(ancestor: string, descendant: string): boolean {
    const child = spawnSync("git", ["-C", this.repo, "merge-base", "--is-ancestor", ancestor, descendant]);
    return child.status === 0;
  }

  messages(from: string | null, to: string): string[] {
    const range = from === null ? to : `${from}..${to}`;
    return this.#git(["log", "--format=%B%x00", range])
      .split("\0")
      .map((m) => m.trim())
      .filter(Boolean);
  }

  migrations(sha: string): { major: number; file: string; describe: string }[] {
    // Lists nothing (and succeeds) when the commit has no migrations folder.
    const paths = this.#git(["ls-tree", "--name-only", sha, `${MIGRATIONS_PATH}/`]);
    return paths
      .split("\n")
      .flatMap((path) => {
        const name = path.trim().slice(MIGRATIONS_PATH.length + 1);
        const major = MIGRATION_FILE.exec(name)?.[1];
        return major === undefined ? [] : [{ major: Number(major), file: `${MIGRATIONS_PATH}/${name}` }];
      })
      .sort((a, b) => a.major - b.major)
      .map((m) => {
        const source = this.#git(["show", `${sha}:${m.file}`]);
        const describe = /export const describe\s*=\s*(["'`])(.+?)\1/.exec(source)?.[2] ?? m.file;
        return { ...m, describe };
      });
  }

  tag(name: string, sha: string, message: string): void {
    this.#git(["tag", "--annotate", "--cleanup=verbatim", "--file=-", name, sha], message);
    try {
      this.#git(["push", "--quiet", "origin", `refs/tags/${name}`]);
    } catch (error) {
      // Leave no local-only tag behind: a release is what reached origin.
      this.#git(["tag", "--delete", name]);
      throw error;
    }
  }
}
