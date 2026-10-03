import { describe, expect, it } from "vitest";
import { contentContract } from "../gates/content.ts";
import { course } from "../src/content/contract.ts";
import { fixtureWith } from "./build-course";

const base = {
  name: "C",
  code: "C 1",
  pad: "green",
  owner: "O",
  credit: { professor: "P", course: "C", university: "U" },
};

describe("an Exam sitting in course.yaml", () => {
  it("covers each Module once", () => {
    const parsed = course.safeParse({
      ...base,
      sittings: [{ id: "final", name: "Final", modules: ["01-a", "02-b", "01-a"] }],
    });
    expect(parsed.error?.issues.map((i) => [i.path.join("."), i.message])).toEqual([
      ["sittings.0.modules.2", '"01-a" is listed twice'],
    ]);
  });

  it("blocks in the content gate when it covers a Module folder with no module.yaml, as the build does", async () => {
    const withFolder = fixtureWith(
      "modules/03-empty/summary/1.md",
      () => "---\ntitle: Only a beat\n---\n\nNo module.yaml.\n",
    );
    const contentDir = fixtureWith(
      "course.yaml",
      (s) => s.replace("modules: [01-thermal-resistance]", "modules: [01-thermal-resistance, 03-empty]"),
      withFolder,
    );
    const run = await contentContract.run({ contentDir });
    expect(run.findings.map((f) => f.message)).toContain(
      'sittings.0: sitting "midterm" covers 03-empty, which the Course has no Module for',
    );
  });
});
