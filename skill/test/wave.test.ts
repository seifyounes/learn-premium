// The Module wave's commands (`wave.ts`) through their command interface, on synthetic Course
// projects and Private folders: no Materials, no Vercel, the template's gate verify faked.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { privateFolderOf } from "../scripts/intake/create.ts";
import { run as runWave, type WaveDeps } from "../scripts/wave/cli.ts";
import { templateVerifier } from "../scripts/wave/wave.ts";
import { COMMIT, fixtureCourse, materialsOf } from "./fixture-courses.ts";
import { must } from "./fake-notebooklm.ts";
import { ledger, writeFiles, type Result } from "./helpers.ts";
import { MEANING_SLIP, review, shots, verdicts } from "./review-fixtures.ts";

// Every wave here runs git several times (a commit per ready): the 30 s the other git-heavy suites have.
vi.setConfig({ testTimeout: 30_000 });

const privates: string[] = [];
afterEach(() => {
  for (const dir of privates.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Runs one wave command exactly as the CLI would, with `deps` standing in for the template's gate verify. */
function wave(args: string[], deps: Partial<WaveDeps> = {}): Result {
  const { code, stdout } = runWave(args, deps);
  return { code, out: JSON.parse(stdout) };
}

/** A new Course with Modules 01 and 02 mapped, and its Private folder beside the Materials. */
function newCourse() {
  const project = fixtureCourse("Machine Learning", {
    planned: ["01", "02"],
    template: { "gates/hooks/pre-commit": "#!/bin/sh\n" },
  });
  const privateFolder = privateFolderOf(materialsOf(project));
  privates.push(privateFolder);
  return { project, privateFolder };
}

interface Item {
  key: string;
  file: string;
  page: number | null;
  box: [number, number, number, number] | null;
  quantity: string | null;
  kind: "number" | "formula" | "text" | "annotation" | "figure";
  value: string | null;
}

const item = (key: string, value: string | null, extra: Partial<Item> = {}): Item => ({
  key,
  file: "L01.pdf",
  page: 3,
  box: [0.1, 0.4, 0.5, 0.5],
  quantity: null,
  kind: "number",
  value,
  ...extra,
});

function reading(reader: "a" | "b", items: Item[], module = "01") {
  return { reading: "learn-premium blind reading v1", reader, module, items };
}

/** Writes both Blind readers' readings where the wave reads them: the Private folder. */
function readings(privateFolder: string, a: Item[], b: Item[], module = "01") {
  writeFiles(privateFolder, {
    [`waves/${module}/reading-a.json`]: JSON.stringify(reading("a", a, module)),
    [`waves/${module}/reading-b.json`]: JSON.stringify(reading("b", b, module)),
  });
}

function resolutions(privateFolder: string, list: unknown[], module = "01") {
  writeFiles(privateFolder, { [`waves/${module}/resolutions.json`]: JSON.stringify({ resolutions: list }) });
}

const reconcile = (project: string, module = "01") => wave(["reconcile", "--project", project, "--module", module]);

describe("reconcile", () => {
  test("two readings that agree settle at once, and the settled reading is kept in the Private folder", () => {
    const { project, privateFolder } = newCourse();
    readings(
      privateFolder,
      [item("eq-1", "0.25"), item("eq-2", "w := w - \\alpha \\nabla J", { kind: "formula" })],
      [item("eq-1", "0.250"), item("eq-2", "w :=  w - \\alpha \\nabla J", { kind: "formula" })],
    );

    const { code, out } = reconcile(project);

    expect(code).toBe(0);
    expect(out).toMatchObject({ ok: true, agreed: 2, disputes: 0, checkpointItems: [] });
    const settled = JSON.parse(readFileSync(join(privateFolder, "waves/01/reading.json"), "utf8"));
    expect(settled.items.map((i: Item) => [i.key, i.value])).toEqual([
      ["eq-1", "0.25"],
      ["eq-2", "w := w - \\alpha \\nabla J"],
    ]);
  });

  test("a disagreement is a dispute to settle on the rendered region, listed with where to crop it", () => {
    const { project, privateFolder } = newCourse();
    readings(privateFolder, [item("eq-1", "0.25"), item("eq-3", "4")], [item("eq-1", "0.52")]);

    const { code, out } = reconcile(project);

    expect(code).toBe(1);
    expect(out.disputes).toEqual([
      { key: "eq-1", file: "L01.pdf", page: 3, box: [0.1, 0.4, 0.5, 0.5], a: "0.25", b: "0.52" },
      { key: "eq-3", file: "L01.pdf", page: 3, box: [0.1, 0.4, 0.5, 0.5], a: "4", b: null },
    ]);
    expect(existsSync(join(privateFolder, "waves/01/reading.json"))).toBe(false);
  });

  test("every dispute settled on its crop gives the settled reading; an unreadable one becomes a Checkpoint item with its crop", () => {
    const { project, privateFolder } = newCourse();
    readings(
      privateFolder,
      [item("eq-1", "0.25"), item("note-1", "check sign", { kind: "annotation" })],
      [item("eq-1", "0.52"), item("note-1", "check size", { kind: "annotation" })],
    );
    writeFiles(privateFolder, { "waves/01/crops/eq-1.png": "png", "waves/01/crops/note-1.png": "png" });
    resolutions(privateFolder, [
      { key: "eq-1", a: "0.25", b: "0.52", crop: "waves/01/crops/eq-1.png", ruling: "a", value: null },
      {
        key: "note-1",
        a: "check sign",
        b: "check size",
        crop: "waves/01/crops/note-1.png",
        ruling: "unreadable",
        value: null,
      },
    ]);

    const { code, out } = reconcile(project);

    expect(code).toBe(0);
    expect(out).toMatchObject({ agreed: 0, disputes: 2, settled: 2 });
    expect(out.checkpointItems).toEqual([
      {
        key: expect.stringMatching(/^01\/unreadable\/note-1-[0-9a-f]{6}$/),
        kind: "unreadable",
        question:
          'Unreadable annotation in L01.pdf, page 3: reader A read "check sign", reader B read "check size", and the render doesn\'t settle it. What does it say?',
        crop: join(privateFolder, "waves/01/crops/note-1.png"),
      },
    ]);
    const settled = JSON.parse(readFileSync(join(privateFolder, "waves/01/reading.json"), "utf8"));
    expect(settled.items.find((i: Item) => i.key === "eq-1").value).toBe("0.25");
    expect(settled.items.find((i: Item) => i.key === "note-1").value).toBeNull();
  });

  test("a dispute settled without a crop in the Private folder is refused: disputes are settled on what the Professor wrote", () => {
    const { project, privateFolder } = newCourse();
    readings(privateFolder, [item("eq-1", "0.25")], [item("eq-1", "0.52")]);
    resolutions(privateFolder, [
      { key: "eq-1", a: "0.25", b: "0.52", crop: "waves/01/crops/eq-1.png", ruling: "a", value: null },
    ]);

    const { code, out } = reconcile(project);

    expect(code).toBe(2);
    expect(out.error).toMatch(/eq-1.*crop.*waves\/01\/crops\/eq-1\.png/);
  });

  test("places where the Materials contradict themselves become Checkpoint items", () => {
    const { project, privateFolder } = newCourse();
    const both = [
      item("slide-alpha", "0.01", { quantity: "learning rate", file: "L01.pdf", page: 2 }),
      item("sheet-alpha", "0.1", { quantity: "Learning rate", file: "Sheet 1.pdf", page: 1 }),
      item("again-alpha", "0.010", { quantity: "learning rate", file: "L01.pdf", page: 9 }),
    ];
    readings(privateFolder, both, both);

    const { code, out } = reconcile(project);

    expect(code).toBe(0);
    expect(out.checkpointItems).toEqual([
      {
        key: expect.stringMatching(/^01\/conflict\/learning-rate-[0-9a-f]{6}$/),
        kind: "conflict",
        question:
          "The Materials disagree on learning rate: 0.01 (L01.pdf, page 2), 0.1 (Sheet 1.pdf, page 1), 0.010 (L01.pdf, page 9). Which does the Module follow?",
      },
    ]);
  });

  test("a reading changed after it was settled withdraws the settled reading until its new disputes are ruled", () => {
    const { project, privateFolder } = newCourse();
    readings(privateFolder, [item("eq-1", "0.25")], [item("eq-1", "0.25")]);
    must(reconcile(project));
    readings(privateFolder, [item("eq-1", "0.25")], [item("eq-1", "0.52")]);

    expect(reconcile(project).code).toBe(1);
    expect(existsSync(join(privateFolder, "waves/01/reading.json"))).toBe(false);
    expect(existsSync(join(privateFolder, "waves/01/checkpoint-items.json"))).toBe(false);
  });

  test("a ruling stands only for the values it was made on: a reader changing a disputed value reopens the dispute", () => {
    const { project, privateFolder } = newCourse();
    readings(privateFolder, [item("eq-1", "0.25")], [item("eq-1", "0.52")]);
    writeFiles(privateFolder, { "waves/01/crops/eq-1.png": "png" });
    resolutions(privateFolder, [
      { key: "eq-1", a: "0.25", b: "0.52", crop: "waves/01/crops/eq-1.png", ruling: "a", value: null },
    ]);
    must(reconcile(project));
    readings(privateFolder, [item("eq-1", "0.26")], [item("eq-1", "0.52")]);

    const reopened = reconcile(project);

    expect(reopened.code).toBe(1);
    expect(reopened.out.disputes).toEqual([expect.objectContaining({ key: "eq-1", a: "0.26", b: "0.52" })]);
    expect(existsSync(join(privateFolder, "waves/01/reading.json"))).toBe(false);
  });

  test("a conflict whose values change is a new question, under a new key", () => {
    const { project, privateFolder } = newCourse();
    const conflict = (sheet: string) => [
      item("slide-alpha", "0.01", { quantity: "learning rate" }),
      item("sheet-alpha", sheet, { quantity: "learning rate", file: "Sheet 1.pdf" }),
    ];
    readings(privateFolder, conflict("0.1"), conflict("0.1"));
    const first = must(reconcile(project)).checkpointItems[0].key as string;
    readings(privateFolder, conflict("0.5"), conflict("0.5"));
    const second = must(reconcile(project)).checkpointItems[0].key as string;

    expect(first).toMatch(/^01\/conflict\/learning-rate-/);
    expect(second).toMatch(/^01\/conflict\/learning-rate-/);
    expect(second).not.toBe(first);
  });

  test("readings are read only from the Private folder, each from its own reader", () => {
    const { project, privateFolder } = newCourse();
    writeFiles(privateFolder, {
      "waves/01/reading-a.json": JSON.stringify(reading("a", [item("eq-1", "1")])),
      "waves/01/reading-b.json": JSON.stringify(reading("a", [item("eq-1", "1")])),
    });

    expect(reconcile(project).code).toBe(2);
    rmSync(join(privateFolder, "waves/01/reading-b.json"));
    expect(reconcile(project).out.error).toMatch(/reading-b\.json/);
  });
});

const PREVIEW = "https://machine-learning-git-module-01.vercel.app";
const SHEET_ITEM = {
  gate: "worked-numbers",
  outcome: "checkpoint",
  at: "modules/01-m01/worked/1.json",
  message: "sheet cell D4 prints 1.45, but the independent recompute gives 1.54: rule it a Slip or a Divergence",
  spot: "/01-m01/#worked-W01.1",
};

function gitIn(repo: string, ...args: string[]) {
  const child = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  if (child.status !== 0) throw new Error(`git ${args.join(" ")}: ${child.stderr}`);
  return child.stdout;
}

const headOf = (repo: string) => gitIn(repo, "rev-parse", "HEAD").trim();

/** The Module's Gate reports as the template's gate runner writes them, in the content's build records. */
function gateReports(project: string, items: unknown[], url: string | null = PREVIEW) {
  const report = (point: string, extra: Record<string, unknown>) =>
    JSON.stringify({ report: "learn-premium gate report v1", commit: COMMIT, point, checkpointItems: items, ...extra });
  writeFiles(join(project, "content", "build-records", "gate-reports"), {
    "job-01-m01.json": report("job", { module: "01-m01" }),
    "module-01-m01.json": report("module", { module: "01-m01", ...(url === null ? {} : { url }) }),
    // The deploy point runs the same content gates over the whole Course: the item comes twice.
    "deploy.json": report("deploy", {}),
  });
}

const greenVerifier = { verifier: { verify: () => ({ green: true, problems: [] }), rulings: () => [] } };

/**
 * Module 01's wave, run to the Checkpoint on a synthetic Course project: the readings settled (one
 * region unreadable), the style sheet and the Module's content written, every job recorded, the
 * gates run on the preview with one sheet-vs-recompute item, and the pre-commit gate as the hook.
 */
function waveAtCheckpoint() {
  const { project, privateFolder } = newCourse();
  const holder = ["--project", project, "--holder", "session-a"];
  const { wave: waveId } = must(
    ledger("wave", "start", ...holder, "--kind", "module", "--target", "01", "--branch", "module/01-m01"),
  );
  readings(privateFolder, [item("eq-1", "0.25"), item("eq-2", "3")], [item("eq-1", "0.25"), item("eq-2", "8")]);
  writeFiles(privateFolder, { "waves/01/crops/eq-2.png": "png" });
  resolutions(privateFolder, [
    { key: "eq-2", a: "3", b: "8", crop: "waves/01/crops/eq-2.png", ruling: "unreadable", value: null },
  ]);
  must(reconcile(project));
  writeFiles(project, {
    "content/style-sheet.yaml": "writtenFrom: 01-m01\n",
    "content/modules/01-m01/module.yaml": "title: Module 01\n",
  });
  for (const job of [
    "blind-reader-a",
    "blind-reader-b",
    "reconcile",
    "style-sheet",
    "writer",
    "recompute",
    "job-gates",
    "consistency",
    "module-gates",
    "review",
    "deploy-gates",
  ])
    must(ledger("record", "job", ...holder, "--wave", waveId, "--job", job, "--result", "passed"));
  gateReports(project, [SHEET_ITEM]);
  gitIn(project, "init", "-q");
  gitIn(project, "config", "core.hooksPath", "template/gates/hooks");
  gitIn(project, "symbolic-ref", "HEAD", "refs/heads/module/01-m01");
  gitIn(project, "config", "user.name", "Fixture");
  gitIn(project, "config", "user.email", "fixture@example.test");
  gitIn(project, "config", "commit.gpgsign", "false");
  chmodSync(join(project, "template/gates/hooks/pre-commit"), 0o755);
  // The fresh reviewer reviewed the Module's content as committed, on its preview's screenshots, and found nothing.
  gitIn(project, "add", "-A");
  gitIn(project, "commit", "-q", "-m", "feat: Module 01");
  const reviewed = headOf(project);
  shots(privateFolder, reviewed);
  review(privateFolder, [], reviewed);
  return { project, privateFolder, waveId, holder };
}

const checkpointOf = (project: string) => wave(["checkpoint", "--project", project, "--module", "01"]);
/**
 * Runs `ready`. By default the consistency pass is recorded again first and everything committed, as
 * the main agent does once the Owner's answers are applied; `fresh: false` leaves things as they are.
 */
function ready(project: string, waveId: string, deps: Partial<WaveDeps> = greenVerifier, fresh = true): Result {
  if (fresh) {
    const job = ["--project", project, "--holder", "session-a", "--wave", waveId, "--job", "consistency"];
    ledger("record", "job", ...job, "--result", "passed");
    if (existsSync(join(project, ".git"))) {
      gitIn(project, "add", "-A");
      gitIn(project, "commit", "-q", "--allow-empty", "-m", "chore: the wave's records");
    }
  }
  return wave(["ready", "--project", project, "--wave", waveId], deps);
}

/** Answers every open Checkpoint item, a sheet one with a Slip ruling. */
function answerEvery(project: string, waveId: string, holder: string[]) {
  for (const i of must(checkpointOf(project)).open as { key: string; question: string; sheet: boolean }[])
    must(
      ledger(
        "record",
        "checkpoint",
        ...holder,
        ...["--wave", waveId, "--key", i.key, "--question", i.question, "--answer", "a"],
        ...(i.sheet ? ["--ruling", "slip"] : []),
      ),
    );
}

describe("the batched Checkpoint", () => {
  test("gathers the Module's open items once each: sheet-vs-recompute linked to its spot on the preview, unreadable with its crop", () => {
    const { project, privateFolder } = waveAtCheckpoint();

    const { code, out } = checkpointOf(project);

    expect(code).toBe(0);
    expect(out.preview).toBe(PREVIEW);
    expect(out.open).toEqual([
      {
        key: expect.stringMatching(/^01\/worked-numbers\/[0-9a-f]{10}$/),
        kind: "gate",
        gate: "worked-numbers",
        sheet: true,
        question: `modules/01-m01/worked/1.json: ${SHEET_ITEM.message}`,
        link: `${PREVIEW}/01-m01/#worked-W01.1`,
      },
      expect.objectContaining({
        key: expect.stringMatching(/^01\/unreadable\/eq-2-/),
        kind: "unreadable",
        sheet: false,
        crop: join(privateFolder, "waves/01/crops/eq-2.png"),
      }),
    ]);
    expect(out.markdown).toContain(`1. \`${out.open[0].key}\``);
    expect(out.markdown).toContain(`[See it on the preview](${PREVIEW}/01-m01/#worked-W01.1)`);
    expect(out.markdown).toMatch(/Slip.*Divergence/);
    expect(out.markdown).toContain(`2. \`${out.open[1].key}\``);
  });

  test("merges only when every item is answered: the Owner's Slip ruling is stored, then carried by the content", () => {
    const { project, waveId, holder } = waveAtCheckpoint();
    const [sheet, unreadable] = (must(checkpointOf(project)).open as { key: string }[]).map((i) => i.key) as [
      string,
      string,
    ];
    const answer = (key: string, text: string, ruling?: string) =>
      must(
        ledger(
          "record",
          "checkpoint",
          ...holder,
          ...["--wave", waveId, "--key", key, "--question", "q", "--answer", text],
          ...(ruling === undefined ? [] : ["--ruling", ruling]),
        ),
      );

    const unanswered = ready(project, waveId);
    answer(unreadable, "It reads 8: the pen stroke is a closed loop.");
    answer(sheet, "A typo, I think.");
    const noRuling = ready(project, waveId);
    answer(sheet, "The sheet's total swaps two digits.", "slip");
    const unapplied = ready(project, waveId);
    // The writer ships the corrected value with both shown; the gates re-run and raise nothing.
    gateReports(project, []);
    const merged = ready(project, waveId);

    expect(unanswered.code).toBe(1);
    expect(unanswered.out.problems).toEqual([
      `Checkpoint item ${sheet} is unanswered (it needs a Slip or Divergence ruling)`,
      `Checkpoint item ${unreadable} is unanswered`,
    ]);
    expect(noRuling.out.problems).toEqual([
      `Checkpoint item ${sheet} is unanswered (it needs a Slip or Divergence ruling)`,
    ]);
    expect(unapplied.out.problems).toEqual([
      `Checkpoint item ${sheet} was ruled a slip, but the content doesn't carry the ruling yet (provenance slips)`,
    ]);
    expect(merged).toEqual({ code: 0, out: { ok: true, ready: true, problems: [] } });
    expect(must(ledger("checkpoint", "--project", project, "--key", sheet)).answer).toMatchObject({
      ruling: "slip",
      answer: "The sheet's total swaps two digits.",
    });
    // A re-run never asks again what the Owner answered.
    expect(must(checkpointOf(project)).open).toEqual([]);
  });

  test("a sitting-wide item (a licence at the deploy point) is asked once for the Course, not per Module", () => {
    const { project } = waveAtCheckpoint();
    gateReports(project, [{ gate: "licences", outcome: "checkpoint", at: "planted-gpl@1.0.0", message: "GPL-3.0" }]);

    const { out } = checkpointOf(project);

    expect(out.open.map((i: { key: string }) => i.key)).toEqual([
      expect.stringMatching(/^course\/licences\//),
      expect.stringMatching(/^01\/unreadable\//),
    ]);
  });
});

describe("ready, the Module wave's merge gate", () => {
  test("names everything a bare wave lacks (negative control): jobs, style sheet, readings, green reports, the preview, the hook", () => {
    const { project } = newCourse();
    const { wave: waveId } = must(
      ledger(
        "wave",
        "start",
        ...["--project", project, "--holder", "session-a", "--kind", "module", "--target", "01"],
        ...["--branch", "module/01-m01"],
      ),
    );
    const red = {
      verifier: {
        verify: (_: string, point: string) => ({ green: false, problems: [`no ${point} report`] }),
        rulings: () => [],
      },
    };

    const { code, out } = ready(project, waveId, red, false);

    expect(code).toBe(1);
    expect(out.ready).toBe(false);
    const problems = (out.problems as string[]).join("\n");
    for (const job of [
      "blind-reader-a",
      "blind-reader-b",
      "reconcile",
      "style-sheet",
      "writer",
      "recompute",
      "consistency",
    ])
      expect(problems).toContain(`job ${job} hasn't been recorded`);
    expect(problems).toMatch(/no Course style sheet at content\/style-sheet\.yaml/);
    expect(problems).toMatch(/no reading-a\.json in the Private folder/);
    expect(problems).toMatch(/the job Gate report isn't green for HEAD: no job report/);
    expect(problems).toMatch(/the module Gate report isn't green/);
    expect(problems).toMatch(/the deploy Gate report isn't green/);
    expect(problems).toMatch(/didn't run on its Vercel preview/);
    expect(problems).toMatch(/pre-commit gate isn't the repo's hook/);
  });

  test("a blocked job keeps the wave from merging, and only the first Module's wave owes the style sheet job", () => {
    const { project, waveId, holder } = waveAtCheckpoint();
    for (const key of (must(checkpointOf(project)).open as { key: string; sheet: boolean }[]).map((i) => i.key))
      must(
        ledger(
          "record",
          "checkpoint",
          ...holder,
          "--wave",
          waveId,
          "--key",
          key,
          "--question",
          "q",
          "--answer",
          "a",
          "--ruling",
          "divergence",
        ),
      );
    gateReports(project, []);
    must(ledger("record", "job", ...holder, "--wave", waveId, "--job", "recompute", "--result", "blocked"));

    expect(ready(project, waveId).out.problems).toEqual([
      "job recompute is blocked: its job fixes it, or it falls back",
    ]);

    must(ledger("record", "job", ...holder, "--wave", waveId, "--job", "recompute", "--result", "passed"));
    must(ledger("wave", "end", ...holder, "--wave", waveId, "--result", "merged", "--commit", COMMIT));
    const { wave: second } = must(
      ledger("wave", "start", ...holder, "--kind", "module", "--target", "02", "--branch", "module/02-m02"),
    );
    const problems = ready(project, second).out.problems as string[];
    expect(problems.some((p) => p.includes("job style-sheet"))).toBe(false);
    expect(problems.some((p) => p.includes("job writer"))).toBe(true);
  });

  test("a settled reading older than the readings it was settled from keeps the wave from merging", () => {
    const { project, privateFolder, waveId, holder } = waveAtCheckpoint();
    for (const key of (must(checkpointOf(project)).open as { key: string }[]).map((i) => i.key))
      must(
        ledger(
          "record",
          "checkpoint",
          ...holder,
          ...["--wave", waveId, "--key", key, "--question", "q", "--answer", "a", "--ruling", "divergence"],
        ),
      );
    gateReports(project, []);
    expect(ready(project, waveId).out.problems).toEqual([]);

    // A reader's file changes after reconcile ran, and nobody re-ran it.
    writeFiles(privateFolder, {
      "waves/01/reading-b.json": JSON.stringify(reading("b", [item("eq-1", "0.26"), item("eq-2", "8")])),
    });

    expect(ready(project, waveId).out.problems).toEqual([
      expect.stringMatching(/the settled reading is stale.*re-run reconcile/),
    ]);
  });

  test("every Slip and Divergence the content ships needs the Owner's matching ruling in the ledger (negative control)", () => {
    const { project, waveId, holder } = waveAtCheckpoint();
    const [sheetItem, unreadable] = must(checkpointOf(project)).open as { key: string; question: string }[];
    const record = (key: string, question: string, ruling?: string) =>
      must(
        ledger(
          "record",
          "checkpoint",
          ...holder,
          ...["--wave", waveId, "--key", key, "--question", question, "--answer", "a"],
          ...(ruling === undefined ? [] : ["--ruling", ruling]),
        ),
      );
    record(unreadable?.key ?? "", "eq-2");
    gateReports(project, []);
    // The writer shipped a Divergence on the sheet's 1.45 with no Owner answer: the gate stays quiet.
    const shipped = (kind: "slip" | "divergence", entry = "modules/01-m01/worked/1.json", printed = [1.45]) => ({
      verifier: {
        verify: () => ({ green: true, problems: [] }),
        rulings: () => [{ entry, kind, printed }],
      },
    });

    const unruled = ready(project, waveId, shipped("divergence"));
    record(sheetItem?.key ?? "", sheetItem?.question ?? "", "slip");
    const otherRuling = ready(project, waveId, shipped("divergence"));
    const matching = ready(project, waveId, shipped("slip"));
    // The same value ruled in another example of the Module isn't the Owner's ruling on it.
    const elsewhere = ready(project, waveId, shipped("slip", "modules/01-m01/worked/2.json"));
    // A ruling naming a second value the Owner never ruled on isn't covered by the first.
    const widened = ready(project, waveId, shipped("slip", "modules/01-m01/worked/1.json", [1.45, 4.6]));
    expect(widened.out.problems).toEqual([
      expect.stringContaining("ships a slip on 1.45, 4.6 that no Owner answer rules"),
    ]);

    const problem = "modules/01-m01/worked/1.json ships a divergence on 1.45 that no Owner answer rules";
    expect(unruled.out.problems).toEqual([expect.stringContaining(problem)]);
    expect(otherRuling.out.problems).toEqual([expect.stringContaining(problem)]);
    expect(matching.out.problems).toEqual([]);
    expect(elsewhere.out.problems).toEqual([
      expect.stringContaining("modules/01-m01/worked/2.json ships a slip on 1.45 that no Owner answer rules"),
    ]);
  });

  test("a job that escalated to the Owner is a Checkpoint item, and the wave waits for its answer", () => {
    const { project, waveId, holder } = waveAtCheckpoint();
    const answerAll = () => {
      for (const i of must(checkpointOf(project)).open as { key: string; question: string; sheet: boolean }[])
        must(
          ledger(
            "record",
            "checkpoint",
            ...holder,
            ...["--wave", waveId, "--key", i.key, "--question", i.question, "--answer", "a"],
            ...(i.sheet ? ["--ruling", "slip"] : []),
          ),
        );
    };
    answerAll();
    gateReports(project, []);
    must(
      ledger(
        "record",
        "job",
        ...holder,
        ...["--wave", waveId, "--job", "recompute", "--result", "checkpoint"],
        ...["--detail", "Sheet 2's question 3 doesn't fix the step size; the recompute can't work it out"],
      ),
    );

    const { open } = must(checkpointOf(project));
    const waiting = ready(project, waveId);
    answerAll();

    expect(open).toEqual([
      expect.objectContaining({
        key: expect.stringMatching(/^01\/job\/recompute-[0-9a-f]{6}$/),
        kind: "job",
        question:
          "The recompute job needs the Owner: Sheet 2's question 3 doesn't fix the step size; the recompute can't work it out",
      }),
    ]);
    expect(waiting.out.problems).toEqual([
      expect.stringMatching(/^Checkpoint item 01\/job\/recompute-.* is unanswered$/),
    ]);
    expect(ready(project, waveId).out.problems).toEqual([]);
  });

  test("a Slip or Divergence no gate raises (in a Practice item) is authorized by an Owner ruling recorded for it", () => {
    const { project, waveId, holder } = waveAtCheckpoint();
    for (const i of must(checkpointOf(project)).open as { key: string; question: string; sheet: boolean }[])
      must(
        ledger(
          "record",
          "checkpoint",
          ...holder,
          ...["--wave", waveId, "--key", i.key, "--question", i.question, "--answer", "a"],
          ...(i.sheet ? ["--ruling", "slip"] : []),
        ),
      );
    gateReports(project, []);
    const practice = {
      verifier: {
        verify: () => ({ green: true, problems: [] }),
        rulings: () => [{ entry: "modules/01-m01/practice/2.yaml", kind: "divergence" as const, printed: [9.6] }],
      },
    };

    const before = ready(project, waveId, practice);
    must(
      ledger(
        "record",
        "checkpoint",
        ...holder,
        ...["--wave", waveId, "--key", "01/ruling/practice-2-answer"],
        ...["--question", "modules/01-m01/practice/2.yaml: the key prints 9.6, but the recompute gives 9.4"],
        ...["--answer", "The exam marks 9.6.", "--ruling", "divergence"],
      ),
    );

    expect(before.out.problems).toEqual([expect.stringContaining("practice/2.yaml ships a divergence on 9.6")]);
    expect(ready(project, waveId, practice).out.problems).toEqual([]);
  });

  test("the template's verify finds the Course's content from a relative project path", () => {
    const { project } = waveAtCheckpoint();
    // A stand-in gate CLI: green only when --content names the project's content folder.
    writeFiles(project, {
      "template/gates/cli.ts": [
        'import { existsSync } from "node:fs";',
        'import { join } from "node:path";',
        'const at = process.argv.indexOf("--content");',
        'process.exitCode = existsSync(join(process.argv[at + 1] ?? "", "style-sheet.yaml")) ? 0 : 1;',
        "",
      ].join("\n"),
    });

    // From the project's parent, so the path is relative on every drive layout.
    const cwd = process.cwd();
    process.chdir(dirname(project));
    try {
      expect(templateVerifier.verify(relative(process.cwd(), project), "job", "01-m01")).toEqual({
        green: true,
        problems: [],
      });
    } finally {
      process.chdir(cwd);
    }
  });

  test("it checks the wave's own branch, a settled reading with its Checkpoint items, and an executable hook", () => {
    const { project, privateFolder, waveId, holder } = waveAtCheckpoint();
    for (const i of must(checkpointOf(project)).open as { key: string; question: string; sheet: boolean }[])
      must(
        ledger(
          "record",
          "checkpoint",
          ...holder,
          ...["--wave", waveId, "--key", i.key, "--question", i.question, "--answer", "a"],
          ...(i.sheet ? ["--ruling", "slip"] : []),
        ),
      );
    gateReports(project, []);
    expect(ready(project, waveId).out.problems).toEqual([]);

    // Another branch checked out: its HEAD and reports aren't the wave's.
    gitIn(project, "symbolic-ref", "HEAD", "refs/heads/main");
    expect(ready(project, waveId).out.problems).toEqual([
      expect.stringContaining("checked out on main, not the wave's branch module/01-m01"),
    ]);
    gitIn(project, "symbolic-ref", "HEAD", "refs/heads/module/01-m01");

    // The settled reading's Checkpoint items lost (an interrupted reconcile): it doesn't stand.
    rmSync(join(privateFolder, "waves/01/checkpoint-items.json"));
    expect(ready(project, waveId).out.problems).toEqual([expect.stringMatching(/re-run reconcile/)]);
    must(reconcile(project));

    if (process.platform !== "win32") {
      chmodSync(join(project, "template/gates/hooks/pre-commit"), 0o644);
      expect(ready(project, waveId).out.problems).toEqual([
        expect.stringMatching(/pre-commit gate isn't the repo's hook/),
      ]);
    }
  });

  test("a Material changed since the wave started, two rulings on one Owner answer, and an STL item without a ruling keep it from merging", () => {
    const { project, waveId, holder } = waveAtCheckpoint();
    const answer = (key: string, question: string, ruling?: string) =>
      must(
        ledger(
          "record",
          "checkpoint",
          ...holder,
          ...["--wave", waveId, "--key", key, "--question", question, "--answer", "a"],
          ...(ruling === undefined ? [] : ["--ruling", ruling]),
        ),
      );
    const [sheetItem, unreadable] = must(checkpointOf(project)).open as { key: string; question: string }[];
    answer(sheetItem?.key ?? "", sheetItem?.question ?? "", "slip");
    answer(unreadable?.key ?? "", "eq-2");
    gateReports(project, []);
    const shipped = (n: number) => ({
      verifier: {
        verify: () => ({ green: true, problems: [] }),
        rulings: () =>
          Array.from({ length: n }, () => ({
            entry: "modules/01-m01/worked/1.json",
            kind: "slip" as const,
            printed: [1.45],
          })),
      },
    });
    expect(ready(project, waveId, shipped(1)).out.problems).toEqual([]);
    // Two cells ruled on the one value the Owner answered for once.
    expect(ready(project, waveId, shipped(2)).out.problems).toEqual([expect.stringContaining("ships a slip on 1.45")]);

    // The stl gate's sheet item needs a ruling like any other sheet item.
    gateReports(project, [
      {
        gate: "stl",
        outcome: "checkpoint",
        at: "modules/01-m01/worked/1.json",
        message: "sheet cell C2 prints 7, but awlsim gives 8: rule it a Slip or a Divergence",
      },
    ]);
    const stl = (must(checkpointOf(project)).open as { key: string; sheet: boolean }[])[0];
    expect(stl).toMatchObject({ sheet: true });
    gateReports(project, []);

    writeFiles(materialsOf(project), { "L01.pdf": "edited after the readers read it" });
    expect(ready(project, waveId, shipped(1)).out.problems).toEqual([
      expect.stringMatching(/L01\.pdf changed since wave module-01-1 started/),
    ]);
  });

  test("an edited template layer, and Owner answers newer than the consistency pass, keep the wave from merging", () => {
    const { project, waveId, holder } = waveAtCheckpoint();
    const open = must(checkpointOf(project)).open as { key: string; question: string; sheet: boolean }[];
    gateReports(project, []);
    for (const i of open)
      must(
        ledger(
          "record",
          "checkpoint",
          ...holder,
          ...["--wave", waveId, "--key", i.key, "--question", i.question, "--answer", "a"],
          ...(i.sheet ? ["--ruling", "slip"] : []),
        ),
      );

    // The unreadable region's answer came after the consistency pass recorded: the content may not carry it.
    expect(ready(project, waveId, greenVerifier, false).out.problems).toContainEqual(
      expect.stringMatching(
        /the Owner answered .* after the consistency pass: apply the answers, then record consistency again/,
      ),
    );
    expect(ready(project, waveId).out.problems).toEqual([]);

    // A template file the branch edited: its gates can't be trusted to verify the branch.
    writeFiles(project, { "template/gates/cli.ts": "process.exitCode = 0;\n" });
    expect(ready(project, waveId).out.problems).toEqual([
      // The page renders from the template layer, so the fresh reviewer's review is stale too.
      expect.stringMatching(/the review is of .* renders from changed since \(template\/gates\/cli\.ts\)/),
      expect.stringMatching(/the template layer isn't the pinned release's: added gates\/cli\.ts/),
    ]);
  });

  test("uncommitted ledger rows or content keep the wave from merging: ready judges the commit that merges", () => {
    const { project, waveId, holder } = waveAtCheckpoint();
    for (const i of must(checkpointOf(project)).open as { key: string; question: string; sheet: boolean }[])
      must(
        ledger(
          "record",
          "checkpoint",
          ...holder,
          ...["--wave", waveId, "--key", i.key, "--question", i.question, "--answer", "a"],
          ...(i.sheet ? ["--ruling", "slip"] : []),
        ),
      );
    gateReports(project, []);
    expect(ready(project, waveId).out.problems).toEqual([]);

    must(ledger("record", "job", ...holder, "--wave", waveId, "--job", "consistency", "--result", "passed"));
    expect(ready(project, waveId, greenVerifier, false).out.problems).toEqual([
      expect.stringMatching(/uncommitted changes .*build-ledger\.json/),
    ]);
  });

  test("a Slip naming another cell isn't authorized by the Owner's ruling on this cell's value", () => {
    const { project, waveId, holder } = waveAtCheckpoint();
    for (const i of must(checkpointOf(project)).open as { key: string; question: string; sheet: boolean }[])
      must(
        ledger(
          "record",
          "checkpoint",
          ...holder,
          ...["--wave", waveId, "--key", i.key, "--question", i.question, "--answer", "a"],
          ...(i.sheet ? ["--ruling", "slip"] : []),
        ),
      );
    gateReports(project, []);
    // The Owner ruled on D4 printing 1.45 (SHEET_ITEM).
    const slipOn = (cell: string) => ({
      verifier: {
        verify: () => ({ green: true, problems: [] }),
        rulings: () => [{ entry: "modules/01-m01/worked/1.json", kind: "slip" as const, printed: [1.45], cell }],
      },
    });
    expect(ready(project, waveId, slipOn("D4")).out.problems).toEqual([]);
    expect(ready(project, waveId, slipOn("E2")).out.problems).toEqual([
      expect.stringContaining("ships a slip on 1.45 (cell E2)"),
    ]);
  });

  test("with no template layer to verify with, every Gate report counts as not green", () => {
    const { project, waveId } = waveAtCheckpoint();

    const problems = ready(project, waveId, {}).out.problems as string[];

    expect(problems.filter((p) => p.includes("no gate runner"))).toHaveLength(4);
  });

  test("the merge gate trusts no report's own verdict: it asks the template's verify for HEAD", () => {
    const { project, waveId, holder } = waveAtCheckpoint();
    for (const key of (must(checkpointOf(project)).open as { key: string }[]).map((i) => i.key))
      must(
        ledger(
          "record",
          "checkpoint",
          ...holder,
          "--wave",
          waveId,
          "--key",
          key,
          "--question",
          "q",
          "--answer",
          "a",
          "--ruling",
          "divergence",
        ),
      );
    gateReports(project, []);
    const asked: string[] = [];
    const verifier = {
      verify: (_: string, point: string, module: string | undefined) => {
        asked.push(`${point} ${module ?? "(Course)"}`);
        return point === "module"
          ? { green: false, problems: ["the report checked another commit"] }
          : { green: true, problems: [] };
      },
      rulings: () => [],
    };

    const { out } = ready(project, waveId, { verifier });

    expect(asked).toEqual(["job 01-m01", "module 01-m01", "deploy (Course)"]);
    expect(out.problems).toEqual(["the module Gate report isn't green for HEAD: the report checked another commit"]);
  });

  test("the fresh reviewer: its review must be of HEAD's Module content, re-verified, with nothing confirmed left", () => {
    const { project, privateFolder, waveId, holder } = waveAtCheckpoint();
    answerEvery(project, waveId, holder);
    gateReports(project, []);
    expect(ready(project, waveId).out.problems).toEqual([]);

    // The reviewer finds a meaning slip; until the main agent re-verifies it, the wave waits.
    review(privateFolder, [MEANING_SLIP], headOf(project));
    shots(privateFolder, headOf(project));
    const unverified = ready(project, waveId).out.problems;
    const key = (wave(["review", "--project", project, "--module", "01"]).out.unverified[0] as { key: string }).key;
    writeFiles(privateFolder, { "waves/01/crops/slip.png": "png" });
    verdicts(privateFolder, [
      { key, verdict: "confirmed", evidence: "waves/01/crops/slip.png", fix: "writer", reason: "the crop agrees" },
    ]);
    const confirmed = ready(project, waveId).out.problems;
    // The writer fixes it: the content changes, so the old review no longer speaks for HEAD.
    writeFiles(project, { "content/modules/01-m01/summary/2.md": "The largest drop is across the largest R.\n" });
    const stale = ready(project, waveId).out.problems;
    // A fresh reviewer reviews the new commit and finds nothing.
    review(privateFolder, [], headOf(project));
    shots(privateFolder, headOf(project));
    const fresh = ready(project, waveId);

    expect(unverified).toEqual([
      expect.stringMatching(/the fresh reviewer's finding r-[0-9a-f]{10} isn't re-verified/),
    ]);
    expect(confirmed).toEqual([
      expect.stringMatching(/confirmed finding r-[0-9a-f]{10} .*summary\/2\.md.* goes back to writer/),
    ]);
    expect(stale).toEqual([
      expect.stringMatching(
        /the review is of [0-9a-f]{40}, but what the Module page renders from changed since \(content\/modules\/01-m01\/summary\/2\.md\): .*fresh reviewer/,
      ),
    ]);
    expect(fresh.out.problems).toEqual([]);

    // A Course override of a component the page renders with makes the review stale too.
    writeFiles(project, { "overrides/src/components/PlotFigure.tsx": "export {};\n" });
    expect(ready(project, waveId).out.problems).toEqual([
      expect.stringMatching(/renders from changed since \(overrides\/src\/components\/PlotFigure\.tsx\)/),
    ]);
  });

  test("a wave with no review yet, or none recorded, doesn't merge (negative control)", () => {
    const { project, privateFolder, waveId, holder } = waveAtCheckpoint();
    answerEvery(project, waveId, holder);
    gateReports(project, []);
    rmSync(join(privateFolder, "waves/01/review/review.json"));

    expect(ready(project, waveId).out.problems).toEqual([expect.stringMatching(/no review\.json/)]);
  });

  test("any blocked job of the wave keeps it red, a sim builder's too; one that fell back to its step-through doesn't", () => {
    const { project, waveId, holder } = waveAtCheckpoint();
    answerEvery(project, waveId, holder);
    gateReports(project, []);
    const sim = (result: string, detail: string) =>
      must(
        ledger(
          "record",
          "job",
          ...holder,
          "--wave",
          waveId,
          "--job",
          "sim-ramp",
          "--result",
          result,
          "--detail",
          detail,
        ),
      );

    [1, 2, 3].forEach(() => sim("blocked", "drawing gate red"));
    const blocked = ready(project, waveId).out.problems;
    sim("fell-back", "step-through of the ramp figure");

    expect(blocked).toEqual(["job sim-ramp is blocked: its job fixes it, or it falls back"]);
    expect(ready(project, waveId).out.problems).toEqual([]);
  });
});
