// Parallel Module waves: after Module 1 each ready Module's wave runs in its own git worktree of one
// Course project, while the Build ledger stays in the main checkout. Synthetic Fixture Course projects
// only: no Materials, no Vercel, the template's gate verify faked.
import { spawnSync } from "node:child_process";
import { chmodSync, readFileSync, rmSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { privateFolderOf } from "../scripts/intake/create.ts";
import { run as runWave, type WaveDeps } from "../scripts/wave/cli.ts";
import { WAVE_JOBS } from "../scripts/wave/wave.ts";
import { fixtureCourse, materialsOf } from "./fixture-courses.ts";
import { must } from "./fake-notebooklm.ts";
import { jsonInput, ledger, tempDir, writeFiles } from "./helpers.ts";
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

/**
 * Starts Module NN's wave in the Build ledger and adds its worktree and branch (from main). A re-run wave
 * takes in changed Materials at its start, so the ledger is committed on main before its worktree is cut:
 * the worktree's copy then holds every Materials hash the deploy gates there must know.
 */
function startWave(c: Course, nn: string, branch = `module/${nn}-m${nn}`, commitLedger = false) {
  const { wave: waveId } = must(
    ledger("wave", "start", ...holder(c.project), "--kind", "module", "--target", nn, "--branch", branch),
  );
  if (commitLedger) {
    gitIn(c.project, "add", "build-ledger.json", "build-records");
    gitIn(c.project, "commit", "-q", "-m", `chore: record wave ${waveId} started`);
  }
  const tree = join(c.wavesDir, branch.replaceAll("/", "-"));
  gitIn(c.project, "worktree", "add", "-q", "-b", branch, tree, "main");
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
function toCheckpoint(
  c: Course,
  nn: string,
  w: { tree: string; waveId: string },
  items: unknown[] = [],
  revision = "",
) {
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
    [`content/modules/${nn}-m${nn}/module.yaml`]: `title: Module ${nn}${revision}\n`,
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

/**
 * Merges Module NN's wave as the skill does: main fast-forwards to its branch, the wave ends in the ledger
 * with that commit, the ledger's files are committed on main, and the wave's worktree goes.
 */
function mergeInto(c: Course, nn: string, w: { tree: string; waveId: string; branch: string }) {
  gitIn(c.project, "merge", "--ff-only", "-q", w.branch);
  must(
    ledger(
      ...["wave", "end", ...holder(c.project), "--wave", w.waveId, "--result", "merged"],
      ...["--commit", headOf(w.tree)],
    ),
  );
  gitIn(c.project, "add", "build-ledger.json", "build-records");
  gitIn(c.project, "commit", "-q", "-m", `chore: record wave ${w.waveId} merged`);
  gitIn(c.project, "worktree", "remove", w.tree);
}

/** Answers every open Checkpoint item of Module NN. */
function answerEvery(c: Course, nn: string, waveId: string) {
  for (const i of checkpointOf(c, nn).open)
    must(
      ledger(
        ...["record", "checkpoint", ...holder(c.project), "--wave", waveId, "--key", i.key],
        ...["--question", i.question, "--answer", "a"],
      ),
    );
}

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

describe("waves merge independently", () => {
  test("the first green wave merges; the other rebases onto the moved main and merges after, each Module live", () => {
    const c = parallelCourse();
    const w2 = startWave(c, "02");
    const w3 = startWave(c, "03");
    toCheckpoint(c, "02", w2);
    toCheckpoint(c, "03", w3, [
      { gate: "provenance", outcome: "checkpoint", at: "modules/03-m03/summary/1.md", message: "a figure's source" },
    ]);

    const head2 = headOf(w2.tree);
    mergeInto(c, "02", w2);
    answerEvery(c, "03", w3.waveId);
    const behind = readyOf(c, w3.waveId);
    gitIn(w3.tree, "rebase", "-q", "main");
    const rebased = readyOf(c, w3.waveId);
    const head3 = headOf(w3.tree);
    mergeInto(c, "03", w3);

    expect(behind).toEqual([expect.stringMatching(/^main has moved since module\/03-m03 left it/)]);
    expect(rebased).toEqual([]);
    const status = statusOf(c.project);
    expect(status.modules.map((m: { id: string; state: string }) => [m.id, m.state])).toEqual([
      ["01", "live"],
      ["02", "live"],
      ["03", "live"],
    ]);
    const commitOf = (id: string) => status.waves.find((row: { id: string }) => row.id === id).commit;
    expect(commitOf(w2.waveId)).toBe(head2);
    expect(commitOf(w3.waveId)).toBe(head3);
    expect(gitIn(c.project, "log", "--format=%s", "main")).toMatch(/feat: Module 03[\s\S]*feat: Module 02/);
  });

  test("a wave's branch that changes another Module's files is refused", () => {
    const c = parallelCourse();
    const w3 = startWave(c, "03");
    toCheckpoint(c, "03", w3);
    writeFiles(w3.tree, { "content/modules/02-m02/extra.md": "not this wave's Module\n" });
    gitIn(w3.tree, "add", "-A");
    gitIn(w3.tree, "commit", "-q", "-m", "feat: edit Module 02 from Module 03's wave");

    const problems = readyOf(c, w3.waveId).join("\n");

    expect(problems).toMatch(/changes another Module's files \(content\/modules\/02-m02\/extra\.md\)/);
  });
});

describe("the ledger lock across parallel waves", () => {
  test("while one session runs waves, every write by another session is refused and the ledger is unchanged", () => {
    const c = parallelCourse();
    const w2 = startWave(c, "02");
    startWave(c, "03");
    toCheckpoint(c, "02", w2);
    const bytes = () => readFileSync(join(c.project, "build-ledger.json"), "utf8");
    const before = bytes();
    const other = ["--project", c.project, "--holder", "session-b"];

    const refused = [
      ledger("lock", "claim", ...other),
      ledger("record", "job", ...other, "--wave", w2.waveId, "--job", "writer", "--result", "passed"),
      ledger("wave", "end", ...other, "--wave", w2.waveId, "--result", "failed"),
      ledger("map", ...other, "--input", jsonInput({ modules: [], unmapped: [] })),
      ledger("supersede", ...other, "--row", "module", "--id", "03", "--reason", "not mine"),
    ].map((r) => r.code);
    const relaunch = wave(
      ["relaunch", "open", ...other, "--wave", w2.waveId, "--job", "writer", "--files", "content/modules/02-m02"],
      { jobGates: { run: () => ({ ran: true, findings: [] }) } },
    );

    expect(refused).toEqual([3, 3, 3, 3, 3]);
    expect(relaunch.code).toBe(3);
    expect(bytes()).toBe(before);
  });
});

/** Module 02 built and merged, then its lecture revised on disk: the Course is ready for 02's fresh wave. */
function revisedCourse() {
  const c = parallelCourse();
  const first = startWave(c, "02");
  toCheckpoint(c, "02", first);
  mergeInto(c, "02", first);
  const snapshot = readFileSync(join(c.project, "build-ledger.json"), "utf8");
  writeFiles(materialsOf(c.project), { "L02.pdf": "revised" });
  return { c, snapshot };
}

describe("incremental builds: a changed file re-runs its wave", () => {
  test("a changed file flags its Module; a fresh wave rebuilds it from fresh readings and merges; the old rows stay marked superseded", () => {
    const { c, snapshot } = revisedCourse();

    const next = must(ledger("next", "--project", c.project));
    const again = startWave(c, "02", "module/02-m02-2", true);
    toCheckpoint(c, "02", again, [], " revised");
    const problems = readyOf(c, again.waveId);
    mergeInto(c, "02", again);

    expect(next.waves).toEqual([
      { kind: "module", target: "02", reasons: ["materials-changed"] },
      { kind: "module", target: "03", reasons: ["planned"] },
    ]);
    expect(problems).toEqual([]);
    const status = statusOf(c.project);
    expect(status.superseded).toContainEqual(
      expect.objectContaining({ row: "material", id: "L02.pdf", reason: "changed on disk" }),
    );
    const raw = JSON.parse(readFileSync(join(c.project, "build-ledger.json"), "utf8"));
    const rows = raw.materials.filter((m: { path: string }) => m.path === "L02.pdf");
    expect(rows).toHaveLength(2);
    expect(rows.filter((m: { superseded: unknown }) => m.superseded === null)).toHaveLength(1);
    expect(
      raw.waves.filter((w: { target: string }) => w.target === "02").map((w: { state: string }) => w.state),
    ).toEqual(["merged", "merged"]);
    // Nothing is deleted: every row the earlier ledger held is still there, only its `superseded` may differ.
    const before = JSON.parse(snapshot);
    for (const m of before.materials)
      expect(raw.materials).toContainEqual(
        expect.objectContaining({ path: m.path, hash: m.hash, recordedAt: m.recordedAt }),
      );
    for (const j of before.jobs)
      expect(raw.jobs).toContainEqual(expect.objectContaining({ wave: j.wave, job: j.job, recordedAt: j.recordedAt }));
    const page = readFileSync(join(c.project, "build-records/status.md"), "utf8");
    expect(page).toContain("## Superseded");
    expect(page).toContain("| material | L02.pdf |");
  });

  test("readings and a review older than the Module's Materials keep the fresh wave from merging", () => {
    const { c } = revisedCourse();
    const again = startWave(c, "02", "module/02-m02-2", true);
    toCheckpoint(c, "02", again, [], " revised");
    const hourAgo = new Date(Date.now() - 3_600_000);
    const files = ["reading-a.json", "reading-b.json", "review/review.json"].map((f) =>
      join(c.privateFolder, "waves/02", f),
    );
    for (const file of files) utimesSync(file, hourAgo, hourAgo);

    const stale = readyOf(c, again.waveId).join("\n");
    for (const file of files) utimesSync(file, new Date(), new Date());
    const fresh = readyOf(c, again.waveId);

    expect(stale).toMatch(/reading-a\.json in the Private folder is older than Module 02's Materials/);
    expect(stale).toMatch(/reading-b\.json in the Private folder is older than Module 02's Materials/);
    expect(stale).toMatch(/review\/review\.json in the Private folder is older than Module 02's Materials/);
    expect(fresh).toEqual([]);
  });

  test("a rebuild forced only by deleted Materials can't merge on the readings and review of the wave before", () => {
    const c = parallelCourse();
    const first = startWave(c, "02");
    toCheckpoint(c, "02", first);
    mergeInto(c, "02", first);
    const hourAgo = new Date(Date.now() - 3_600_000);
    for (const file of ["reading-a.json", "reading-b.json", "review/review.json"])
      utimesSync(join(c.privateFolder, "waves/02", file), hourAgo, hourAgo);
    rmSync(join(materialsOf(c.project), "L02.pdf"));

    const again = startWave(c, "02", "module/02-m02-2", true);
    const problems = readyOf(c, again.waveId).join("\n");

    expect(problems).toMatch(/reading-a\.json in the Private folder is older than Module 02's Materials/);
    expect(problems).toMatch(/review\/review\.json in the Private folder is older than Module 02's Materials/);
  });
});

describe("what a wave's worktree must hold", () => {
  test("the deploy gates there read the Materials inventory from the worktree's ledger: one that predates a Material is refused until main carries the live one", () => {
    const c = parallelCourse();
    const w2 = startWave(c, "02");
    toCheckpoint(c, "02", w2);
    writeFiles(materialsOf(c.project), { "L03b.pdf": "a new board photo scan" });
    const added = { id: "03", slug: "m03", title: "Module 03", materials: ["L03b.pdf"] };
    must(ledger("map", ...holder(c.project), "--input", jsonInput({ modules: [added], unmapped: [] })));

    const stale = readyOf(c, w2.waveId).join("\n");
    gitIn(c.project, "add", "build-ledger.json", "build-records");
    gitIn(c.project, "commit", "-q", "-m", "chore: record the new Material");
    gitIn(w2.tree, "rebase", "-q", "main");
    const fresh = readyOf(c, w2.waveId);

    expect(stale).toMatch(/holds a Build ledger that predates Materials the live ledger has \(L03b\.pdf\)/);
    expect(fresh).toEqual([]);
  });

  test("a file name outside ASCII is read as it is: another Module's Arabic-named file is still refused", () => {
    const c = parallelCourse();
    const w3 = startWave(c, "03");
    toCheckpoint(c, "03", w3);
    writeFiles(w3.tree, { "content/modules/02-m02/ملخص.md": "not this wave's Module\n" });
    gitIn(w3.tree, "add", "-A");
    gitIn(w3.tree, "commit", "-q", "-m", "feat: edit Module 02 from Module 03's wave");

    const problems = readyOf(c, w3.waveId).join("\n");

    expect(problems).toMatch(/changes another Module's files \(content\/modules\/02-m02\/ملخص\.md\)/);
  });
});
