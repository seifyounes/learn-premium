// An empty Course project, as intake creates it (a course config and an empty modules/ folder):
// its deploy run is green, each content gate saying it had nothing to check. Once one Module
// exists, every gate applies again: a defect planted in that Module blocks.
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GATES } from "../gates/index.ts";
import { runGates, type GateInput } from "../gates/runner.ts";
import { teachingMethod } from "../gates/teaching.ts";
import { buildCourse, FIXTURE_COURSE } from "./build-course";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";

/** The course config `intake create` writes (skill/scripts/intake/scaffold.ts): no sitting until a Module is mapped. */
const INTAKE_COURSE_CONFIG = `name: "Heat Transfer"
code: "MEP 321"
pad: "green"
credit:
  professor: "A. N. Example"
  course: "Heat Transfer (MEP 321)"
  university: "Example University"
owner: "A. N. Owner"
sittings: []
`;

/** The per-job gates: the ones that read the Course's content. */
const CONTENT_GATES = [
  "content-contract",
  "katex",
  "notation",
  "teaching-method",
  "provenance",
  "master-rules",
  "worked-numbers",
  "sim-numbers",
  "truth-table",
  "stl",
  "scl",
  "pinned-definitions",
  "drawing",
  "part-checks",
  "tools",
];

function emptyCourse(): string {
  const dir = mkdtempSync(join(tmpdir(), "lp-empty-course-"));
  writeFileSync(join(dir, "course.yaml"), INTAKE_COURSE_CONFIG);
  mkdirSync(join(dir, "modules"));
  writeFileSync(join(dir, "modules", ".gitkeep"), "");
  return dir;
}

describe("an empty Course project's deploy run", () => {
  const contentDir = emptyCourse();
  const build = buildCourse(contentDir, { VERCEL_ENV: "production" });
  const input: GateInput = { contentDir, distDir: build.outDir };

  it("builds", () => {
    expect(build.ok, build.output).toBe(true);
  });

  it("is green, and the Gate report says each content gate with nothing to read had nothing to check", async () => {
    const report = await runGates({ point: "deploy", commit: COMMIT, input, gates: GATES });
    const failing = report.gates.filter((g) => g.status !== "pass");
    expect(failing, JSON.stringify(failing, null, 2)).toEqual([]);
    expect(report.green).toBe(true);
    expect(report.gates.map((g) => g.id)).toEqual(expect.arrayContaining(CONTENT_GATES));
    const nothingToCheck = report.gates.filter((g) => g.nothingToCheck !== undefined).map((g) => g.id);
    // The content contract and KaTeX still read the course config; every other content gate has nothing.
    expect(nothingToCheck).toEqual(CONTENT_GATES.filter((id) => id !== "content-contract" && id !== "katex"));
    for (const id of nothingToCheck) {
      expect(report.gates.find((g) => g.id === id)?.nothingToCheck).toBe("the Course has no Modules yet");
    }
  });
});

describe("a Course with its first Module", () => {
  const contentDir = emptyCourse();
  cpSync(
    join(FIXTURE_COURSE, "modules", "01-thermal-resistance"),
    join(contentDir, "modules", "01-thermal-resistance"),
    {
      recursive: true,
    },
  );
  const input: GateInput = { contentDir };
  const teaching = (given: GateInput) =>
    runGates({ point: "deploy", commit: COMMIT, input: given, gates: [teachingMethod] });

  it("passes the teaching-method gate on the Module as it stands", async () => {
    const report = await teaching(input);
    expect(report.gates[0]).toMatchObject({ status: "pass" });
    expect(report.gates[0]).not.toHaveProperty("nothingToCheck");
  });

  it("blocks on a defect planted in that Module (negative control)", async () => {
    const control = teachingMethod.controls[0];
    if (!control) throw new Error("the teaching-method gate has no negative control");
    const broken = control.plant(input, mkdtempSync(join(tmpdir(), "lp-first-module-")));
    const report = await teaching(broken);
    expect(report.green).toBe(false);
    expect(report.gates[0]?.status).toBe("block");
  });

  it("no longer passes a content gate that covers nothing", async () => {
    const report = await runGates({
      point: "deploy",
      commit: COMMIT,
      input,
      gates: GATES.filter((g) => g.points.includes("job")),
    });
    expect(report.gates.filter((g) => g.nothingToCheck !== undefined)).toEqual([]);
  });
});
