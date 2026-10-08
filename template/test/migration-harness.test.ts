// The migration harness: CI upgrades a copy of the previous Template release's Fixture Course,
// running every newer major's migration in order, and checks the result against this template's
// content contract. Here on throwaway repos tagged the way releases are.
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contractProblems, proveAllUpgrades, proveUpgrade } from "../migrations/harness.ts";
import { FIXTURE_COURSE } from "./build-course";

function git(repo: string, ...args: string[]): string {
  const child = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  if (child.status !== 0) throw new Error(`git ${args.join(" ")}: ${child.stderr}`);
  return child.stdout.trim();
}

/** A repo whose first commit holds a copy of the Fixture Course. */
function repoWithFixture(): string {
  const repo = mkdtempSync(join(tmpdir(), "lp-release-repo-"));
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "owner@example.com");
  git(repo, "config", "user.name", "Owner");
  git(repo, "config", "core.autocrlf", "false");
  cpSync(FIXTURE_COURSE, join(repo, "fixture-course"), { recursive: true });
  commit(repo, "the Fixture Course");
  return repo;
}

function commit(repo: string, message: string): string {
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "--allow-empty", "-m", message);
  return git(repo, "rev-parse", "HEAD");
}

/** Edits a file of the repo's Fixture Course. */
function editFixture(repo: string, file: string, edit: (source: string) => string): void {
  const path = join(repo, "fixture-course", file);
  writeFileSync(path, edit(readFileSync(path, "utf8")));
}

/** A migrations folder holding `files` (name → source). */
function migrations(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "lp-migrations-"));
  for (const [name, source] of Object.entries(files)) writeFileSync(join(dir, name), source);
  return dir;
}

/** A field the content contract has never accepted in course.yaml. */
const LEGACY_FIELD = (source: string) => `${source}legacyTitle: Fixture Course\n`;

const DROP_LEGACY_FIELD = [
  `import { readFileSync, writeFileSync } from "node:fs";`,
  `import { join } from "node:path";`,
  `export const describe = "course.yaml drops legacyTitle";`,
  `export function migrate(contentDir: string): void {`,
  `  const path = join(contentDir, "course.yaml");`,
  `  writeFileSync(path, readFileSync(path, "utf8").replace(/^legacyTitle:.*\\n/m, ""));`,
  `}`,
].join("\n");

describe("proveUpgrade", () => {
  it("has nothing to upgrade before the first Template release", async () => {
    const repo = repoWithFixture();
    let proved = false;
    const result = await proveUpgrade({
      repo,
      dir: migrations(),
      prove: async () => {
        proved = true;
        return [];
      },
    });
    expect(result).toMatchObject({ previous: null, migrations: [], problems: [] });
    expect(proved).toBe(false);
  });

  it("checks the previous release's Fixture Course, not the one at HEAD", async () => {
    const repo = repoWithFixture();
    git(repo, "tag", "v0.1.0");
    editFixture(repo, "course.yaml", (s) => s.replace("name: Fixture Course", "name: Fixture Course Two"));
    commit(repo, "rename the course");
    const result = await proveUpgrade({ repo, dir: migrations(), prove: contractProblems });
    expect(result).toMatchObject({ previous: "v0.1.0", migrations: [], problems: [] });
    expect(readFileSync(join(result.contentDir ?? "", "course.yaml"), "utf8")).toContain("name: Fixture Course\n");
  });

  it("takes the release before HEAD's own tag, by version and not by tag order", async () => {
    const repo = repoWithFixture();
    git(repo, "tag", "v0.9.0");
    commit(repo, "later");
    git(repo, "tag", "v0.10.0");
    git(repo, "tag", "v0.10.0-rc1");
    commit(repo, "the release candidate");
    git(repo, "tag", "v0.11.0");
    const result = await proveUpgrade({ repo, dir: migrations(), prove: async () => [] });
    expect(result.previous).toBe("v0.10.0");
  });

  it("is red when the previous Fixture Course breaks this template's content contract (negative control)", async () => {
    const repo = repoWithFixture();
    editFixture(repo, "course.yaml", LEGACY_FIELD);
    commit(repo, "a course.yaml field this contract drops");
    git(repo, "tag", "v0.4.0");
    commit(repo, "the next release");
    const result = await proveUpgrade({ repo, dir: migrations(), prove: contractProblems });
    expect(result.previous).toBe("v0.4.0");
    expect(result.problems.join("\n")).toMatch(/course\.yaml: .*legacyTitle/);
  });

  it("runs the shipped migrations on a copy and is green once they bring the content up to the contract", async () => {
    const repo = repoWithFixture();
    editFixture(repo, "course.yaml", LEGACY_FIELD);
    commit(repo, "a course.yaml field this contract drops");
    git(repo, "tag", "v0.4.0");
    commit(repo, "the next release");
    const result = await proveUpgrade({
      repo,
      dir: migrations({ "v1.ts": DROP_LEGACY_FIELD }),
      prove: contractProblems,
    });
    expect(result).toMatchObject({
      previous: "v0.4.0",
      migrations: [{ major: 1, describe: "course.yaml drops legacyTitle" }],
      problems: [],
    });
    // The repo's own Fixture Course is untouched: the migration ran on the copy.
    expect(readFileSync(join(repo, "fixture-course", "course.yaml"), "utf8")).toContain("legacyTitle");
  });

  it("is red when a migration breaks the content (negative control)", async () => {
    const repo = repoWithFixture();
    git(repo, "tag", "v1.0.0");
    commit(repo, "the next release");
    const breaksPad = [
      `import { readFileSync, writeFileSync } from "node:fs";`,
      `import { join } from "node:path";`,
      `export const describe = "renames the pad";`,
      `export function migrate(contentDir: string): void {`,
      `  const path = join(contentDir, "course.yaml");`,
      `  writeFileSync(path, readFileSync(path, "utf8").replace("pad: green", "pad: chartreuse"));`,
      `}`,
    ].join("\n");
    const result = await proveUpgrade({ repo, dir: migrations({ "v2.ts": breaksPad }), prove: contractProblems });
    expect(result.migrations).toEqual([{ major: 2, describe: "renames the pad" }]);
    expect(result.problems.join("\n")).toMatch(/course\.yaml: pad/);
  });

  it("is red when a migration throws, and checks nothing after it", async () => {
    const repo = repoWithFixture();
    git(repo, "tag", "v1.0.0");
    commit(repo, "the next release");
    const throws = `export const describe = "x";\nexport function migrate(): void { throw new Error("boom"); }\n`;
    let proved = false;
    const result = await proveUpgrade({
      repo,
      dir: migrations({ "v2.ts": throws }),
      prove: async () => {
        proved = true;
        return [];
      },
    });
    expect(result.problems).toEqual(["the v2 migration failed: boom"]);
    expect(proved).toBe(false);
  });
});

describe("proveAllUpgrades", () => {
  /** v1.0.0's course.yaml carries legacyTitle; v2.0.0's no longer does (its migration dropped it). */
  function twoMajors(): string {
    const repo = repoWithFixture();
    editFixture(repo, "course.yaml", LEGACY_FIELD);
    commit(repo, "a course.yaml field the v2 contract drops");
    git(repo, "tag", "v1.0.0");
    git(repo, "tag", "v1.0.1-rc1");
    editFixture(repo, "course.yaml", (s) => s.replace(/^legacyTitle:.*\n/m, ""));
    commit(repo, "the v2 contract");
    git(repo, "tag", "v2.0.0");
    commit(repo, "the next release");
    return repo;
  }
  const noop = (describe: string) => `export const describe = "${describe}";\nexport function migrate(): void {}\n`;

  it("replays the last release of every major through the rest of the chain", async () => {
    const repo = twoMajors();
    const proofs = await proveAllUpgrades({
      repo,
      dir: migrations({ "v2.ts": DROP_LEGACY_FIELD, "v3.ts": noop("v3 step") }),
      prove: contractProblems,
    });
    expect(proofs.map((p) => [p.previous, p.migrations.map((m) => m.major), p.problems])).toEqual([
      ["v1.0.0", [2, 3], []],
      ["v2.0.0", [3], []],
    ]);
  });

  it("is red when an older major's Course breaks on the chain, though the previous release upgrades (negative control)", async () => {
    const repo = twoMajors();
    // A v2 migration that no longer drops the field: v2.0.0's own Fixture Course never needed it.
    const proofs = await proveAllUpgrades({
      repo,
      dir: migrations({ "v2.ts": noop("forgets legacyTitle"), "v3.ts": noop("v3 step") }),
      prove: contractProblems,
    });
    expect(proofs.find((p) => p.previous === "v2.0.0")?.problems).toEqual([]);
    expect(proofs.find((p) => p.previous === "v1.0.0")?.problems.join("\n")).toMatch(/legacyTitle/);
  });

  it("checks every release of a major, building only its last (negative control on an earlier one)", async () => {
    const repo = repoWithFixture();
    editFixture(repo, "course.yaml", LEGACY_FIELD);
    commit(repo, "a field only v1.0.0's Fixture Course keeps");
    git(repo, "tag", "v1.0.0");
    editFixture(repo, "course.yaml", (s) => s.replace(/^legacyTitle:.*\n/m, ""));
    commit(repo, "v1.1.0 no longer uses it");
    git(repo, "tag", "v1.1.0");
    commit(repo, "the next release");
    const fullyProved: string[] = [];
    const proofs = await proveAllUpgrades({
      repo,
      dir: migrations(),
      prove: async (dir) => {
        fullyProved.push(readFileSync(join(dir, "course.yaml"), "utf8").includes("legacyTitle") ? "v1.0.0" : "v1.1.0");
        return contractProblems(dir);
      },
      quickProve: contractProblems,
    });
    expect(proofs.map((p) => p.previous)).toEqual(["v1.0.0", "v1.1.0"]);
    expect(fullyProved).toEqual(["v1.1.0"]);
    expect(proofs[0]?.problems.join("\n")).toMatch(/legacyTitle/);
    expect(proofs[1]?.problems).toEqual([]);
  });

  it("has nothing to upgrade before the first release", async () => {
    const proofs = await proveAllUpgrades({ repo: repoWithFixture(), dir: migrations(), prove: contractProblems });
    expect(proofs).toEqual([]);
  });
});
