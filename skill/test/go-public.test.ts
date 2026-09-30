// The Go-public check through its command interface, on throwaway Course project repos.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { run } from "../scripts/go-public/cli.ts";
import { jsonInput, ledger, tempDir, writeFiles, type Result } from "./helpers.ts";

const ENTRY = fileURLToPath(new URL("../scripts/go-public.ts", import.meta.url));

const LECTURE_1 = "%PDF-1.7 Lecture 1: the Professor's slides on thermal resistance";
const LECTURE_2 = "%PDF-1.7 Lecture 2: the Professor's slides on fins";
const LICENCES = "Third-party notices\n\nastro (MIT)\nkatex (MIT)\n";

// Built at run time so no token-shaped string sits in this repo for a secret scanner to trip on.
const ANTHROPIC_KEY = ["sk", "ant", "api03", "a1B2c3D4e5F6".repeat(7)].join("-");
const GITHUB_TOKEN = ["ghp", "Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4J3i2"].join("_");

async function check(...args: string[]): Promise<Result> {
  const { code, stdout } = await run(args);
  return { code, out: JSON.parse(stdout) };
}

function git(repo: string, ...args: string[]): string {
  const child = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  if (child.status !== 0) throw new Error(`git ${args.join(" ")}: ${child.stderr}`);
  return child.stdout.trim();
}

function newRepo(prefix = "course"): string {
  const repo = tempDir(prefix);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "owner@example.com");
  git(repo, "config", "user.name", "Owner");
  git(repo, "config", "core.autocrlf", "false");
  return repo;
}

/** Writes `files`, deletes `remove`, commits everything and returns the commit's SHA. */
function commit(repo: string, message: string, files: Record<string, string> = {}, remove: string[] = []): string {
  writeFiles(repo, files);
  for (const path of remove) rmSync(join(repo, path));
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "--allow-empty", "-m", message);
  return git(repo, "rev-parse", "HEAD");
}

/** A Course project with its Build ledger, both lectures mapped, and the Licences file committed. */
function course() {
  const materials = tempDir("materials");
  writeFiles(materials, { "L01.pdf": LECTURE_1, "L02.pdf": LECTURE_2 });
  const project = newRepo();
  const intake = {
    courseName: "Heat Transfer",
    materialsPath: materials,
    disciplines: ["heat transfer"],
    pad: "teal",
    arabicNotes: false,
    sittings: [],
  };
  ledger("init", "--project", project, "--holder", "run", "--release", "v2.0.0", "--intake", jsonInput(intake));
  const map = { modules: [{ id: "01", slug: "conduction", title: "Conduction", materials: ["L01.pdf", "L02.pdf"] }] };
  ledger("map", "--project", project, "--holder", "run", "--input", jsonInput({ ...map, unmapped: [] }));
  commit(project, "chore: start the Course project", {
    "README.md": "# Heat Transfer\n",
    "public/licences.txt": LICENCES,
    "modules/01-conduction/module.yaml": "title: Conduction\n",
  });
  return { project, materials };
}

function findings(out: Result["out"], kind: string): Result["out"][] {
  return out.findings.filter((finding: { check: string }) => finding.check === kind);
}

describe("Go-public check", () => {
  test("a clean Course project is clear, and the report says what it scanned", async () => {
    const { project } = course();
    commit(project, "feat: Module 01", { "modules/01-conduction/summary/1.md": "Heat flows from hot to cold.\n" });

    const { code, out } = await check("--project", project);

    expect(code).toBe(0);
    expect(out).toMatchObject({ ok: true, verdict: "clear", findings: [] });
    expect(out.scanned.commits).toBe(2);
    expect(out.scanned.blobs).toBeGreaterThanOrEqual(5);
    expect(out.materials).toMatchObject({ ledgerRows: 2, materialsFolder: expect.any(String) });
    expect(out.licencesFile).toEqual({ path: "public/licences.txt", present: true });
  });

  test("finds a Materials file committed deep in history under another name, and since deleted", async () => {
    const { project, materials } = course();
    const planted = commit(project, "chore: add a figure", { "assets/figure.bin": LECTURE_1 });
    for (let n = 1; n <= 6; n++)
      commit(project, `feat: step ${n}`, { [`modules/01-conduction/summary/${n}.md`]: `${n}\n` });
    commit(project, "chore: drop the figure", {}, ["assets/figure.bin"]);
    rmSync(join(materials, "L01.pdf")); // only the ledger's inventory still knows it

    const { code, out } = await check("--project", project);

    expect(code).toBe(1);
    expect(out.verdict).toBe("blocked");
    expect(findings(out, "materials")).toEqual([
      expect.objectContaining({
        severity: "block",
        path: "assets/figure.bin",
        commits: [planted],
        material: "L01.pdf",
      }),
    ]);
  });

  test("finds a Materials file on a branch that never reached main", async () => {
    const { project } = course();
    git(project, "checkout", "-q", "-b", "scratch");
    const planted = commit(project, "wip", { "tmp/l2.pdf": LECTURE_2 });
    git(project, "checkout", "-q", "main");

    const { out } = await check("--project", project);

    expect(findings(out, "materials")).toEqual([
      expect.objectContaining({ path: "tmp/l2.pdf", commits: [planted], material: "L02.pdf" }),
    ]);
  });

  test("finds a Materials file that only a merge commit brought in", async () => {
    const { project } = course();
    git(project, "checkout", "-q", "-b", "side");
    commit(project, "feat: side", { "side.md": "side\n" });
    git(project, "checkout", "-q", "main");
    commit(project, "feat: main", { "main.md": "main\n" });
    git(project, "merge", "-q", "--no-commit", "side");
    const merge = commit(project, "Merge side", { "merged/l1.pdf": LECTURE_1 });

    const { out } = await check("--project", project);

    expect(findings(out, "materials")).toEqual([
      expect.objectContaining({ path: "merged/l1.pdf", commits: [merge], material: "L01.pdf" }),
    ]);
  });

  test("matches superseded Materials versions, files not mapped yet, and the Private folder's files", async () => {
    const { project, materials } = course();
    writeFiles(materials, { "L01.pdf": `${LECTURE_1} (revised)`, "L03.pdf": "%PDF-1.7 Lecture 3, not mapped yet" });
    ledger(
      "wave",
      "start",
      "--project",
      project,
      "--holder",
      "run",
      "--kind",
      "module",
      "--target",
      "01",
      "--branch",
      "m01",
    );
    const privateFolder = tempDir("private");
    writeFiles(privateFolder, { "reader/L01.pdf/pages/page-001.png": "PNG render of page 1" });
    commit(project, "chore: stray files", {
      "a/old.pdf": LECTURE_1,
      "b/new.pdf": "%PDF-1.7 Lecture 3, not mapped yet",
      "c/page.png": "PNG render of page 1",
    });

    const { out } = await check("--project", project, "--private", privateFolder);

    const matched = findings(out, "materials").map((finding) => [finding.path, finding.material]);
    expect(matched).toEqual([
      ["a/old.pdf", "L01.pdf"],
      ["b/new.pdf", "L03.pdf"],
      ["c/page.png", "reader/L01.pdf/pages/page-001.png"],
    ]);
    expect(out.materials.privateFolder).toBe(privateFolder);
  });

  test("an empty Material matches nothing, not every empty file in history", async () => {
    const { project, materials } = course();
    writeFiles(materials, { "notes/empty.txt": "" });
    commit(project, "chore: keep the folder", { "src/.gitkeep": "" });

    const { code, out } = await check("--project", project);

    expect(findings(out, "materials")).toEqual([]);
    expect(code).toBe(0);
  });

  test("a Private-folder file other than the reader's output is a Checkpoint item, as a media master may be", async () => {
    const { project } = course();
    const privateFolder = tempDir("private");
    writeFiles(privateFolder, { "media/01/infographic.png": "the master infographic" });
    commit(project, "feat: media", { "public/media/01/infographic.png": "the master infographic" });

    const { code, out } = await check("--project", project, "--private", privateFolder);

    expect(code).toBe(1);
    expect(out.verdict).toBe("review");
    expect(findings(out, "materials")).toEqual([
      expect.objectContaining({ severity: "checkpoint", material: "media/01/infographic.png" }),
    ]);
  });

  test("matches a text Material committed with its line endings normalised", async () => {
    const { project, materials } = course();
    writeFiles(materials, { "lab/solver.py": "def solve():\r\n    return 42\r\n" });
    commit(project, "chore: copy the lab code", { "tools/solver.py": "def solve():\n    return 42\n" });

    const { out } = await check("--project", project);

    expect(findings(out, "materials")).toEqual([
      expect.objectContaining({ path: "tools/solver.py", material: "lab/solver.py" }),
    ]);
  });

  test("finds evidence-shaped paths anywhere in history", async () => {
    const { project } = course();
    commit(project, "chore: evidence", {
      "notes/heat-private/q3.md": "what the Professor said",
      "work/reader/L01.pdf/pages/page-001.png": "render",
      "transcripts/L03.json": "{}",
    });
    commit(project, "chore: remove evidence", {}, [
      "notes/heat-private/q3.md",
      "work/reader/L01.pdf/pages/page-001.png",
      "transcripts/L03.json",
    ]);

    const { code, out } = await check("--project", project);

    expect(code).toBe(1);
    expect(findings(out, "evidence").map((finding) => finding.path)).toEqual([
      "notes/heat-private/q3.md",
      "transcripts/L03.json",
      "work/reader/L01.pdf/pages/page-001.png",
    ]);
  });

  test("finds a secret committed and later removed, and never prints it", async () => {
    const { project } = course();
    const planted = commit(project, "feat: config", {
      "src/config.ts": `export const site = "heat";\nexport const key = "${ANTHROPIC_KEY}";\n`,
    });
    commit(project, "fix: drop the key", { "src/config.ts": 'export const site = "heat";\n' });

    const { code, out } = await check("--project", project);

    expect(code).toBe(1);
    expect(findings(out, "secret")).toEqual([
      expect.objectContaining({
        severity: "block",
        path: "src/config.ts",
        commits: [planted],
        rule: "anthropic-api-key",
        lines: [2],
      }),
    ]);
    expect(JSON.stringify(out)).not.toContain(ANTHROPIC_KEY.slice(10));
  });

  test("finds a secret in a commit message and in an annotated tag's message", async () => {
    const { project } = course();
    const planted = commit(project, `chore: deploy with ${GITHUB_TOKEN}`, { "a.md": "a\n" });
    git(project, "tag", "-a", "v1", "-m", `release\n\nkey ${ANTHROPIC_KEY}`);

    const { out } = await check("--project", project);

    expect(findings(out, "secret")).toEqual([
      expect.objectContaining({ severity: "block", tag: "refs/tags/v1", rule: "anthropic-api-key", lines: [3] }),
      expect.objectContaining({ severity: "block", commits: [planted], rule: "github-token" }),
    ]);
    expect(out.scanned.messages).toBe(3);
    expect(JSON.stringify(out)).not.toContain(GITHUB_TOKEN.slice(8));
  });

  test("finds a committed .env file and a token in a file that isn't code", async () => {
    const { project } = course();
    commit(project, "chore: env", { ".env.local": "VERCEL_ORG=me\n", "docs/setup.md": `token: ${GITHUB_TOKEN}\n` });

    const { out } = await check("--project", project);

    expect(findings(out, "secret").map((finding) => [finding.path, finding.rule])).toEqual([
      [".env.local", "env-file"],
      ["docs/setup.md", "github-token"],
    ]);
  });

  test("an assignment that only looks like a secret is a Checkpoint item for the Owner", async () => {
    const { project } = course();
    commit(project, "feat: sim", { "src/sim.ts": 'const session_token = "k3y9Pq7Lm2Nx8Rt4Vw6Z";\n' });

    const { code, out } = await check("--project", project);

    expect(code).toBe(1);
    expect(out.verdict).toBe("review");
    expect(findings(out, "secret")).toEqual([
      expect.objectContaining({ severity: "checkpoint", rule: "secret-assignment", path: "src/sim.ts" }),
    ]);
  });

  test("fails without the Licences file at HEAD, even when history had it", async () => {
    const { project } = course();
    commit(project, "chore: tidy", {}, ["public/licences.txt"]);

    const { code, out } = await check("--project", project);

    expect(code).toBe(1);
    expect(out.licencesFile).toEqual({ path: "public/licences.txt", present: false });
    expect(findings(out, "licences-file")).toEqual([expect.objectContaining({ severity: "block" })]);
  });

  test("fails an empty Licences file", async () => {
    const { project } = course();
    commit(project, "chore: regenerate", { "public/licences.txt": "" });

    expect((await check("--project", project)).out.licencesFile.present).toBe(false);
  });

  test("fails when the Course project carries a licence of its own", async () => {
    const { project } = course();
    commit(project, "chore: licence", { "LICENSE.md": "MIT License\n" });

    const { out } = await check("--project", project);

    expect(findings(out, "own-licence")).toEqual([expect.objectContaining({ severity: "block", path: "LICENSE.md" })]);
  });

  test("a branch on the remote that was never fetched can't be scanned, so it fails until fetched", async () => {
    const { project } = course();
    const remote = tempDir("remote");
    git(remote, "init", "-q", "--bare", "-b", "main");
    git(project, "remote", "add", "origin", remote);
    git(project, "push", "-q", "origin", "main");
    const other = tempDir("clone");
    git(other, "clone", "-q", remote, ".");
    git(other, "config", "user.email", "classmate@example.com");
    git(other, "config", "user.name", "Classmate");
    git(other, "checkout", "-q", "-b", "draft");
    commit(other, "wip", { "draft/l1.pdf": LECTURE_1 });
    git(other, "push", "-q", "origin", "draft");

    const before = await check("--project", project);
    git(project, "fetch", "-q", "origin");
    const after = await check("--project", project);

    expect(findings(before.out, "unscanned-ref")).toEqual([
      expect.objectContaining({ severity: "block", ref: "origin refs/heads/draft" }),
    ]);
    expect(findings(before.out, "materials")).toEqual([]);
    expect(findings(after.out, "unscanned-ref")).toEqual([]);
    expect(findings(after.out, "materials")).toEqual([expect.objectContaining({ path: "draft/l1.pdf" })]);
  });

  test("a remote that can't be reached blocks: its refs weren't checked", async () => {
    const { project } = course();
    git(project, "remote", "add", "origin", join(tempDir("gone"), "no-such-repo"));

    const { code, out } = await check("--project", project);

    expect(code).toBe(1);
    expect(findings(out, "remote-unreachable")).toEqual([
      expect.objectContaining({ severity: "block", remote: "origin" }),
    ]);
  });

  test("refuses a shallow clone, whose history is cut off", async () => {
    const { project } = course();
    commit(project, "chore: stray", { "a/l1.pdf": LECTURE_1 });
    commit(project, "chore: drop it", {}, ["a/l1.pdf"]);
    const shallow = tempDir("shallow");
    git(shallow, "clone", "-q", "--depth", "1", `file://${project.replaceAll("\\", "/")}`, ".");

    expect(await check("--project", shallow)).toMatchObject({ code: 2, out: { ok: false } });
  });

  test("never changes the repo or its visibility", async () => {
    const { project } = course();
    commit(project, "chore: stray", { "a/l1.pdf": LECTURE_1 });
    const fakeBin = tempDir("bin");
    const called = join(fakeBin, "gh-was-called");
    writeFileSync(join(fakeBin, "gh"), `#!/bin/sh\necho "$@" > "${called}"\n`);
    chmodSync(join(fakeBin, "gh"), 0o755);
    writeFileSync(join(fakeBin, "gh.cmd"), `@echo %* > "${called}"\r\n`);
    const snapshot = () => ({
      refs: git(project, "for-each-ref"),
      head: git(project, "symbolic-ref", "HEAD"),
      status: git(project, "status", "--porcelain"),
      config: readFileSync(join(project, ".git", "config"), "utf8"),
    });
    const before = snapshot();

    const child = spawnSync(process.execPath, [ENTRY, "--project", project], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${fakeBin}${delimiter}${process.env["PATH"]}` },
    });

    expect(child.status).toBe(1);
    expect(JSON.parse(child.stdout).verdict).toBe("blocked");
    expect(existsSync(called)).toBe(false);
    expect(snapshot()).toEqual(before);
  });

  test("refuses no Build ledger, a folder that isn't a repo's root, an empty repo and bad flags", async () => {
    const bare = newRepo();
    commit(bare, "init", { "README.md": "x\n", "sub/file.md": "y\n" });

    expect(await check("--project", bare)).toMatchObject({ code: 2, out: { ok: false } });
    expect(await check("--project", tempDir("plain"))).toMatchObject({ code: 2, out: { ok: false } });
    expect(await check("--projct", bare)).toMatchObject({ code: 2, out: { ok: false } });
    expect(await check("--project", join(bare, "sub"))).toMatchObject({ code: 2, out: { ok: false } });
    expect(await check("--project", newRepo("empty"))).toMatchObject({ code: 2, out: { ok: false } });
    expect(await check("--project", course().project, "--private", join(tempDir("x"), "gone"))).toMatchObject({
      code: 2,
      out: { ok: false },
    });
  });
});
