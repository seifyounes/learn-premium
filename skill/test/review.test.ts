// The fresh reviewer's review (`wave.ts review`) through its command interface, on synthetic Course
// projects and Private folders: the reviewer's findings, the main agent's verdict on each, and the
// screenshots they were made on.
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { privateFolderOf } from "../scripts/intake/create.ts";
import { run as runWave } from "../scripts/wave/cli.ts";
import { fixtureCourse, materialsOf } from "./fixture-courses.ts";
import { writeFiles, type Result } from "./helpers.ts";
import { MEANING_SLIP, review, shots, verdicts, VISUAL } from "./review-fixtures.ts";

const privates: string[] = [];
afterEach(() => {
  for (const dir of privates.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function wave(args: string[]): Result {
  const { code, stdout } = runWave(args);
  return { code, out: JSON.parse(stdout) };
}

function newCourse() {
  const project = fixtureCourse("Heat Transfer", { planned: ["01"] });
  const privateFolder = privateFolderOf(materialsOf(project));
  privates.push(privateFolder);
  return { project, privateFolder };
}

const reviewOf = (project: string) => wave(["review", "--project", project, "--module", "01"]);

/**
 * A rehearsal on the Fixture Course (ticket #70): Module 01's first Summary beat had a meaning slip
 * seeded in it, the gates stay green on it (no number, notation or layout changes), and a fresh
 * reviewer subagent run on its screenshots and a synthetic lecture page (`fixtures/seeded-slip/`)
 * caught it. Its review.json is kept as it wrote it.
 */
const SEEDED = {
  file: "modules/01-thermal-resistance/summary/1.md",
  original: "and the same $\\dot{Q}$ passes through every layer.",
  slip: "and the largest temperature drop falls across the layer with the smallest resistance.",
};
const FIXTURES = join(import.meta.dirname, "fixtures", "seeded-slip");

describe("the seeded meaning slip in Fixture Module 01", () => {
  test("is in the Fixture Module's beat, and the lecture page says the opposite", () => {
    const beat = readFileSync(join(import.meta.dirname, "..", "..", "fixture-course", SEEDED.file), "utf8");
    const lecture = readFileSync(join(FIXTURES, "lecture.html"), "utf8");

    expect(beat).toContain(SEEDED.original);
    expect(lecture).toMatch(/largest temperature drop falls across the layer with the largest\s+resistance/);
  });

  test("the fresh reviewer's adversarial read caught it, and once re-verified on its crop it blocks", () => {
    const { project, privateFolder } = newCourse();
    const caught = JSON.parse(readFileSync(join(FIXTURES, "review.json"), "utf8")) as {
      commit: string;
      findings: { content: string }[];
    };
    shots(privateFolder, caught.commit);
    writeFiles(privateFolder, { "waves/01/review/review.json": JSON.stringify(caught) });

    const found = reviewOf(project);
    const [finding] = found.out.unverified as { key: string; kind: string; content: string; site: string }[];
    writeFiles(privateFolder, { "waves/01/crops/review-slip.png": "png" });
    verdicts(privateFolder, [
      {
        key: finding?.key,
        verdict: "confirmed",
        evidence: "waves/01/crops/review-slip.png",
        fix: "writer",
        reason: "The crop's Key point puts the largest drop across the largest resistance.",
      },
    ]);

    expect(found.code).toBe(1);
    expect(finding).toMatchObject({ kind: "meaning", content: SEEDED.file });
    expect(finding?.site).toMatch(/largest temperature drop.*smallest resistance/);
    expect(reviewOf(project).out.confirmed).toEqual([expect.objectContaining({ content: SEEDED.file, fix: "writer" })]);
  });
});

describe("the fresh reviewer's review", () => {
  test("no review yet is open work", () => {
    const { project } = newCourse();

    const { code, out } = reviewOf(project);

    expect(code).toBe(1);
    expect(out.problems).toEqual([expect.stringMatching(/no review\.json.*fresh reviewer/)]);
  });

  test("every finding waits for the main agent's own re-verification before it can block", () => {
    const { project, privateFolder } = newCourse();
    shots(privateFolder);
    review(privateFolder, [MEANING_SLIP, VISUAL]);

    const { code, out } = reviewOf(project);

    expect(code).toBe(1);
    expect(out.unverified).toEqual([
      expect.objectContaining({ key: expect.stringMatching(/^r-[0-9a-f]{10}$/), kind: "meaning" }),
      expect.objectContaining({ kind: "visual" }),
    ]);
    expect(out.confirmed).toEqual([]);
    expect(out.next).toMatch(/re-verify each finding/);
  });

  test("a confirmed meaning slip blocks, named with the crop it was re-verified on and the job that fixes it", () => {
    const { project, privateFolder } = newCourse();
    shots(privateFolder);
    review(privateFolder, [MEANING_SLIP, VISUAL]);
    const [slip, visual] = reviewOf(project).out.unverified as { key: string }[];
    writeFiles(privateFolder, { "waves/01/crops/review-slip.png": "png" });
    verdicts(privateFolder, [
      {
        key: slip?.key,
        verdict: "confirmed",
        evidence: "waves/01/crops/review-slip.png",
        fix: "writer",
        reason: "The crop says the drop grows with R.",
      },
      { key: visual?.key, verdict: "rejected", evidence: null, fix: null, reason: "The fourth layer is on page 3." },
    ]);

    const { code, out } = reviewOf(project);

    expect(code).toBe(1);
    expect(out.confirmed).toEqual([
      expect.objectContaining({ key: slip?.key, fix: "writer", content: MEANING_SLIP.content }),
    ]);
    expect(out.rejected).toBe(1);
    expect(out.next).toMatch(/record the review job blocked.*fresh reviewer/);
  });

  test("a verdict is refused without its evidence in the Private folder, or a confirmed one without the job that fixes it", () => {
    const { project, privateFolder } = newCourse();
    shots(privateFolder);
    review(privateFolder, [MEANING_SLIP]);
    const [slip] = reviewOf(project).out.unverified as { key: string }[];
    const confirmed = { key: slip?.key, verdict: "confirmed", fix: "writer", reason: "seen" };

    verdicts(privateFolder, [{ ...confirmed, evidence: "waves/01/crops/never-cut.png" }]);
    const noCrop = reviewOf(project);
    writeFiles(privateFolder, { "waves/01/crops/slip.png": "png" });
    verdicts(privateFolder, [{ ...confirmed, evidence: "waves/01/crops/slip.png", fix: null }]);
    const noFix = reviewOf(project);

    expect(noCrop.code).toBe(2);
    expect(noCrop.out.error).toMatch(/never-cut\.png.*isn't in the Private folder/);
    expect(noFix.code).toBe(2);
    expect(noFix.out.error).toMatch(/names no job to fix it/);
  });

  test("findings all rejected with a reason settle the review", () => {
    const { project, privateFolder } = newCourse();
    shots(privateFolder);
    review(privateFolder, [VISUAL]);
    const [visual] = reviewOf(project).out.unverified as { key: string }[];
    verdicts(privateFolder, [
      { key: visual?.key, verdict: "rejected", evidence: null, fix: null, reason: "Page 3 has the fourth layer." },
    ]);

    expect(reviewOf(project)).toMatchObject({ code: 0, out: { ok: true, confirmed: [], unverified: [], rejected: 1 } });
  });

  test("a verdict stands only for the finding it was made on: a reworded finding is re-verified", () => {
    const { project, privateFolder } = newCourse();
    shots(privateFolder);
    review(privateFolder, [VISUAL]);
    const [visual] = reviewOf(project).out.unverified as { key: string }[];
    verdicts(privateFolder, [{ key: visual?.key, verdict: "rejected", evidence: null, fix: null, reason: "no" }]);
    review(privateFolder, [{ ...VISUAL, site: "The wall figure draws two layers." }]);

    const { code, out } = reviewOf(project);

    expect(code).toBe(1);
    expect(out.unverified).toHaveLength(1);
  });

  test("a review is made on the phone and laptop screenshots of the commit it reviewed (negative controls)", () => {
    const { project, privateFolder } = newCourse();
    review(privateFolder, []);
    const none = reviewOf(project);
    shots(privateFolder, "f".repeat(40));
    const otherCommit = reviewOf(project);
    shots(privateFolder);
    rmSync(`${privateFolder}/waves/01/review/shots/laptop.png`);
    const noLaptop = reviewOf(project);

    expect(none.out.problems).toEqual([expect.stringMatching(/no screenshots/)]);
    expect(otherCommit.out.problems).toEqual([expect.stringMatching(/screenshots are of f{40}, not .*reviewed/)]);
    expect(noLaptop.out.problems).toEqual([expect.stringMatching(/no laptop screenshot/)]);
  });

  test("a meaning finding names the content and the Materials region; a visual one its screenshot", () => {
    const { project, privateFolder } = newCourse();
    shots(privateFolder);
    review(privateFolder, [{ ...MEANING_SLIP, materials: null }]);
    const noMaterials = reviewOf(project);
    review(privateFolder, [{ ...VISUAL, screenshot: null }]);
    const noScreenshot = reviewOf(project);

    expect(noMaterials.code).toBe(2);
    expect(noMaterials.out.error).toMatch(/meaning finding.*Materials/);
    expect(noScreenshot.code).toBe(2);
    expect(noScreenshot.out.error).toMatch(/visual finding.*screenshot/);
  });
});
