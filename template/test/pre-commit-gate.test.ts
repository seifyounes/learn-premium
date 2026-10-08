import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { checkCommit } from "../gates/pre-commit.ts";

const GATES = resolve(import.meta.dirname, "../gates");
const LECTURE = "%PDF-1.7 synthetic lecture 1, not a real Material\n";
const NOTES = "Lecture 2 notes\r\nline two\r\n";
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

function git(repo: string, ...args: string[]) {
  return spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
}

function write(root: string, files: Record<string, string>) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

/**
 * A synthetic Course project: a git repo whose Build ledger lists the mapped Lecture 1, beside a
 * Materials folder that also holds files the Module map hasn't taken in yet.
 */
function courseProject() {
  const root = mkdtempSync(join(tmpdir(), "lp-precommit-"));
  const materials = join(root, "materials");
  const repo = join(root, "project");
  write(materials, {
    "Lecture 1.pdf": LECTURE,
    "Lecture 2/notes.txt": NOTES,
    "Board/new photo.jpg": "a new board photo",
  });
  write(repo, {
    "build-ledger.json": JSON.stringify({
      intake: { materialsPath: materials },
      materials: [{ path: "Lecture 1.pdf", hash: sha256(LECTURE) }],
    }),
    "content/course.yaml": "name: Synthetic\n",
  });
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.name", "Fixture");
  git(repo, "config", "user.email", "fixture@example.test");
  git(repo, "config", "commit.gpgsign", "false");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "chore: start");
  return { repo, materials };
}

function stage(repo: string, files: Record<string, string>) {
  write(repo, files);
  git(repo, "add", "-A");
}

describe("the pre-commit gate", () => {
  it("lets ordinary Course files through, reporting what it looked at", () => {
    const { repo } = courseProject();
    stage(repo, { "content/modules/01-intro/module.yaml": "title: Intro\n" });
    const result = checkCommit(repo);
    expect(result.findings).toEqual([]);
    expect(result.coverage.stagedFiles).toBe(1);
    expect(result.coverage.materialsHashes).toBeGreaterThanOrEqual(1);
  });

  it("blocks a planted Materials file under another name (negative control)", () => {
    const { repo } = courseProject();
    stage(repo, { "content/modules/01-intro/figure.png": LECTURE });
    expect(checkCommit(repo).findings).toEqual([
      {
        path: "content/modules/01-intro/figure.png",
        message: "is the Materials file Lecture 1.pdf: Materials are referenced by path, never committed",
      },
    ]);
  });

  it("blocks a Materials file the Module map hasn't taken in yet, and a text Material with other line endings", () => {
    const { repo } = courseProject();
    stage(repo, { "notes.txt": NOTES.replace(/\r\n/g, "\n"), "photo.bin": "a new board photo" });
    expect(
      checkCommit(repo)
        .findings.map((f) => f.message)
        .sort(),
    ).toEqual([
      "is the Materials file Board/new photo.jpg: Materials are referenced by path, never committed",
      "is the Materials file Lecture 2/notes.txt: Materials are referenced by path, never committed",
    ]);
  });

  it("never takes an empty file for an empty Material, though an empty file in an evidence path still blocks", () => {
    const { repo, materials } = courseProject();
    write(materials, { "Lecture 3/placeholder.txt": "" });
    stage(repo, { "content/modules/.gitkeep": "", "crops/empty.png": "" });
    expect(checkCommit(repo).findings).toEqual([
      { path: "crops/empty.png", message: expect.stringMatching(/^evidence-shaped path/) },
    ]);
  });

  it("blocks evidence-shaped paths: crops, transcriptions, the Materials reader's renders", () => {
    const { repo } = courseProject();
    stage(repo, {
      "crops/01/eq-3.png": "crop",
      "notes/transcripts/l1.txt": "said",
      "page-003.png": "render",
      "waves/01/reading-a.json": '{"reading": "a Blind reader\'s transcription"}',
    });
    expect(checkCommit(repo).findings.map((f) => f.path)).toEqual([
      "crops/01/eq-3.png",
      "notes/transcripts/l1.txt",
      "page-003.png",
      "waves/01/reading-a.json",
    ]);
  });

  it("still holds the committed ledger's Materials when the same commit empties the ledger (negative control)", () => {
    const { repo } = courseProject();
    stage(repo, {
      "build-ledger.json": JSON.stringify({ intake: { materialsPath: "/nowhere" }, materials: [] }),
      "content/modules/01-intro/figure.png": LECTURE,
      "notes.txt": NOTES.replace(/\r\n/g, "\n"),
    });
    expect(
      checkCommit(repo)
        .findings.map((f) => f.message)
        .sort(),
    ).toEqual([
      "is the Materials file Lecture 1.pdf: Materials are referenced by path, never committed",
      "is the Materials file Lecture 2/notes.txt: Materials are referenced by path, never committed",
    ]);
  });

  it("can't run without the Build ledger, and says so", () => {
    const { repo } = courseProject();
    git(repo, "rm", "-q", "--cached", "build-ledger.json");
    rmSync(join(repo, "build-ledger.json"));
    expect(() => checkCommit(repo)).toThrow(/no Build ledger/);
  });

  it("as the Course project's hook, refuses the commit and leaves HEAD where it was", () => {
    const { repo } = courseProject();
    // The template layer as a Course project carries it; the hook needs none of its packages.
    for (const file of ["pre-commit.ts", "pre-commit-cli.ts", "evidence.ts", "hooks/pre-commit"])
      cpSync(join(GATES, file), join(repo, "template", "gates", file));
    chmodSync(join(repo, "template", "gates", "hooks", "pre-commit"), 0o755);
    git(repo, "config", "core.hooksPath", "template/gates/hooks");
    git(repo, "add", "-A");
    expect(git(repo, "commit", "-q", "-m", "chore: the template layer").status).toBe(0);
    const head = git(repo, "rev-parse", "HEAD").stdout;

    stage(repo, { "content/modules/01-intro/lecture.pdf": LECTURE });
    const refused = git(repo, "commit", "-q", "-m", "feat: a planted Material");

    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toMatch(/content\/modules\/01-intro\/lecture\.pdf: is the Materials file Lecture 1\.pdf/);
    expect(git(repo, "rev-parse", "HEAD").stdout).toBe(head);
  });
});
