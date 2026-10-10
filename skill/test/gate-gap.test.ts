// Gate gaps: a defect class no gate caught, recorded in the Build ledger, filed on learn-premium's
// tracker (a fake one here: no test ever files a real issue) with a synthetic minimal broken fixture,
// the affected Course and its Course overrides. A Course can't be marked done while one is unfiled.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { run as runGateGap, type Deps } from "../scripts/gate-gap/cli.ts";
import { overridesOnIssue } from "../scripts/release/notes.ts";
import { FakeTracker } from "./fake-tracker.ts";
import { jsonInput, ledger, tempDir, writeFiles, type Result } from "./helpers.ts";

const HOLDER = "run-1";
const OVERRIDE = "src/components/Footer.astro";
const FIXTURE_CASE = '{ "beat": "a beat of 140 words", "limit": 90 }\n';

async function gateGap(deps: Partial<Deps>, ...args: string[]): Promise<Result> {
  const { code, stdout } = await runGateGap(args, deps);
  return { code, out: JSON.parse(stdout) };
}

/** A Course project at intake, its Materials folder and the Private folder beside it. */
function course() {
  const root = tempDir("course");
  const project = join(root, "heat-transfer");
  const materials = join(root, "Materials");
  const privateFolder = join(root, "Materials-private");
  writeFiles(materials, { "L01.pdf": "lecture one, the Professor's own" });
  writeFiles(privateFolder, { "transcripts/L01.txt": "the Professor said this in lecture one" });
  writeFiles(project, { [`template/${OVERRIDE}`]: "<footer>template</footer>", "template/gates/cli.ts": "gates" });
  const init = ledger(
    "init",
    "--project",
    project,
    "--holder",
    HOLDER,
    "--release",
    "v2.0.0",
    "--intake",
    jsonInput({
      courseName: "Heat Transfer",
      materialsPath: materials,
      disciplines: ["heat transfer"],
      pad: "graph-green",
      arabicNotes: false,
      sittings: [],
    }),
  );
  if (init.code !== 0) throw new Error(`init failed: ${init.out.error}`);
  return { project, materials, privateFolder };
}

/** Writes a gate gap's fixture and the override it declares, and records the gate gap. */
function recordGap(
  project: string,
  id = "beat-limit",
  fixture: Record<string, string> = { "case.json": FIXTURE_CASE },
) {
  writeFiles(project, {
    ...Object.fromEntries(
      Object.entries(fixture).map(([name, text]) => [`build-records/gate-gaps/${id}/${name}`, text]),
    ),
    [`overrides/${OVERRIDE}`]: "<footer>fixed</footer>",
  });
  return ledger(
    "record",
    "gate-gap",
    "--project",
    project,
    "--holder",
    HOLDER,
    "--id",
    id,
    "--title",
    "Summary beat over 90 words not caught",
    "--defect",
    "A Summary beat of 140 words shipped; the teaching-method gate counted only the first paragraph.",
    "--override",
    OVERRIDE,
  );
}

const done = (project: string, holder = HOLDER) => ledger("done", "--project", project, "--holder", holder);

describe("filing a gate gap", () => {
  test("an unfiled gate gap refuses Course done; filed, it carries the label, fixture, Course and override", async () => {
    const { project } = course();
    const tracker = new FakeTracker();

    expect(recordGap(project).code).toBe(0);
    const refused = done(project);
    expect(refused.code).toBe(3);
    expect(refused.out.error).toContain("beat-limit");

    const filed = await gateGap({ tracker }, "file", "--project", project, "--holder", HOLDER, "--id", "beat-limit");
    expect(filed.code, filed.out.error).toBe(0);
    expect(filed.out).toMatchObject({ issue: 1, url: tracker.issues[0]?.url });

    const [issue] = tracker.issues;
    expect(issue?.labels).toEqual(["gate-gap"]);
    expect(issue?.title).toBe("Summary beat over 90 words not caught");
    expect(issue?.body).toContain(FIXTURE_CASE.trim());
    expect(issue?.body).toContain("the teaching-method gate counted only the first paragraph");
    // The shape the release notes read (docs/release.md): its Course and each override on a line of its own.
    expect(overridesOnIssue(issue?.body ?? null)).toEqual({ course: "Heat Transfer", overrides: [OVERRIDE] });

    const { out } = ledger("status", "--project", project);
    expect(out.template.overrides).toEqual([{ path: OVERRIDE, gateGap: 1, recordedAt: expect.any(String) }]);
    expect(out.gateGaps).toEqual([
      expect.objectContaining({ id: "beat-limit", issue: 1, overrides: [OVERRIDE], filedAt: expect.any(String) }),
    ]);

    expect(done(project).code).toBe(0);
    expect(ledger("status", "--project", project).out.done).toMatchObject({ holder: HOLDER });
    const page = readFileSync(join(project, "build-records", "status.md"), "utf8");
    expect(page).toContain("| beat-limit | Summary beat over 90 words not caught | seifyounes/learn-premium#1 |");
    expect(page).toContain(`| ${OVERRIDE} | seifyounes/learn-premium#1 |`);
    expect(page).toContain("The Course build was marked done");
  });
});

const file = (tracker: FakeTracker, project: string, holder = HOLDER) =>
  gateGap({ tracker }, "file", "--project", project, "--holder", holder, "--id", "beat-limit");

describe("a gate gap's fixture is synthetic: nothing from the Materials or the Private folder is filed", () => {
  test("a fixture file that is a Materials file is refused before GitHub is asked anything", async () => {
    const { project, materials } = course();
    const tracker = new FakeTracker();
    recordGap(project, "beat-limit", { "case.json": FIXTURE_CASE, "L01.pdf": "lecture one, the Professor's own" });

    const filed = await file(tracker, project);

    expect(filed.code).toBe(3);
    expect(filed.out.error).toMatch(/L01\.pdf is a Materials file/);
    expect(tracker.issues).toEqual([]);
    expect(done(project).code).toBe(3);

    // Still refused once the file has changed in the Materials folder: the ledger inventoried the old one.
    ledger(
      "map",
      "--project",
      project,
      "--holder",
      HOLDER,
      "--input",
      jsonInput({ modules: [], unmapped: ["L01.pdf"] }),
    );
    writeFiles(materials, { "L01.pdf": "revised" });
    expect((await file(tracker, project)).out.error).toMatch(/L01\.pdf is a Materials file/);
    expect(tracker.issues).toEqual([]);
  });

  test("a fixture file copied from the Private folder (evidence) is refused", async () => {
    const { project } = course();
    const tracker = new FakeTracker();
    recordGap(project, "beat-limit", { "transcript.txt": "the Professor said this in lecture one" });

    const filed = await file(tracker, project);

    expect(filed.code).toBe(3);
    expect(filed.out.error).toMatch(/transcript\.txt is a Private-folder file/);
    expect(tracker.issues).toEqual([]);
  });

  test("a binary fixture file, or one the release notes would misread, is refused", async () => {
    const { project } = course();
    const tracker = new FakeTracker();

    recordGap(project, "beat-limit", { "crop.png": "\u0000PNG" });
    expect((await file(tracker, project)).out.error).toMatch(/crop\.png isn't text/);

    recordGap(project, "beat-limit", { "crop.png": "", "notes.md": "Course override: src/pages/index.astro\n" });
    expect((await file(tracker, project)).out.error).toMatch(/notes\.md has a "Course:" or "Course override:" line/);
    expect(tracker.issues).toEqual([]);
  });

  test("a gate gap can't be recorded without its fixture", () => {
    const { project } = course();

    const recorded = ledger(
      "record",
      "gate-gap",
      "--project",
      project,
      "--holder",
      HOLDER,
      "--id",
      "no-fixture",
      "--title",
      "t",
      "--defect",
      "d",
    );

    expect(recorded.code).toBe(2);
    expect(recorded.out.error).toContain("build-records/gate-gaps/no-fixture/");
  });
});

describe("filing is safe to run again", () => {
  test("a filing that lost GitHub's answer finds its issue on the next run instead of opening a second", async () => {
    const { project } = course();
    const tracker = new FakeTracker();
    recordGap(project);
    tracker.dropAfterCreate = true;

    expect((await file(tracker, project)).code).toBe(3);
    expect(done(project).code).toBe(3);

    expect((await file(tracker, project)).out).toMatchObject({ ok: true, issue: 1, alreadyFiled: false });
    expect(tracker.issues).toHaveLength(1);
    expect((await file(tracker, project)).out).toMatchObject({ ok: true, issue: 1, alreadyFiled: true });
    expect(tracker.issues).toHaveLength(1);
  });

  test("only the session holding the ledger lock files, and a filed gate gap can't be recorded over", async () => {
    const { project } = course();
    const tracker = new FakeTracker();
    recordGap(project);

    expect((await file(tracker, project, "run-2")).code).toBe(3);
    expect(tracker.issues).toEqual([]);

    expect((await file(tracker, project)).code).toBe(0);
    expect(recordGap(project).code).toBe(3);
  });
});

describe("Course done", () => {
  test("a gate gap recorded after the Course was marked done undoes it until that gap is filed", async () => {
    const { project } = course();
    expect(done(project).code).toBe(0);

    recordGap(project);
    expect(ledger("status", "--project", project).out.done).toBeNull();
    expect(done(project).out.error).toContain("beat-limit");

    await file(new FakeTracker(), project);
    expect(done(project).code).toBe(0);
  });

  test("a gate gap recorded in error is superseded, not left holding Course done forever", () => {
    const { project } = course();
    recordGap(project);
    expect(done(project).code).toBe(3);

    const superseded = ledger(
      ...["supersede", "--project", project, "--holder", HOLDER, "--row", "gate-gap", "--id", "beat-limit"],
      ...["--reason", "recorded in error: a gate caught it"],
    );

    expect(superseded.code).toBe(0);
    expect(ledger("status", "--project", project).out.gateGaps).toEqual([]);
    expect(done(project).code).toBe(0);
  });

  test("only the lock holder marks it done", () => {
    const { project } = course();

    expect(done(project, "run-2").code).toBe(3);
  });
});
