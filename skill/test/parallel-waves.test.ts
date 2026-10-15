// Parallel Module waves: after Module 1 each ready Module's wave runs in its own git worktree of one
// Course project, while the Build ledger stays in the main checkout. Synthetic Fixture Course projects
// only: no Materials, no Vercel, the template's gate verify faked.
import { spawnSync } from "node:child_process";
import { chmodSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { privateFolderOf } from "../scripts/intake/create.ts";
import { run as runWave, type WaveDeps } from "../scripts/wave/cli.ts";
import { WAVE_JOBS } from "../scripts/wave/wave.ts";
import { fixtureCourse, materialsOf } from "./fixture-courses.ts";
import { must } from "./fake-notebooklm.ts";
import { ledger, tempDir, writeFiles } from "./helpers.ts";
import { review, shots } from "./review-fixtures.ts";

// Git-heavy like wave.test.ts: every wave is a worktree, several commits and a few `ready` runs.
vi.setConfig({ testTimeout: 60_000 });

const privates: string[] = [];
afterEach(() => {
  for (const dir of privates.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function gitIn(repo: string, ...args: string[]) {
  const child = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  if (child.status !== 0) throw new Error(`git ${args.join(" ")}: ${child.stderr}`);
  return child.stdout;
}

const headOf = (repo: string) => gitIn(repo, "rev-parse", "HEAD").trim();

const greenVerifier: Partial<WaveDeps> = {
  verifier: { verify: () => ({ green: true, problems: [] }), rulings: () => [] },
};

function wave(args: string[], deps: Partial<WaveDeps> = {}) {
  const { code, stdout } = runWave(args, deps);
  return { code, out: JSON.parse(stdout) };
}

interface Course {
  project: string;
  privateFolder: string;
  wavesDir: string;
}

/**
 * Module 01 live, 02 and 03 planned, the Course project a git repo on `main` (the ledger and its pages
 * committed there, as a real Course project has them), the pre-commit gate as its hook. CRLF off and the
 * hook's exec bit set before the first commit, so every worktree checks out the same bytes on every runner.
 */
function parallelCourse(): Course {
  const project = fixtureCourse("Fixture Course", {
    live: ["01"],
    planned: ["02", "03"],
    template: { "gates/hooks/pre-commit": "#!/bin/sh\n" },
  });
  const privateFolder = privateFolderOf(materialsOf(project));
  privates.push(privateFolder);
  writeFiles(project, {
    "content/style-sheet.yaml": "writtenFrom: 01-m01\n",
    "content/modules/01-m01/module.yaml": "title: Module 01\n",
  });
  gitIn(project, "init", "-q", "-b", "main");
  gitIn(project, "config", "user.name", "Fixture");
  gitIn(project, "config", "user.email", "fixture@example.test");
  gitIn(project, "config", "commit.gpgsign", "false");
  gitIn(project, "config", "core.autocrlf", "false");
  gitIn(project, "config", "core.hooksPath", "template/gates/hooks");
  chmodSync(join(project, "template/gates/hooks/pre-commit"), 0o755);
  gitIn(project, "add", "-A");
  gitIn(project, "commit", "-q", "-m", "feat: Module 01");
  return { project, privateFolder, wavesDir: tempDir("waves") };
}

const holder = (project: string) => ["--project", project, "--holder", "session-a"];

/** Adds Module NN's worktree and branch (from main) and starts its wave in the Build ledger. */
function startWave(c: Course, nn: string, branch = `module/${nn}-m${nn}`) {
  const tree = join(c.wavesDir, branch.replaceAll("/", "-"));
  gitIn(c.project, "worktree", "add", "-q", "-b", branch, tree, "main");
  const { wave: waveId } = must(
    ledger("wave", "start", ...holder(c.project), "--kind", "module", "--target", nn, "--branch", branch),
  );
  return { tree, waveId: waveId as string, branch };
}

const reading = (reader: "a" | "b", module: string) => ({
  reading: "learn-premium blind reading v1",
  reader,
  module,
  items: [
    {
      key: "eq-1",
      file: `L${module}.pdf`,
      page: 3,
      box: [0.1, 0.4, 0.5, 0.5],
      quantity: null,
      kind: "number",
      value: "0.25",
    },
  ],
});

/** Two agreeing readings of Module NN's lecture, settled. They sit in the Private folder, outside every checkout. */
function readAndReconcile(c: Course, nn: string) {
  writeFiles(c.privateFolder, {
    [`waves/${nn}/reading-a.json`]: JSON.stringify(reading("a", nn)),
    [`waves/${nn}/reading-b.json`]: JSON.stringify(reading("b", nn)),
  });
  must(wave(["reconcile", "--project", c.project, "--module", nn]));
}

/**
 * Module NN's wave run to its Checkpoint in `tree`: readings settled, the Module's content and Gate reports
 * committed on its branch, every job recorded, the reviewer's screenshots and review of that commit.
 * `items` are the Checkpoint items its gates raise.
 */
function toCheckpoint(c: Course, nn: string, w: { tree: string; waveId: string }, items: unknown[] = []) {
  readAndReconcile(c, nn);
  const report = (point: string, extra: Record<string, unknown>) =>
    JSON.stringify({
      report: "learn-premium gate report v1",
      commit: "0".repeat(40),
      point,
      checkpointItems: items,
      ...extra,
    });
  writeFiles(w.tree, {
    [`content/modules/${nn}-m${nn}/module.yaml`]: `title: Module ${nn}\n`,
    [`content/build-records/gate-reports/job-${nn}-m${nn}.json`]: report("job", { module: `${nn}-m${nn}` }),
    [`content/build-records/gate-reports/module-${nn}-m${nn}.json`]: report("module", {
      module: `${nn}-m${nn}`,
      url: `https://fixture-course-git-module-${nn}.vercel.app`,
    }),
  });
  for (const job of WAVE_JOBS)
    must(ledger("record", "job", ...holder(c.project), "--wave", w.waveId, "--job", job, "--result", "passed"));
  gitIn(w.tree, "add", "-A");
  gitIn(w.tree, "commit", "-q", "-m", `feat: Module ${nn}`);
  const head = headOf(w.tree);
  shots(c.privateFolder, head, nn, { module: `${nn}-m${nn}` });
  review(c.privateFolder, [], head, nn);
}

/** Runs `ready` on the wave as the main agent does: the consistency pass recorded again, nothing committed. */
function readyOf(c: Course, waveId: string): string[] {
  must(ledger("record", "job", ...holder(c.project), "--wave", waveId, "--job", "consistency", "--result", "passed"));
  return wave(["ready", "--project", c.project, "--wave", waveId], greenVerifier).out.problems as string[];
}

const statusOf = (project: string) => must(ledger("status", "--project", project));
const checkpointOf = (c: Course, nn: string) =>
  must(wave(["checkpoint", "--project", c.project, "--module", nn])) as { open: { key: string; question: string }[] };

describe("each Module's wave in its own worktree", () => {
  test("two Module waves of one session run at once; the one waiting at its Checkpoint doesn't hold up the other", () => {
    const c = parallelCourse();
    const w2 = startWave(c, "02");
    const w3 = startWave(c, "03");
    toCheckpoint(c, "02", w2);
    toCheckpoint(c, "03", w3, [
      { gate: "provenance", outcome: "checkpoint", at: "modules/03-m03/summary/1.md", message: "a figure's source" },
    ]);

    const waves = statusOf(c.project).waves.filter((w: { state: string }) => w.state === "running");
    const dirty = gitIn(c.project, "status", "--porcelain");

    expect(waves).toHaveLength(2);
    expect(dirty).not.toBe("");
    expect(readyOf(c, w2.waveId)).toEqual([]);
    expect(readyOf(c, w3.waveId)).toEqual([
      expect.stringMatching(/^Checkpoint item 03\/provenance\/[0-9a-f]{10} is unanswered$/),
    ]);
    expect(checkpointOf(c, "03").open).toHaveLength(1);
    expect(checkpointOf(c, "02").open).toHaveLength(0);
  });

  test("ready reads the wave's own checkout: a wave whose branch is checked out nowhere is refused", () => {
    const c = parallelCourse();
    const w2 = startWave(c, "02");
    toCheckpoint(c, "02", w2);
    gitIn(c.project, "worktree", "remove", "--force", w2.tree);

    const problems = readyOf(c, w2.waveId).join("\n");

    expect(problems).toMatch(/checked out on main, not the wave's branch module\/02-m02/);
  });

  test("the Build ledger is read and written only in the main checkout, never from a wave's worktree", () => {
    const c = parallelCourse();
    const w2 = startWave(c, "02");
    const before = readFileSync(join(w2.tree, "build-ledger.json"), "utf8");

    const status = ledger("status", "--project", w2.tree);
    const record = ledger(
      ...["record", "job", ...holder(w2.tree)],
      ...["--wave", w2.waveId, "--job", "writer", "--result", "passed"],
    );

    expect(status.code).toBe(2);
    expect(status.out.error).toMatch(/worktree/);
    expect(record.code).toBe(2);
    expect(record.out.error).toMatch(/worktree/);
    expect(readFileSync(join(w2.tree, "build-ledger.json"), "utf8")).toBe(before);
  });

  test("a wave's branch that changes the Build ledger's files is refused, and so is a main checkout off main", () => {
    const c = parallelCourse();
    const w2 = startWave(c, "02");
    toCheckpoint(c, "02", w2);
    writeFiles(w2.tree, { "build-records/status.md": "edited on the branch\n" });
    gitIn(w2.tree, "add", "-A");
    gitIn(w2.tree, "commit", "-q", "-m", "chore: edit the status page");

    const onBranch = readyOf(c, w2.waveId).join("\n");
    gitIn(w2.tree, "reset", "-q", "--hard", "HEAD~1");
    gitIn(c.project, "checkout", "-q", "-b", "elsewhere");
    const off = readyOf(c, w2.waveId).join("\n");

    expect(onBranch).toMatch(/changes the Build ledger's files \(build-records\/status\.md\)/);
    expect(off).toMatch(/main checkout is on elsewhere, not main/);
  });
});
