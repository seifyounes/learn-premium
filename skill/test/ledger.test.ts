import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { jsonInput, ledger, tempDir, writeFiles, type Result } from "./helpers.ts";

// sha256 of the literal file contents, computed independently of the code under test.
const SHA256_ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
const SHA256_EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

describe("next action", () => {
  test("a Course project with no Build ledger starts with intake", () => {
    const project = tempDir("project");

    const { code, out } = ledger("next", "--project", project);

    expect(code).toBe(0);
    expect(out).toEqual({ ok: true, action: "intake" });
  });
});

describe("init", () => {
  test("records the intake answers, the release tag and a hash of every template-layer file, and takes the lock", () => {
    const project = tempDir("project");
    const materials = tempDir("materials");
    writeFiles(project, { "template/src/page.astro": "abc", "template/package.json": "" });

    const init = ledger(
      "init",
      "--project",
      project,
      "--holder",
      "session-a",
      "--release",
      "v2.0.0",
      "--intake",
      jsonInput(intake(materials)),
    );
    const { out } = ledger("status", "--project", project);

    expect(init.code).toBe(0);
    expect(out.course).toBe("Heat Transfer");
    expect(out.materialsPath).toBe(materials);
    expect(out.template).toEqual({
      release: "v2.0.0",
      files: { "package.json": SHA256_EMPTY, "src/page.astro": SHA256_ABC },
      overrides: [],
    });
    expect(out.lock).toMatchObject({ holder: "session-a" });
  });
});

describe("Materials diff", () => {
  test("on a new Course every Materials file is new, with its kind, and next action asks for a Module map", () => {
    const { project } = newCourse({
      "Lectures/L01 Conduction.pdf": "l1",
      "Lectures/L02 Convection.pptx": "l2",
      "Sheets/sheet1.JPG": "s1",
      "notes.txt": "n",
      "Thumbs.db": "junk",
    });

    const diff = ledger("diff", "--project", project);
    const next = ledger("next", "--project", project);

    expect(diff.out.new).toEqual([
      { path: "Lectures/L01 Conduction.pdf", kind: "pdf" },
      { path: "Lectures/L02 Convection.pptx", kind: "slides" },
      { path: "Sheets/sheet1.JPG", kind: "image" },
      { path: "notes.txt", kind: "other" },
    ]);
    expect(diff.out.changed).toEqual([]);
    expect(diff.out.deleted).toEqual([]);
    expect(next.out).toEqual({ ok: true, action: "waves", newMaterials: diff.out.new, waves: [] });
  });
});

describe("Module map", () => {
  test("records each Module with its Materials, and a new Course builds Module 1 alone first", () => {
    const { project } = mappedCourse();

    const next = ledger("next", "--project", project);
    const { out } = ledger("status", "--project", project);

    expect(next.out).toEqual({
      ok: true,
      action: "waves",
      newMaterials: [],
      waves: [{ kind: "module", target: "01", reasons: ["planned"] }],
    });
    expect(out.modules).toEqual([
      { id: "01", slug: "conduction", title: "Conduction", state: "planned", materials: ["L01.pdf", "sheet1.jpg"] },
      { id: "02", slug: "convection", title: "Convection", state: "planned", materials: ["L02.pdf"] },
    ]);
  });

  test("refuses a file that isn't in the Materials folder", () => {
    const { project } = newCourse({ "L01.pdf": "l1" });

    const { code, out } = ledger(
      "map",
      "--project",
      project,
      "--holder",
      "session-a",
      "--input",
      jsonInput({
        modules: [{ id: "01", slug: "conduction", title: "Conduction", materials: ["L01.pdf", "L99.pdf"] }],
        unmapped: [],
      }),
    );

    expect(code).toBe(2);
    expect(out.error).toContain("L99.pdf");
  });
});

describe("Materials diff after a build", () => {
  test("classifies new, changed and deleted files; a changed or deleted file flags its Module for a fresh wave", () => {
    const { project, materials } = liveCourse();
    writeFiles(materials, { "L01.pdf": "l1 revised", "L03.pdf": "l3" });
    rmSync(join(materials, "L02.pdf"));

    const diff = ledger("diff", "--project", project);
    const next = ledger("next", "--project", project);

    expect(diff.out).toEqual({
      ok: true,
      new: [{ path: "L03.pdf", kind: "pdf" }],
      changed: [{ path: "L01.pdf", kind: "pdf", module: "01" }],
      deleted: [{ path: "L02.pdf", kind: "pdf", module: "02" }],
    });
    expect(next.out).toEqual({
      ok: true,
      action: "waves",
      newMaterials: [{ path: "L03.pdf", kind: "pdf" }],
      waves: [
        { kind: "module", target: "01", reasons: ["materials-changed"] },
        { kind: "module", target: "02", reasons: ["materials-deleted"] },
      ],
    });
  });

  test("starting the flagged Module's wave takes in its changed and deleted files, keeping the old rows marked superseded", () => {
    const { project, materials } = liveCourse();
    writeFiles(materials, { "L01.pdf": "l1 revised" });
    rmSync(join(materials, "sheet1.jpg"));

    ledger(
      "wave",
      "start",
      "--project",
      project,
      "--holder",
      "session-a",
      "--kind",
      "module",
      "--target",
      "01",
      "--branch",
      "module/01-again",
    );
    const diff = ledger("diff", "--project", project);
    const { out } = ledger("status", "--project", project);

    expect(diff.out).toMatchObject({ new: [], changed: [], deleted: [] });
    expect(out.modules[0].materials).toEqual(["L01.pdf"]);
    expect(out.superseded).toEqual([
      expect.objectContaining({ row: "material", id: "L01.pdf", reason: "changed on disk" }),
      expect.objectContaining({ row: "material", id: "sheet1.jpg", reason: "deleted from the Materials" }),
    ]);
  });
});

const COMMIT = "0123456789abcdef0123456789abcdef01234567";

describe("waves", () => {
  test("an unfinished wave makes next action resume it", () => {
    const { project } = mappedCourse();

    const start = ledger(
      "wave",
      "start",
      "--project",
      project,
      "--holder",
      "session-a",
      "--kind",
      "module",
      "--target",
      "01",
      "--branch",
      "module/01-conduction",
    );
    const next = ledger("next", "--project", project);

    expect(start.code).toBe(0);
    expect(next.out).toEqual({
      ok: true,
      action: "resume",
      waves: [{ id: start.out.wave, kind: "module", target: "01", branch: "module/01-conduction", state: "running" }],
    });
  });

  test("a merged wave records its release tag and commit, makes its Module live, and frees the other Modules to build", () => {
    const { project } = mappedCourse();
    const { out: started } = ledger(
      "wave",
      "start",
      "--project",
      project,
      "--holder",
      "session-a",
      "--kind",
      "module",
      "--target",
      "01",
      "--branch",
      "module/01-conduction",
    );

    const end = ledger(
      "wave",
      "end",
      "--project",
      project,
      "--holder",
      "session-a",
      "--wave",
      started.wave,
      "--result",
      "merged",
      "--commit",
      COMMIT,
    );
    const { out } = ledger("status", "--project", project);
    const next = ledger("next", "--project", project);

    expect(end.code).toBe(0);
    expect(out.modules.map((m: { state: string }) => m.state)).toEqual(["live", "planned"]);
    expect(out.waves).toEqual([
      expect.objectContaining({ id: started.wave, target: "01", state: "merged", release: "v2.0.0", commit: COMMIT }),
    ]);
    expect(next.out.waves).toEqual([{ kind: "module", target: "02", reasons: ["planned"] }]);
  });

  test("Module 1 builds alone first: no other Module's wave starts until its wave merges the Course style sheet", () => {
    const { project } = mappedCourse();
    const start = (target: string) =>
      ledger(
        "wave",
        "start",
        ...["--project", project, "--holder", "session-a", "--kind", "module", "--target", target],
        ...["--branch", `module/${target}`],
      );

    const early = start("02");
    const first = start("01");
    const alongside = start("02");
    ledger(
      "wave",
      "end",
      ...["--project", project, "--holder", "session-a", "--wave", first.out.wave, "--result", "merged"],
      ...["--commit", COMMIT],
    );
    const after = start("02");

    expect(early.code).toBe(3);
    expect(early.out.error).toMatch(/Module 01 builds alone first.*Course style sheet/);
    expect(first.code).toBe(0);
    expect(alongside.code).toBe(3);
    expect(after.code).toBe(0);
  });

  test("a failed wave sends its Module back to be built again", () => {
    const { project } = mappedCourse();
    const { out: started } = ledger(
      "wave",
      "start",
      "--project",
      project,
      "--holder",
      "session-a",
      "--kind",
      "module",
      "--target",
      "01",
      "--branch",
      "module/01-conduction",
    );

    ledger("wave", "end", "--project", project, "--holder", "session-a", "--wave", started.wave, "--result", "failed");
    const next = ledger("next", "--project", project);

    expect(next.out.waves).toEqual([{ kind: "module", target: "01", reasons: ["failed"] }]);
  });

  test("refuses a second wave on a Module that already has one running", () => {
    const { project } = mappedCourse();
    ledger(
      "wave",
      "start",
      "--project",
      project,
      "--holder",
      "session-a",
      "--kind",
      "module",
      "--target",
      "01",
      "--branch",
      "b1",
    );

    const { code } = ledger(
      "wave",
      "start",
      "--project",
      project,
      "--holder",
      "session-a",
      "--kind",
      "module",
      "--target",
      "01",
      "--branch",
      "b2",
    );

    expect(code).toBe(3);
  });
});

describe("lock", () => {
  test("a second driver is refused while the lock is held, both claiming it and writing", () => {
    const { project } = mappedCourse();

    const claim = ledger("lock", "claim", "--project", project, "--holder", "session-b");
    const write = ledger(
      "wave",
      "start",
      "--project",
      project,
      "--holder",
      "session-b",
      "--kind",
      "module",
      "--target",
      "01",
      "--branch",
      "b",
    );

    expect(claim.code).toBe(3);
    expect(claim.out.error).toContain("session-a");
    expect(write.code).toBe(3);
    expect(ledger("next", "--project", project).out.action).toBe("waves"); // reads need no lock, and nothing was written
  });

  test("once released, another driver can claim it", () => {
    const { project } = mappedCourse();

    const release = ledger("lock", "release", "--project", project, "--holder", "session-a");
    const claim = ledger("lock", "claim", "--project", project, "--holder", "session-b");
    const write = ledger(
      "wave",
      "start",
      "--project",
      project,
      "--holder",
      "session-b",
      "--kind",
      "module",
      "--target",
      "01",
      "--branch",
      "b",
    );

    expect([release.code, claim.code, write.code]).toEqual([0, 0, 0]);
    expect(ledger("status", "--project", project).out.lock).toMatchObject({ holder: "session-b", tookOverFrom: null });
  });

  test("only the holder can release it, and the holder claiming again keeps it", () => {
    const { project } = mappedCourse();

    expect(ledger("lock", "release", "--project", project, "--holder", "session-b").code).toBe(3);
    expect(ledger("lock", "claim", "--project", project, "--holder", "session-a").code).toBe(0);
  });

  test("a dead session's lock is taken over only with a stated reason, which the ledger keeps", () => {
    const { project } = mappedCourse();

    const claim = ledger(
      "lock",
      "claim",
      "--project",
      project,
      "--holder",
      "session-b",
      "--take-over",
      "session-a died mid-wave; Owner said take over",
    );

    expect(claim.code).toBe(0);
    expect(ledger("status", "--project", project).out.lock).toMatchObject({
      holder: "session-b",
      tookOverFrom: { holder: "session-a", reason: "session-a died mid-wave; Owner said take over" },
    });
  });
});

describe("job results", () => {
  test("records each job's result and measured time in its wave; a re-run supersedes the earlier row", () => {
    const { project } = mappedCourse();
    const { out: started } = ledger(
      "wave",
      "start",
      "--project",
      project,
      "--holder",
      "session-a",
      "--kind",
      "module",
      "--target",
      "01",
      "--branch",
      "b",
    );
    const record = (result: string, detail: string) =>
      ledger(
        "record",
        "job",
        "--project",
        project,
        "--holder",
        "session-a",
        "--wave",
        started.wave,
        "--job",
        "recompute",
        "--result",
        result,
        "--started-at",
        "2026-09-30T08:00:00.000Z",
        "--detail",
        detail,
      );

    const first = record("blocked", "sheet 2 q3 off by 10x");
    const second = record("passed", "after fix round 1");
    const { out } = ledger("status", "--project", project);

    expect([first.code, second.code]).toEqual([0, 0]);
    expect(out.jobs).toEqual([
      expect.objectContaining({
        wave: started.wave,
        job: "recompute",
        result: "passed",
        startedAt: "2026-09-30T08:00:00.000Z",
        detail: "after fix round 1",
      }),
    ]);
    expect(out.superseded).toEqual([
      expect.objectContaining({ row: "job", id: `${started.wave}/recompute`, reason: "re-run" }),
    ]);
  });

  test("refuses a result for a wave that isn't running", () => {
    const { project } = mappedCourse();

    const { code } = ledger(
      "record",
      "job",
      "--project",
      project,
      "--holder",
      "session-a",
      "--wave",
      "module-01-9",
      "--job",
      "recompute",
      "--result",
      "passed",
    );

    expect(code).toBe(2);
  });
});

describe("the fix loop: two fix rounds, then the fallback, else a Checkpoint item", () => {
  /** A running Module 01 wave and a `record job` bound to it. */
  function runningWave() {
    const { project } = mappedCourse();
    const holder = ["--project", project, "--holder", "session-a"];
    const { out: started } = ledger("wave", "start", ...holder, "--kind", "module", "--target", "01", "--branch", "b");
    const record = (job: string, result: string, detail?: string) =>
      ledger(
        "record",
        "job",
        ...holder,
        ...["--wave", started.wave, "--job", job, "--result", result],
        ...(detail === undefined ? [] : ["--detail", detail]),
      );
    return { project, record };
  }

  test("a sim whose two fix rounds both fail falls back to its step-through, and nothing else can be recorded for it", () => {
    const { record } = runningWave();

    const first = record("sim-ramp", "blocked", "drawing gate: label side");
    const round1 = record("sim-ramp", "blocked", "still the label side");
    const round2 = record("sim-ramp", "blocked", "and again");
    const passedAfter = record("sim-ramp", "passed");
    const blockedAfter = record("sim-ramp", "blocked");
    const fellBack = record("sim-ramp", "fell-back", "step-through of the ramp figure");

    expect(first.out).toMatchObject({ ok: true, fixRounds: { used: 0, left: 2 } });
    expect(round1.out).toMatchObject({ ok: true, fixRounds: { used: 1, left: 1 } });
    expect(round2.out).toMatchObject({ ok: true, fixRounds: { used: 2, left: 0 }, exhausted: true });
    expect(round2.out.next).toMatch(/fall back.*step-through animation/);
    expect([passedAfter.code, blockedAfter.code]).toEqual([3, 3]);
    expect(passedAfter.out.error).toMatch(/sim-ramp's two fix rounds are spent.*fell-back.*checkpoint/);
    expect(fellBack.code).toBe(0);
  });

  test("each kind of job falls back its own way; a job with no fallback goes to the Owner's Checkpoint", () => {
    const { record } = runningWave();
    const spend = (job: string) => [1, 2, 3].map(() => record(job, "blocked", "red"))[2] as Result;

    expect(spend("tool-pendulum").out.next).toMatch(/next tool in the Discipline's Toolkit/);
    expect(spend("media-video").out.next).toMatch(/drop the media item/);
    const writer = spend("writer");
    expect(writer.out.next).toMatch(/no fallback.*--result checkpoint/);
    expect(record("writer", "fell-back", "anything").code).toBe(2);
    expect(record("writer", "checkpoint", "sheet 2 can't be written without the Owner's reading").code).toBe(0);
  });

  test("a fallback says what it fell back to", () => {
    const { record } = runningWave();

    const { code, out } = record("sim-ramp", "fell-back");

    expect(code).toBe(2);
    expect(out.error).toMatch(/--detail/);
  });

  test("a pass or an answered escalation ends the run of blocks: a later block gets two fresh fix rounds", () => {
    const { record } = runningWave();
    record("job-gates", "blocked", "red");
    record("job-gates", "blocked", "red");
    record("job-gates", "passed");

    expect(record("job-gates", "blocked", "red after the Checkpoint answers").out.fixRounds).toEqual({
      used: 0,
      left: 2,
    });
    [1, 2].forEach(() => record("job-gates", "blocked", "red"));
    record("job-gates", "checkpoint", "the gate needs the Owner's reading");
    expect(record("job-gates", "passed").code).toBe(0);
  });
});

describe("Checkpoint answers", () => {
  test("an answered Checkpoint item is stored, so a re-run finds the answer instead of asking again", () => {
    const { project } = mappedCourse();
    const { out: started } = ledger(
      "wave",
      "start",
      "--project",
      project,
      "--holder",
      "session-a",
      "--kind",
      "module",
      "--target",
      "01",
      "--branch",
      "b",
    );

    const recorded = ledger(
      "record",
      "checkpoint",
      "--project",
      project,
      "--holder",
      "session-a",
      "--wave",
      started.wave,
      "--key",
      "01/sheet2-q3",
      "--question",
      "Sheet says 42.1 W, recompute gives 4.21 W",
      "--answer",
      "Slip: ship 4.21 W, show both",
      "--ruling",
      "slip",
    );
    const known = ledger("checkpoint", "--project", project, "--key", "01/sheet2-q3");
    const unknown = ledger("checkpoint", "--project", project, "--key", "01/sheet2-q4");

    expect(recorded.code).toBe(0);
    expect(known.out.answer).toMatchObject({
      key: "01/sheet2-q3",
      wave: started.wave,
      question: "Sheet says 42.1 W, recompute gives 4.21 W",
      answer: "Slip: ship 4.21 W, show both",
      ruling: "slip",
    });
    expect(unknown.out).toEqual({ ok: true, answer: null });
  });

  test("a new answer to the same item supersedes the old one", () => {
    const { project } = mappedCourse();
    const { out: started } = ledger(
      "wave",
      "start",
      "--project",
      project,
      "--holder",
      "session-a",
      "--kind",
      "module",
      "--target",
      "01",
      "--branch",
      "b",
    );
    const answer = (text: string, ruling: string) =>
      ledger(
        "record",
        "checkpoint",
        "--project",
        project,
        "--holder",
        "session-a",
        "--wave",
        started.wave,
        "--key",
        "01/q3",
        "--question",
        "Which value?",
        "--answer",
        text,
        "--ruling",
        ruling,
      );

    answer("Slip", "slip");
    answer("Divergence after all: the exam uses 42.1", "divergence");

    expect(ledger("checkpoint", "--project", project, "--key", "01/q3").out.answer).toMatchObject({
      ruling: "divergence",
    });
    expect(ledger("status", "--project", project).out.superseded).toEqual([
      expect.objectContaining({ row: "checkpoint", id: "01/q3" }),
    ]);
  });
});

describe("supersede", () => {
  test("a superseded Module stays in the ledger, marked, and its Materials come back to be mapped again", () => {
    const { project } = mappedCourse();

    const result = ledger(
      "supersede",
      "--project",
      project,
      "--holder",
      "session-a",
      "--row",
      "module",
      "--id",
      "02",
      "--reason",
      "Owner merged it into Module 01",
    );
    const { out } = ledger("status", "--project", project);
    const next = ledger("next", "--project", project);

    expect(result.code).toBe(0);
    expect(out.modules.map((m: { id: string }) => m.id)).toEqual(["01"]);
    expect(out.superseded).toEqual([
      expect.objectContaining({ row: "material", id: "L02.pdf", reason: "its Module was superseded" }),
      expect.objectContaining({ row: "module", id: "02", reason: "Owner merged it into Module 01" }),
    ]);
    expect(next.out.newMaterials).toEqual([{ path: "L02.pdf", kind: "pdf" }]);
  });

  test("refuses a row that doesn't exist, and a wave that is still running", () => {
    const { project } = mappedCourse();
    const { out: started } = ledger(
      "wave",
      "start",
      "--project",
      project,
      "--holder",
      "session-a",
      "--kind",
      "module",
      "--target",
      "01",
      "--branch",
      "b",
    );
    const supersede = (row: string, id: string) =>
      ledger("supersede", "--project", project, "--holder", "session-a", "--row", row, "--id", id, "--reason", "r")
        .code;

    expect(supersede("module", "07")).toBe(2);
    expect(supersede("wave", started.wave)).toBe(3);
  });
});

describe("Course overrides", () => {
  test("records each override with the gate gap it works around; retiring one supersedes it", () => {
    const { project } = mappedCourse();
    const override = (gap: string) =>
      ledger(
        "record",
        "override",
        "--project",
        project,
        "--holder",
        "session-a",
        "--path",
        "src/page.astro",
        "--gate-gap",
        gap,
      ).code;

    expect(override("12")).toBe(0);
    expect(ledger("status", "--project", project).out.template.overrides).toEqual([
      { path: "src/page.astro", gateGap: 12, recordedAt: expect.any(String) },
    ]);

    ledger(
      "supersede",
      "--project",
      project,
      "--holder",
      "session-a",
      "--row",
      "override",
      "--id",
      "src/page.astro",
      "--reason",
      "v2.1.0 closes #12",
    );
    const { out } = ledger("status", "--project", project);

    expect(out.template.overrides).toEqual([]);
    expect(out.superseded).toEqual([
      expect.objectContaining({ row: "override", id: "src/page.astro", reason: "v2.1.0 closes #12" }),
    ]);
  });

  test("refuses an override of a file the template layer doesn't have, or without a gate gap issue number", () => {
    const { project } = mappedCourse();
    const override = (path: string, gap: string) =>
      ledger("record", "override", "--project", project, "--holder", "session-a", "--path", path, "--gate-gap", gap)
        .code;

    expect(override("src/nope.astro", "12")).toBe(2);
    expect(override("src/page.astro", "twelve")).toBe(2);
  });
});

describe("template integrity", () => {
  test("passes while the template layer matches the hashes pinned at intake", () => {
    const { project } = mappedCourse();

    expect(ledger("integrity", "--project", project)).toEqual({
      code: 0,
      out: { ok: true, release: "v2.0.0", modified: [], added: [], missing: [] },
    });
  });

  test("fails on any edited, added or removed template-layer file", () => {
    const project = tempDir("project");
    writeFiles(project, { "template/a.ts": "a", "template/b.ts": "b" });
    ledger(
      "init",
      "--project",
      project,
      "--holder",
      "session-a",
      "--release",
      "v2.0.0",
      "--intake",
      jsonInput(intake(tempDir("materials"))),
    );
    writeFiles(project, { "template/a.ts": "a, edited in place", "template/c.ts": "c" });
    rmSync(join(project, "template/b.ts"));

    expect(ledger("integrity", "--project", project)).toEqual({
      code: 1,
      out: { ok: false, release: "v2.0.0", modified: ["a.ts"], added: ["c.ts"], missing: ["b.ts"] },
    });
  });

  test("a local install or build in the template layer is not an edit, but an edit next to it still is", () => {
    const project = tempDir("project");
    writeFiles(project, { "template/a.ts": "a", "template/.gitignore": "node_modules/\n/dist/\n.astro/\n" });
    ledger(
      "init",
      "--project",
      project,
      "--holder",
      "session-a",
      "--release",
      "v2.0.0",
      "--intake",
      jsonInput(intake(tempDir("materials"))),
    );
    writeFiles(project, {
      "template/node_modules/pkg/index.js": "installed",
      "template/dist/index.html": "built",
      "template/.astro/types.d.ts": "generated",
    });

    expect(ledger("integrity", "--project", project).code).toBe(0);

    writeFiles(project, { "template/node_modules.ts": "not an install", "template/.gitignore": "*\n" });

    const { out } = ledger("integrity", "--project", project);
    expect(out.modified).toEqual([".gitignore"]);
    expect(out.added).toContain("node_modules.ts");
  });

  test("git's internals in the template layer are never hashed", () => {
    const project = tempDir("project");
    writeFiles(project, { "template/a.ts": "a", "template/.git/HEAD": "ref: refs/heads/main" });

    ledger(
      "init",
      "--project",
      project,
      "--holder",
      "s",
      "--release",
      "v2.0.0",
      "--intake",
      jsonInput(intake(tempDir("materials"))),
    );

    expect(Object.keys(ledger("status", "--project", project).out.template.files)).toEqual(["a.ts"]);
  });
});

describe("status page and build report", () => {
  test("are regenerated from the ledger on every write, so they are never stale", () => {
    const { project } = mappedCourse();
    const { out: started } = ledger(
      "wave",
      "start",
      "--project",
      project,
      "--holder",
      "session-a",
      "--kind",
      "module",
      "--target",
      "01",
      "--branch",
      "module/01-conduction",
    );
    ledger(
      "record",
      "job",
      "--project",
      project,
      "--holder",
      "session-a",
      "--wave",
      started.wave,
      "--job",
      "recompute",
      "--result",
      "passed",
      "--started-at",
      new Date(Date.now() - 125_000).toISOString(),
    );
    ledger(
      "record",
      "checkpoint",
      "--project",
      project,
      "--holder",
      "session-a",
      "--wave",
      started.wave,
      "--key",
      "01/q3",
      "--question",
      "Sheet 42.1 vs recompute 4.21",
      "--answer",
      "Ship 4.21",
      "--ruling",
      "slip",
    );
    ledger(
      "wave",
      "end",
      "--project",
      project,
      "--holder",
      "session-a",
      "--wave",
      started.wave,
      "--result",
      "merged",
      "--commit",
      COMMIT,
    );

    const statusPage = readFileSync(join(project, "build-records/status.md"), "utf8");
    const report = readFileSync(join(project, "build-records/build-report.md"), "utf8");

    expect(statusPage).toContain("# Heat Transfer: build status");
    expect(statusPage).toContain("| 01 | Conduction | live | 2 |");
    expect(statusPage).toContain("| 02 | Convection | planned | 1 |");
    expect(statusPage).toContain("| midterm | Midterm | 2026-11-10 | open |");
    expect(statusPage).toContain("| 01/q3 | slip | Ship 4.21 |");
    expect(statusPage).toContain("Template release: v2.0.0");
    expect(report).toContain(`## ${started.wave}: module 01, merged`);
    expect(report).toContain(`commit ${COMMIT}`);
    expect(report).toMatch(/\| recompute \| passed \| 2 min 5 s \|/);
  });
});

describe("schema check", () => {
  test("a hand-edited ledger that breaks the schema is refused by every command, naming the field", () => {
    const { project } = mappedCourse();
    const file = join(project, "build-ledger.json");
    const data = JSON.parse(readFileSync(file, "utf8"));
    data.modules[1].state = "done";
    writeFileSync(file, JSON.stringify(data));

    const next = ledger("next", "--project", project);
    const write = ledger(
      "wave",
      "start",
      "--project",
      project,
      "--holder",
      "session-a",
      "--kind",
      "module",
      "--target",
      "01",
      "--branch",
      "b",
    );

    expect(next.code).toBe(2);
    expect(next.out.error).toContain("ledger.modules[1].state");
    expect(write.code).toBe(2);
  });

  test("refuses intake answers that break the schema, writing nothing", () => {
    const project = tempDir("project");

    const init = ledger(
      "init",
      "--project",
      project,
      "--holder",
      "session-a",
      "--release",
      "v2.0.0",
      "--intake",
      jsonInput({ ...intake("/m"), pad: "" }),
    );

    expect(init.code).toBe(2);
    expect(init.out.error).toContain("intake.pad");
    expect(ledger("next", "--project", project).out.action).toBe("intake");
  });
});

describe("edge cases", () => {
  test("a new Course builds Module 01 first even when the map lists another Module first", () => {
    const { project } = newCourse({ "L01.pdf": "l1", "L02.pdf": "l2" });
    ledger(
      "map",
      "--project",
      project,
      "--holder",
      "session-a",
      "--input",
      jsonInput({
        modules: [
          { id: "02", slug: "convection", title: "Convection", materials: ["L02.pdf"] },
          { id: "01", slug: "conduction", title: "Conduction", materials: ["L01.pdf"] },
        ],
        unmapped: [],
      }),
    );

    expect(ledger("next", "--project", project).out.waves).toEqual([
      { kind: "module", target: "01", reasons: ["planned"] },
    ]);
  });

  test("refuses to supersede a Module while its wave is running", () => {
    const { project } = mappedCourse();
    ledger(
      "wave",
      "start",
      "--project",
      project,
      "--holder",
      "session-a",
      "--kind",
      "module",
      "--target",
      "01",
      "--branch",
      "b",
    );

    const { code } = ledger(
      "supersede",
      "--project",
      project,
      "--holder",
      "session-a",
      "--row",
      "module",
      "--id",
      "01",
      "--reason",
      "r",
    );

    expect(code).toBe(3);
  });

  test("a new file mapped into a live Module sends it back for a fresh wave", () => {
    const { project, materials } = liveCourse();
    writeFiles(materials, { "L01b.pdf": "l1b" });

    ledger(
      "map",
      "--project",
      project,
      "--holder",
      "session-a",
      "--input",
      jsonInput({
        modules: [{ id: "01", slug: "conduction", title: "Conduction", materials: ["L01b.pdf"] }],
        unmapped: [],
      }),
    );

    expect(ledger("next", "--project", project).out.waves).toEqual([
      { kind: "module", target: "01", reasons: ["materials-added"] },
    ]);
  });

  test("status reports each Exam sitting with its state", () => {
    const { project } = mappedCourse();

    expect(ledger("status", "--project", project).out.sittings).toEqual([
      { id: "midterm", name: "Midterm", date: "2026-11-10", state: "open" },
    ]);
  });
});

/** The mapped Course with both Modules built and merged. */
function liveCourse() {
  const course = mappedCourse();
  for (const target of ["01", "02"]) {
    const { out } = ledger(
      "wave",
      "start",
      "--project",
      course.project,
      "--holder",
      "session-a",
      "--kind",
      "module",
      "--target",
      target,
      "--branch",
      `module/${target}`,
    );
    ledger(
      "wave",
      "end",
      "--project",
      course.project,
      "--holder",
      "session-a",
      "--wave",
      out.wave,
      "--result",
      "merged",
      "--commit",
      COMMIT,
    );
  }
  return course;
}

/** A Course with two Modules mapped: 01 from L01.pdf and sheet1.jpg, 02 from L02.pdf; syllabus.pdf left out. */
function mappedCourse() {
  const course = newCourse({ "L01.pdf": "l1", "L02.pdf": "l2", "sheet1.jpg": "s1", "syllabus.pdf": "s" });
  const { code, out } = ledger(
    "map",
    "--project",
    course.project,
    "--holder",
    "session-a",
    "--input",
    jsonInput({
      modules: [
        { id: "01", slug: "conduction", title: "Conduction", materials: ["L01.pdf", "sheet1.jpg"] },
        { id: "02", slug: "convection", title: "Convection", materials: ["L02.pdf"] },
      ],
      unmapped: ["syllabus.pdf"],
    }),
  );
  if (code !== 0) throw new Error(`map failed: ${out.error}`);
  return course;
}

/** A Course project with a ledger just made at intake, over a Materials folder holding `materialsFiles`. */
function newCourse(materialsFiles: Record<string, string>) {
  const project = tempDir("project");
  const materials = tempDir("materials");
  writeFiles(materials, materialsFiles);
  writeFiles(project, { "template/src/page.astro": "abc" });
  const { code, out } = ledger(
    "init",
    "--project",
    project,
    "--holder",
    "session-a",
    "--release",
    "v2.0.0",
    "--intake",
    jsonInput(intake(materials)),
  );
  if (code !== 0) throw new Error(`init failed: ${out.error}`);
  return { project, materials };
}

function intake(materialsPath: string) {
  return {
    courseName: "Heat Transfer",
    materialsPath,
    disciplines: ["heat transfer"],
    pad: "graph-green",
    arabicNotes: false,
    sittings: [{ id: "midterm", name: "Midterm", date: "2026-11-10" }],
  };
}
