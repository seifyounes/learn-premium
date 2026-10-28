// A Sitting wave's merge gate and Checkpoint, on synthetic Fixture Course projects that are git repos
// (the wave a worktree and branch of its own, as a real one is): each problem `ready` can raise has a
// test that breaks exactly one thing. The template's gate verify and its content dump are faked.
import { spawnSync } from "node:child_process";
import { chmodSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { privateFolderOf } from "../scripts/intake/create.ts";
import { run as runWave, type WaveDeps } from "../scripts/wave/cli.ts";
import { treeProblems } from "../scripts/wave/tree.ts";
import type { DumpPaper, SittingDump, SittingDumper } from "../scripts/wave/sitting.ts";
import {
  EMPTY_INVENTORY,
  fixtureCourse,
  materialsOf,
  ownerSaysComplete,
  registered,
  sitting,
} from "./fixture-courses.ts";
import { must } from "./fake-notebooklm.ts";
import { ledger, media, tempDir, writeFiles } from "./helpers.ts";
import { readingItems, sittingReading, waveDumps } from "./sitting-fixtures.ts";

// Git-heavy like parallel-waves.test.ts: a worktree, a few commits and a few `ready` runs per test.
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

interface Calls {
  verified: { point: string; module: string | undefined }[];
}

/** A verifier that finds every Gate report green, unless `red` names the point that isn't. */
function verifier(calls: Calls, red?: string): WaveDeps["verifier"] {
  return {
    verify(_project, point, module) {
      calls.verified.push({ point, module });
      return point === red ? { green: false, problems: ["a gate is red"] } : { green: true, problems: [] };
    },
    rulings: () => [],
    inventory: () => EMPTY_INVENTORY,
  };
}

interface Sitting {
  project: string;
  privateFolder: string;
  tree: string;
  waveId: string;
  calls: Calls;
  /** The wave runs in the project's own checkout (no worktree of its own). */
  single?: boolean;
  /** The dump the fake template prints: `head` for the wave's checkout, `main` for the main one. */
  dumps: { head: SittingDump; main: SittingDump };
}

/** The Materials file the Owner names as the 2025 past paper. */
const PAPER_FILE = "midterm-2025.pdf";

const REPORT = (point: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    report: "learn-premium gate report v1",
    commit: "0".repeat(40),
    point,
    sitting: "midterm",
    checkpointItems: [],
    ...extra,
  });

const ALL_JOBS = [
  "blind-reader-a",
  "blind-reader-b",
  "reconcile",
  "vault-writer",
  "mock-writer",
  "recompute",
  "sitting-gates",
  "deploy-gates",
];

interface Options {
  /** Modules the Owner names (default 01, live). */
  modules?: string[];
  planned?: string[];
  papers?: boolean;
  announced?: string | null;
  /** Jobs to record (default all). */
  jobs?: string[];
  /** Whether the Owner has already confirmed the announced format (default: yes). */
  confirm?: boolean;
  /** Changes the paper itself, before the readers read it (a paper with no Professor key). */
  paper?: (d: SittingDump) => SittingDump;
  /** Changes what the wave's content says after the readers read, so it no longer matches. */
  head?: (d: SittingDump) => SittingDump;
}

/**
 * Module 01 live, the Owner has said the midterm is complete (naming 2025 and an announced format),
 * and its Sitting wave has built it: course.yaml marks it complete, the papers' content, Gate reports on
 * a preview, both Blind readers' agreeing readings settled, every job recorded, all committed.
 */
function sittingWave(options: Options = {}): Sitting {
  const { modules = ["01"], planned = [], papers = true, announced = "A written paper of two questions." } = options;
  const project = fixtureCourse("Fixture Course", {
    sittings: [sitting("midterm", "2026-11-10")],
    live: ["01"],
    planned,
    materials: { "01": { "L01.pdf": "lecture one", "midterm-2025.pdf": "the 2025 midterm" } },
    template: { "gates/hooks/pre-commit": "#!/bin/sh\n" },
  });
  const privateFolder = privateFolderOf(materialsOf(project));
  privates.push(privateFolder);
  writeFiles(project, {
    "content/style-sheet.yaml": "writtenFrom: 01-m01\n",
    "content/modules/01-m01/module.yaml": "title: Module 01\n",
    "content/course.yaml": "name: Fixture Course\nsittings:\n  - { id: midterm, name: Midterm, modules: [01-m01] }\n",
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

  must(
    ownerSaysComplete(project, "midterm", {
      modules,
      papers: papers ? [{ slug: "2025", path: "midterm-2025.pdf" }] : [],
      announced: papers ? announced : null,
    }),
  );
  const { wave: waveId } = must(
    ledger(
      "wave",
      "start",
      "--project",
      project,
      "--holder",
      "session-a",
      "--kind",
      "sitting",
      "--target",
      "midterm",
      "--branch",
      "sitting/midterm",
    ),
  ) as { wave: string };
  gitIn(project, "add", "build-ledger.json", "build-records");
  gitIn(project, "commit", "-q", "-m", `chore: record wave ${waveId} started`);
  const tree = join(tempDir("waves"), "sitting-midterm");
  gitIn(project, "worktree", "add", "-q", "-b", "sitting/midterm", tree, "main");

  const dumps = waveDumps();
  if (!papers) {
    dumps.head.papers = [];
    dumps.head.mocks = [];
    dumps.head.format = null;
  } else if (announced === null) dumps.head.format = null;
  // The paper as the Professor printed it, which the readers read; `head` changes only what the content says.
  if (options.paper) dumps.head = options.paper(dumps.head);
  writeFiles(tree, {
    "content/course.yaml":
      "name: Fixture Course\nsittings:\n  - { id: midterm, name: Midterm, modules: [01-m01], complete: true }\n",
    ...(papers ? { "content/sittings/midterm/papers/2025.yaml": "title: Midterm 2025\n" } : {}),
    "content/build-records/gate-reports/sitting-midterm.json": REPORT("sitting", {
      url: "https://fixture-git-sitting-midterm.vercel.app",
    }),
    "content/build-records/gate-reports/deploy.json": REPORT("deploy"),
  });
  const calls: Calls = { verified: [] };
  const c: Sitting = { project, privateFolder, tree, waveId, calls, dumps };
  if (papers) {
    const items = readingItems(dumps.head.papers[0] as DumpPaper, "2025", PAPER_FILE);
    writeFiles(privateFolder, {
      "sittings/midterm/reading-a.json": JSON.stringify(sittingReading("a", items)),
      "sittings/midterm/reading-b.json": JSON.stringify(sittingReading("b", items)),
    });
    expect(runWave(["reconcile", "--project", project, "--sitting", "midterm"]).code).toBe(0);
  }
  for (const job of options.jobs ?? (papers ? ALL_JOBS : ["sitting-gates", "deploy-gates"]))
    must(
      ledger(
        "record",
        "job",
        "--project",
        project,
        "--holder",
        "session-a",
        "--wave",
        waveId,
        "--job",
        job,
        "--result",
        "passed",
      ),
    );
  gitIn(tree, "add", "-A");
  gitIn(tree, "commit", "-q", "-m", "feat: the midterm's Exam room");
  if (options.head) c.dumps = { head: options.head(dumps.head), main: dumps.main };
  // The format he named is confirmed already, so a wave built here has nothing open but what a test adds.
  if (options.confirm !== false)
    for (const item of checkpoint(c).open) if (/\/announced\//.test(item.key)) answer(c, item.key, item.question);
  return c;
}

const dumper =
  (c: Sitting): SittingDumper =>
  (dir, _id, courseRef) =>
    // A revision's Course config is the base's; the project's own checkout is the base only while the wave has its own worktree.
    courseRef !== undefined || (resolve(dir) === resolve(c.project) && c.single !== true) ? c.dumps.main : c.dumps.head;

function ready(c: Sitting, red?: string): string[] {
  const { stdout } = runWave(["ready", "--project", c.project, "--wave", c.waveId], {
    verifier: verifier(c.calls, red),
    dump: dumper(c),
  });
  return (JSON.parse(stdout) as { problems: string[] }).problems;
}

const checkpoint = (c: Sitting) =>
  JSON.parse(runWave(["checkpoint", "--project", c.project, "--sitting", "midterm"], { dump: dumper(c) }).stdout) as {
    open: { key: string; question: string; sheet: boolean }[];
    unapplied: { key: string }[];
    markdown: string;
  };

const firstOf = <T>(list: T[]): T => {
  const [first] = list;
  if (first === undefined) throw new Error("nothing open");
  return first;
};
const firstOpen = (c: Sitting) => firstOf(checkpoint(c).open);

const answer = (c: Sitting, key: string, question: string, ruling?: string) =>
  must(
    ledger(
      ...["record", "checkpoint", "--project", c.project, "--holder", "session-a", "--wave", c.waveId],
      ...[
        "--key",
        key,
        "--question",
        question,
        "--answer",
        "yes",
        ...(ruling === undefined ? [] : ["--ruling", ruling]),
      ],
    ),
  );

/** Replaces the wave's committed Gate report for a point and commits. */
function reportWith(c: Sitting, point: "sitting" | "deploy", extra: Record<string, unknown>) {
  const file = point === "deploy" ? "deploy.json" : "sitting-midterm.json";
  const url = point === "sitting" ? { url: "https://fixture-git-sitting-midterm.vercel.app" } : {};
  writeFiles(c.tree, { [`content/build-records/gate-reports/${file}`]: REPORT(point, { ...url, ...extra }) });
  gitIn(c.tree, "add", "-A");
  gitIn(c.tree, "commit", "-q", "-m", "chore: gate report");
}

describe("a Sitting wave that is ready", () => {
  test("has no problem, and `ready` verifies the sitting point and the deploy point", () => {
    const c = sittingWave();
    expect(ready(c)).toEqual([]);
    expect(c.calls.verified).toEqual([
      { point: "sitting", module: "midterm" },
      { point: "deploy", module: undefined },
    ]);
  });

  test("a sitting with no past papers needs only its gates, and its Revision builds with nothing else named", () => {
    const c = sittingWave({ papers: false });
    expect(ready(c)).toEqual([]);
  });
});

describe("what the Owner named", () => {
  test("every Module he named is live", () => {
    const c = sittingWave({ modules: ["01", "02"], planned: ["02"] });
    // The content names Module 02's folder too, so only liveness is wrong.
    c.dumps.head.sitting = { ...c.dumps.head.sitting, modules: ["01-m01", "02-m02"] };
    c.dumps.head.course = { ...c.dumps.head.course, sittings: [c.dumps.head.sitting] };
    c.dumps.main.course = {
      ...c.dumps.main.course,
      sittings: [{ id: "midterm", name: "Midterm", date: "2026-11-10", modules: ["01-m01", "02-m02"] }],
    };
    expect(ready(c)).toEqual([expect.stringMatching(/Module 02 is planned, not live/)]);
  });

  test("course.yaml marks the sitting complete, and covers the Modules he named", () => {
    const incomplete = sittingWave({
      head: (d) => ({ ...d, sitting: { ...d.sitting, complete: false } }),
    });
    expect(ready(incomplete)).toEqual([expect.stringMatching(/doesn't mark sitting midterm complete/)]);
    const other = sittingWave({
      head: (d) => ({ ...d, sitting: { ...d.sitting, modules: ["01-m01", "02-m02"] } }),
    });
    expect(ready(other)).toEqual([
      expect.stringMatching(/covers 01-m01, 02-m02 in content\/course\.yaml; the Owner named 01-m01/),
    ]);
  });

  test("the wave changes nothing in course.yaml but its own sitting's entry", () => {
    const c = sittingWave({
      head: (d) => ({ ...d, course: { ...d.course, name: "Renamed", sittings: d.course["sittings"] } }),
    });
    expect(ready(c)).toEqual([expect.stringMatching(/changes content\/course\.yaml beyond sitting midterm's entry/)]);
  });

  test("the past papers are exactly the ones he named: none made up, none missing", () => {
    const extra = sittingWave({
      head: (d) => ({ ...d, papers: [...d.papers, { ...(d.papers[0] as DumpPaper), name: "2024" }] }),
    });
    expect(ready(extra)).toEqual([
      expect.stringMatching(/past papers the Owner didn't name \("2024"\)/),
      expect.stringMatching(/past paper "2024" that no Blind reader read/),
    ]);
    const missing = sittingWave({ head: (d) => ({ ...d, papers: [] }) });
    expect(ready(missing).join("\n")).toMatch(/the Owner named past papers the content lacks \("2025"\)/);
  });

  test("no past papers means no mocks and no format; an announced format needs its format.yaml and the reverse", () => {
    const mocks = sittingWave({ papers: false, head: (d) => ({ ...d, mocks: [{ name: "mock-1", pattern: "dna" }] }) });
    expect(ready(mocks)).toEqual([
      expect.stringMatching(/no past papers \(Revision only\), but the content has mocks/),
    ]);
    const noFormat = sittingWave({ head: (d) => ({ ...d, format: null }) });
    expect(ready(noFormat)).toEqual([expect.stringMatching(/the content has no format\.yaml/)]);
    const surprise = sittingWave({ announced: null, head: (d) => ({ ...d, format: { minutes: 20, slots: [] } }) });
    expect(ready(surprise)).toEqual([expect.stringMatching(/format\.yaml, but the Owner named no announced format/)]);
  });

  test("a past paper's Materials file must be unchanged since he named it", () => {
    const c = sittingWave();
    writeFileSync(join(materialsOf(c.project), "midterm-2025.pdf"), "the 2025 midterm, edited");
    expect(ready(c)).toEqual([expect.stringMatching(/midterm-2025\.pdf changed since the Owner named it/)]);
  });

  test("a ledger row refreshed to the changed file by another wave doesn't stand in for the hash he named", () => {
    const c = sittingWave();
    writeFileSync(join(materialsOf(c.project), "midterm-2025.pdf"), "the 2025 midterm, edited");
    // A later Module wave takes the changed file in: the ledger's current row now holds the new hash.
    must(
      ledger(
        "wave",
        "start",
        "--project",
        c.project,
        "--holder",
        "session-a",
        "--kind",
        "module",
        "--target",
        "01",
        "--branch",
        "module/01-again",
      ),
    );
    expect(ready(c).join("\n")).toMatch(/midterm-2025\.pdf changed since the Owner named it/);
  });

  test("in the project's own checkout, course.yaml is judged against the base the branch left, not against itself", () => {
    const c = sittingWave({ head: (d) => ({ ...d, course: { ...d.course, name: "Renamed" } }) });
    gitIn(c.project, "worktree", "remove", "--force", c.tree);
    gitIn(c.project, "checkout", "-q", "sitting/midterm");
    c.single = true;
    // The ledger and build records live in the project's own checkout here: committed on the branch.
    gitIn(c.project, "add", "-A");
    gitIn(c.project, "commit", "-q", "-m", "chore: the ledger on the branch");
    expect(ready(c)).toEqual([expect.stringMatching(/changes content\/course\.yaml beyond sitting midterm's entry/)]);
  });
});

describe("the past papers' settled reading", () => {
  test("every reading item came from the file the Owner named for its paper", () => {
    const c = sittingWave();
    const items = readingItems(c.dumps.head.papers[0] as DumpPaper, "2025", "somewhere-else.pdf");
    writeFiles(c.privateFolder, {
      "sittings/midterm/reading-a.json": JSON.stringify(sittingReading("a", items)),
      "sittings/midterm/reading-b.json": JSON.stringify(sittingReading("b", items)),
    });
    expect(runWave(["reconcile", "--project", c.project, "--sitting", "midterm"]).code).toBe(0);
    expect(ready(c)).toEqual([
      expect.stringMatching(
        /past paper "2025" was read from somewhere-else\.pdf, not the file the Owner named for it \(midterm-2025\.pdf\)/,
      ),
    ]);
  });

  test("both readers read, and reconcile settles", () => {
    const c = sittingWave();
    rmSync(join(c.privateFolder, "sittings/midterm/reading-b.json"));
    const problems = ready(c).join("\n");
    expect(problems).toMatch(/no reading-b\.json in the Private folder/);
    expect(problems).toMatch(/the settled reading is stale or incomplete/);
  });

  test("a settled reading older than its readings is refused, not trusted", () => {
    const c = sittingWave();
    const items = readingItems(c.dumps.head.papers[0] as DumpPaper, "2025", PAPER_FILE);
    writeFiles(c.privateFolder, {
      "sittings/midterm/reading-a.json": JSON.stringify(sittingReading("a", items.slice(1))),
    });
    expect(ready(c)).toEqual([expect.stringMatching(/the settled reading is stale or incomplete/)]);
  });

  test("the content must be faithful to it: text, order, marks and the Professor's key", () => {
    const edited = sittingWave({
      head: (d) => ({
        ...d,
        papers: d.papers.map((p) => ({
          ...p,
          questions: p.questions.map((q) => (q.n === 2 ? { ...q, marks: 5, key: "0.2" } : q)),
        })),
      }),
    });
    expect(ready(edited)).toEqual([
      expect.stringMatching(/question 2: the content gives 5 marks, the paper 4/),
      expect.stringMatching(/question 2: the content's key 0\.2 isn't the Professor's printed 0\.1/),
    ]);
  });
});

describe("the jobs", () => {
  test("every job of the wave ran: the readers, the writers, the recompute and the gates", () => {
    const c = sittingWave({ jobs: ALL_JOBS.filter((j) => j !== "mock-writer" && j !== "recompute") });
    expect(ready(c)).toEqual([
      expect.stringMatching(/job mock-writer hasn't been recorded/),
      expect.stringMatching(/job recompute hasn't been recorded/),
    ]);
  });

  test("a blocked job, or a blocked extra one, can't merge", () => {
    const c = sittingWave();
    must(
      ledger(
        "record",
        "job",
        "--project",
        c.project,
        "--holder",
        "session-a",
        "--wave",
        c.waveId,
        "--job",
        "vault-writer",
        "--result",
        "blocked",
      ),
    );
    must(
      ledger(
        "record",
        "job",
        "--project",
        c.project,
        "--holder",
        "session-a",
        "--wave",
        c.waveId,
        "--job",
        "sim-x",
        "--result",
        "blocked",
      ),
    );
    expect(ready(c)).toEqual([
      expect.stringMatching(/job vault-writer is blocked/),
      expect.stringMatching(/job sim-x is blocked/),
    ]);
  });

  test("a sitting with no past papers owes only its gates", () => {
    const c = sittingWave({ papers: false, jobs: ["sitting-gates"] });
    expect(ready(c)).toEqual([expect.stringMatching(/job deploy-gates hasn't been recorded/)]);
  });

  test("a key-less past paper is solved, recomputed independently, and the Owner confirms it", () => {
    const solvedHead = (d: SittingDump): SittingDump => ({
      ...d,
      papers: d.papers.map((p) => ({ ...p, key: "solved", questions: p.questions.map((q) => ({ ...q, key: null })) })),
    });
    // The solver job is owed.
    const noSolver = sittingWave({ paper: solvedHead });
    const items = readingItems(noSolver.dumps.head.papers[0] as DumpPaper, "2025", PAPER_FILE);
    expect(ready(noSolver).join("\n")).toMatch(/job solver hasn't been recorded/);
    expect(ready(noSolver).join("\n")).toMatch(/has no Professor key, so the solver must solve and recompute it/);
    // With the solver recorded, the Owner's confirmation of the build's own answers is the open item.
    must(
      ledger(
        "record",
        "job",
        "--project",
        noSolver.project,
        "--holder",
        "session-a",
        "--wave",
        noSolver.waveId,
        "--job",
        "solver",
        "--result",
        "passed",
      ),
    );
    reportWith(noSolver, "sitting", {
      checkpointItems: [
        {
          gate: "past-papers",
          outcome: "checkpoint",
          at: "sittings/midterm/papers/2025.yaml",
          message:
            "no Professor key; its answers are the build's solution, recomputed independently. Confirm them (answers 0123456789)",
          spot: "/exam/midterm/2025/",
        },
      ],
    });
    expect(items.length).toBeGreaterThan(0);
    const open = checkpoint(noSolver).open;
    expect(open).toHaveLength(1);
    // An ordinary item: his plain answer is all it takes, and there is no ruling to give.
    expect(open[0]?.sheet).toBe(false);
    expect(ready(noSolver)).toEqual([
      expect.stringMatching(/Checkpoint item midterm\/past-papers\/[0-9a-f]{10} is unanswered$/),
    ]);
    answer(noSolver, firstOf(open).key, firstOf(open).question);
    expect(ready(noSolver)).toEqual([]);
  });
});

describe("the gates", () => {
  test("the sitting point's Gate report must be green for HEAD, and the deploy point's too", () => {
    const c = sittingWave();
    expect(ready(c, "sitting")).toEqual([
      expect.stringMatching(/the sitting Gate report isn't green for HEAD: a gate is red/),
    ]);
    expect(ready(c, "deploy")).toEqual([expect.stringMatching(/the deploy Gate report isn't green for HEAD/)]);
  });

  test("the sitting's gates must have run on its Vercel preview", () => {
    const c = sittingWave();
    writeFiles(c.tree, {
      "content/build-records/gate-reports/sitting-midterm.json": REPORT("sitting", { url: "http://localhost:4321" }),
    });
    gitIn(c.tree, "add", "-A");
    gitIn(c.tree, "commit", "-q", "-m", "chore: gate report on a local server");
    expect(ready(c)).toEqual([expect.stringMatching(/the sitting's gates didn't run on its Vercel preview/)]);
  });
});

describe("the Checkpoint", () => {
  const key = "sittings/midterm/papers/2025.yaml";
  const keyItem = {
    gate: "past-papers",
    outcome: "checkpoint",
    at: key,
    message: "question 1's key prints 0.30, but the answer and the recompute give 0.25: rule it a Slip or a Divergence",
    spot: "/exam/midterm/2025/",
  };

  test("a key the answer and the recompute disagree with is asked, each with its link on the preview", () => {
    const c = sittingWave();
    reportWith(c, "sitting", { checkpointItems: [keyItem] });
    const { open, markdown } = checkpoint(c);
    expect(open).toEqual([
      expect.objectContaining({
        key: expect.stringMatching(/^midterm\/past-papers\/[0-9a-f]{10}$/),
        sheet: true,
        question: `${key}: ${keyItem.message}`,
      }),
    ]);
    expect(markdown).toMatch(/Checkpoint, sitting midterm/);
    expect(markdown).toContain("https://fixture-git-sitting-midterm.vercel.app/exam/midterm/2025/");
  });

  test("it needs a Slip or Divergence ruling, which the content must then carry", () => {
    const c = sittingWave();
    reportWith(c, "sitting", { checkpointItems: [keyItem] });
    const item = firstOpen(c);
    answer(c, item.key, item.question);
    expect(ready(c)).toEqual([expect.stringMatching(/needs a Slip or Divergence ruling/)]);
    answer(c, item.key, item.question, "divergence");
    // Ruled, and the gate still raises it: the content doesn't carry the ruling yet.
    expect(ready(c).join("\n")).toMatch(/was ruled a divergence, but the content doesn't carry the ruling yet/);
    // The ruling is applied: the gate no longer raises it, but the content ships it, and the ruling is his.
    reportWith(c, "sitting", { checkpointItems: [] });
    c.dumps.head = { ...c.dumps.head, rulings: [{ entry: key, kind: "divergence", printed: [0.3] }] };
    expect(ready(c)).toEqual([]);
  });

  test("a key the answer matches while the recompute differs is ruled on its printed value alone", () => {
    const c = sittingWave();
    const both = {
      ...keyItem,
      message:
        "question 1's key prints 0.30 and the answer matches it, but the independent recompute gives 0.25: rule it a Slip or a Divergence",
    };
    reportWith(c, "sitting", { checkpointItems: [both] });
    const item = firstOpen(c);
    answer(c, item.key, item.question, "divergence");
    // The ruling is applied: the gate no longer raises it, the content ships it, and his answer covers it.
    reportWith(c, "sitting", { checkpointItems: [] });
    c.dumps.head = { ...c.dumps.head, rulings: [{ entry: key, kind: "divergence", printed: [0.3] }] };
    expect(ready(c)).toEqual([]);
  });

  test("a Slip or Divergence the content ships without his answer on its item is refused", () => {
    const c = sittingWave();
    c.dumps.head = { ...c.dumps.head, rulings: [{ entry: key, kind: "slip", printed: [0.3] }] };
    expect(ready(c)).toEqual([
      expect.stringMatching(/sittings\/midterm\/papers\/2025\.yaml ships a slip on 0\.3 that no Owner answer rules/),
    ]);
  });

  test("the announced format he named is confirmed by him, and re-asked when the format changes", () => {
    const c = sittingWave({ confirm: false });
    const { open } = checkpoint(c);
    expect(open).toEqual([
      expect.objectContaining({
        key: expect.stringMatching(/^midterm\/announced\/[0-9a-f]{10}$/),
        question: expect.stringContaining("A written paper of two questions."),
      }),
    ]);
    expect(ready(c)).toEqual([expect.stringMatching(/Checkpoint item midterm\/announced\/[0-9a-f]{10} is unanswered/)]);
    const item = firstOf(open);
    answer(c, item.key, item.question);
    expect(ready(c)).toEqual([]);
    c.dumps.head = { ...c.dumps.head, format: { minutes: 25, slots: [{ type: "calculation", marks: 10 }] } };
    expect(checkpoint(c).open.map((i) => i.key)).not.toContain(item.key);
    expect(ready(c)).toEqual([expect.stringMatching(/Checkpoint item midterm\/announced\/[0-9a-f]{10} is unanswered/)]);
  });

  test("new words from the Owner about the format ask again, even for the same format.yaml", () => {
    const c = sittingWave();
    expect(ready(c)).toEqual([]);
    must(
      ownerSaysComplete(c.project, "midterm", {
        modules: ["01"],
        papers: [{ slug: "2025", path: "midterm-2025.pdf" }],
        announced: "Actually a written paper of three questions.",
      }),
    );
    expect(checkpoint(c).open.map((i) => i.question)).toEqual([
      expect.stringContaining("Actually a written paper of three questions."),
    ]);
    expect(ready(c)).toEqual([expect.stringMatching(/Checkpoint item midterm\/announced\/[0-9a-f]{10} is unanswered/)]);
  });

  test("a job that escalated waits for the Owner too", () => {
    const c = sittingWave();
    must(
      ledger(
        "record",
        "job",
        "--project",
        c.project,
        "--holder",
        "session-a",
        "--wave",
        c.waveId,
        "--job",
        "mock-writer",
        "--result",
        "checkpoint",
        "--detail",
        "which mock to drop?",
      ),
    );
    const { open } = checkpoint(c);
    expect(open.map((i) => i.question)).toContain("The mock-writer job needs the Owner: which mock to drop?");
  });

  test("an item answered in an earlier wave stays answered", () => {
    const c = sittingWave({ announced: null });
    reportWith(c, "sitting", { checkpointItems: [keyItem] });
    const item = firstOpen(c);
    answer(c, item.key, item.question, "slip");
    expect(checkpoint(c).open).toEqual([]);
  });
});

describe("the wave's own files", () => {
  test("a sitting's wave may mark its sitting complete in course.yaml, and change nothing of a Module's", () => {
    const c = sittingWave();
    writeFiles(c.tree, { "content/modules/01-m01/extra.md": "not this wave's\n" });
    gitIn(c.tree, "add", "-A");
    gitIn(c.tree, "commit", "-q", "-m", "feat: edit Module 01 from the sitting's wave");
    expect(ready(c)).toEqual([
      expect.stringMatching(/files that aren't sitting midterm's \(content\/modules\/01-m01\/extra\.md\)/),
    ]);
  });

  test("another sitting's content, recompute logs and Gate report are refused", () => {
    const c = sittingWave();
    writeFiles(c.tree, {
      "content/sittings/final/papers/x.yaml": "title: x\n",
      "content/build-records/recompute/sittings/final/x.json": "{}\n",
      "content/build-records/gate-reports/sitting-final.json": "{}\n",
    });
    gitIn(c.tree, "add", "-A");
    gitIn(c.tree, "commit", "-q", "-m", "feat: the final's files from the midterm's wave");
    const problems = ready(c).join("\n");
    expect(problems).toMatch(/content\/sittings\/final\/papers\/x\.yaml/);
    expect(problems).toMatch(/content\/build-records\/recompute\/sittings\/final\/x\.json/);
    expect(problems).toMatch(/content\/build-records\/gate-reports\/sitting-final\.json/);
  });

  test("a Module wave may change no sitting's files", () => {
    const c = sittingWave();
    // Module 02's wave, on its own branch of main, touching the midterm's content.
    const tree = join(tempDir("waves"), "module-02");
    gitIn(c.project, "worktree", "add", "-q", "-b", "module/02-m02", tree, "main");
    writeFiles(tree, { "content/sittings/midterm/papers/2025.yaml": "title: sneaked in\n" });
    gitIn(tree, "add", "-A");
    gitIn(tree, "commit", "-q", "-m", "feat: a Module wave editing a sitting");
    const wave = {
      id: "module-02-1",
      kind: "module" as const,
      target: "02",
      branch: "module/02-m02",
      release: "v2.0.0",
      state: "running" as const,
      startedAt: "2026-10-15T10:00:00.000Z",
      endedAt: null,
      commit: null,
      superseded: null,
    };
    expect(treeProblems(c.project, wave, { path: tree, linked: true })).toEqual([
      expect.stringMatching(/changes an Exam sitting's files \(content\/sittings\/midterm\/papers\/2025\.yaml\)/),
    ]);
  });

  test("the template layer must be the pinned release's, and the pre-commit gate the repo's hook", () => {
    const c = sittingWave();
    gitIn(c.project, "config", "core.hooksPath", ".git/hooks");
    const hook = ready(c).join("\n");
    gitIn(c.project, "config", "core.hooksPath", "template/gates/hooks");
    writeFiles(c.tree, { "template/gates/hooks/pre-commit": "#!/bin/sh\necho edited\n" });
    gitIn(c.tree, "add", "-A");
    gitIn(c.tree, "commit", "-q", "-m", "chore: edit the template");
    const integrity = ready(c).join("\n");
    expect(hook).toMatch(/the pre-commit gate isn't the repo's hook/);
    expect(integrity).toMatch(/the template layer isn't the pinned release's: modified gates\/hooks\/pre-commit/);
  });

  test("uncommitted changes, and a main checkout off main, are refused", () => {
    const c = sittingWave();
    writeFiles(c.tree, { "content/sittings/midterm/papers/2025.yaml": "title: edited, not committed\n" });
    expect(ready(c).join("\n")).toMatch(/uncommitted changes \(content\/sittings\/midterm\/papers\/2025\.yaml\)/);
    gitIn(c.tree, "checkout", "-q", "--", ".");
    gitIn(c.project, "checkout", "-q", "-b", "elsewhere");
    expect(ready(c).join("\n")).toMatch(/main checkout is on elsewhere, not main/);
  });
});

describe("after the merge", () => {
  test("the merged sitting's audio joins the Media queue", () => {
    const c = sittingWave({ papers: false });
    gitIn(c.project, "merge", "--ff-only", "-q", "sitting/midterm");
    must(
      ledger(
        "wave",
        "end",
        "--project",
        c.project,
        "--holder",
        "session-a",
        "--wave",
        c.waveId,
        "--result",
        "merged",
        "--commit",
        headOf(c.tree),
      ),
    );
    const state = tempDir("state");
    registered(state, c.project);

    const { queue } = must(media("gather", "--state", state)) as { queue: { item: string }[] };

    expect(queue.map((e) => e.item)).toContain("sitting-midterm-audio");
    const { sittings } = must(ledger("status", "--project", c.project)) as {
      sittings: { id: string; state: string }[];
    };
    expect(sittings.find((s) => s.id === "midterm")?.state).toBe("live");
  });
});
