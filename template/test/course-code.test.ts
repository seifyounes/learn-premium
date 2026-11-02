// The Course code is optional (the Owner may want none shown): a config without one builds, and
// its home page title block has no Code cell, the Course cell and the counts filling the row.
import { describe, expect, it } from "vitest";
import { course } from "../src/content/contract.ts";
import { buildCourse, fixtureWith } from "./build-course";

const base = {
  name: "C",
  pad: "green",
  owner: "O",
  credit: { professor: "P", course: "C", university: "U" },
};

describe("the Course code in course.yaml", () => {
  it("is optional, but never empty", () => {
    expect(course.parse(base).code).toBeUndefined();
    expect(course.safeParse({ ...base, code: "" }).success).toBe(false);
  });

  it("left out, the home page shows no Code cell, and the title block drops its column", { timeout: 300_000 }, () => {
    const content = fixtureWith("course.yaml", (yaml) =>
      yaml.replace(/^code: .*\n/m, "").replace("course: Fixture Course (FX 101)", "course: Fixture Course"),
    );
    const build = buildCourse(content);
    expect(build.ok, build.output).toBe(true);

    const home = build.page("");
    expect(home).not.toContain('<span class="field-label">Code</span>');
    expect(home).not.toContain("FX 101");
    expect(home).toContain("pad:grid-cols-[2.6fr_repeat(4,1fr)]");
  });
});
