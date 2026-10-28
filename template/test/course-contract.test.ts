import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
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

describe("the Disciplines in course.yaml", () => {
  // The course config exactly as the skill's intake writes it for a Course that added a Discipline.
  const FIXTURE = resolve(import.meta.dirname, "../../skill/test/fixtures/course-config/automation.yaml");
  const written = readFileSync(FIXTURE, "utf8");
  const links = "PhET and Falstad appear only as credited links, never as a tool";

  it("reads the config intake writes: a listed Discipline by name, an added one with its Toolkit and ready-made pick", () => {
    const parsed = course.parse(parse(written));

    expect(parsed.disciplines.map((d) => d.name)).toEqual(["Automation and control", "Electric machines"]);
    expect(parsed.disciplines[1]?.nearest).toBe("Electric circuits");
    expect(parsed.disciplines[1]?.toolkit?.["motor starting sequence"]).toEqual(["ladder"]);
    expect(parsed.disciplines[1]?.toolkit?.["torque-speed curve"]).toEqual([]);
    expect(parsed.disciplines[1]?.readyMade).toEqual({ "motor starting sequence": "Motor Lab" });
  });

  it("is optional: a config that lists none reads as listing none", () => {
    expect(course.parse(base).disciplines).toEqual([]);
  });

  it("a Toolkit never names PhET or Falstad as a tool", () => {
    const asTool = course.safeParse(parse(written.replace('["ladder"]', '["phet"]')));
    const asReadyMade = course.safeParse(parse(written.replace('"Motor Lab"', '"Falstad EM"')));

    expect(asTool.error?.issues.map((i) => i.message)).toEqual([expect.stringContaining(links)]);
    expect(asReadyMade.error?.issues.map((i) => i.message)).toEqual([expect.stringContaining(links)]);
  });

  it("a Toolkit names only tools the template ships, and a ready-made pick only an interaction of its Toolkit", () => {
    const unknown = course.safeParse(parse(written.replace('["ladder"]', '["circuitjs"]')));
    const stray = course.safeParse(
      parse(written.replace('"readyMade":{"motor starting sequence"', '"readyMade":{"ghost"')),
    );

    expect(unknown.error?.issues.map((i) => i.message)).toEqual([
      expect.stringContaining("isn't a tool this template ships"),
    ]);
    expect(stray.error?.issues.map((i) => i.message)).toEqual([
      expect.stringContaining('"ghost" isn\'t an interaction'),
    ]);
  });

  it("blocks in the content gate, as the build does", async () => {
    const contentDir = fixtureWith(
      "course.yaml",
      (s) => `${s}disciplines:\n  - {"name":"X","toolkit":{"fields":["phet"]}}\n`,
    );

    const run = await contentContract.run({ contentDir });

    expect(run.findings.map((f) => f.message).join("\n")).toContain(links);
  });
});

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
