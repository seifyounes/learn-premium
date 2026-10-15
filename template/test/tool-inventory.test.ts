// The Module's Worked examples and tools as JSON (`gates/inventory.ts`): what the Module wave's merge
// gate holds the tool assignment to. The skill keeps Module 03's inventory as a fixture
// (`skill/test/fixtures/tool-inventory/`); this suite holds that fixture to the Fixture Course.
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { toolInventory } from "../gates/inventory.ts";
import { FIXTURE_COURSE } from "./build-course";

const MODULE = "03-gradient-descent";
const TEMPLATE = resolve(import.meta.dirname, "..");
const SKILL_FIXTURE = resolve(TEMPLATE, "../skill/test/fixtures/tool-inventory", `${MODULE}.json`);

/** `gates/cli.ts tools …` as the Module wave runs it. */
const cli = (args: string[]) =>
  spawnSync(process.execPath, ["gates/cli.ts", "tools", ...args], { cwd: TEMPLATE, encoding: "utf8" });

/** A scratch copy of the Fixture Course with `files` (path in the content folder → text) added. */
function scratchCourse(files: Record<string, string>): string {
  const course = join(mkdtempSync(join(tmpdir(), "lp-inventory-")), "course");
  cpSync(FIXTURE_COURSE, course, { recursive: true });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(course, path)), { recursive: true });
    writeFileSync(join(course, path), text);
  }
  return course;
}

describe("a Module's tool inventory", () => {
  it("lists Fixture Module 03's Worked examples and tools as the skill's fixture holds them", () => {
    const inventory = toolInventory({ contentDir: FIXTURE_COURSE, module: MODULE });
    expect(inventory).toEqual(JSON.parse(readFileSync(SKILL_FIXTURE, "utf8")));
    // The live sim and the Pyodide tool sit in W03.1; the step-through sim is Lab only.
    expect(inventory.tools.map((t) => [t.name, t.worked, t.live])).toEqual([
      ["descent", "1", true],
      ["descent-steps", null, false],
      ["normal-equation", "1", true],
    ]);
  });

  it("classifies Module 01's Worked examples by their figure", () => {
    const { worked } = toolInventory({ contentDir: FIXTURE_COURSE, module: "01-thermal-resistance" });
    // W01.1's steps add and ring elements of its figure; W01.2 has no figure.
    expect(worked.map((w) => [w.n, w.figure])).toEqual([
      ["1", "animated"],
      ["2", "none"],
    ]);
    const source = JSON.parse(readFileSync(join(FIXTURE_COURSE, worked[1]?.entry ?? ""), "utf8")) as {
      figure?: unknown;
    };
    expect(source.figure).toBeUndefined();
  });

  it("reads a Module that has no tool or Worked example as empty", () => {
    expect(toolInventory({ contentDir: FIXTURE_COURSE, module: "02-convection" })).toMatchObject({
      worked: expect.any(Array),
      tools: [],
      problems: [],
    });
  });

  it("is printed as JSON by the gate CLI, for the Module wave", () => {
    const run = cli(["--module", MODULE, "--content", FIXTURE_COURSE]);
    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual(toolInventory({ contentDir: FIXTURE_COURSE, module: MODULE }));
  });

  it("needs a Module (negative control)", () => {
    const run = cli(["--content", FIXTURE_COURSE]);
    expect(run.status).toBe(2);
    expect(run.stderr).toMatch(/tools needs --module/);
  });

  it("lists a sim the contract can't read in `problems`, not among the tools (negative control)", () => {
    const course = scratchCourse({
      [`modules/${MODULE}/sims/x.json`]: JSON.stringify({ kind: "bogus", title: "x" }),
    });
    const inventory = toolInventory({ contentDir: course, module: MODULE });
    expect(inventory.problems).toHaveLength(1);
    expect(inventory.problems[0]).toMatch(/^modules\/03-gradient-descent\/sims\/x\.json: can't check the sim/);
    expect(inventory.tools.map((t) => t.name)).toEqual(["descent", "descent-steps", "normal-equation"]);
  });

  it("lists a Worked example and a Pyodide tool the contract can't read in `problems` (negative control)", () => {
    const course = scratchCourse({
      [`modules/${MODULE}/worked/2.json`]: JSON.stringify({ code: "W03.2" }),
      [`modules/${MODULE}/python/broken.yaml`]: "title: only a title\n",
    });
    const { problems, worked, tools } = toolInventory({ contentDir: course, module: MODULE });
    expect(problems.map((p) => p.split(":")[0]).sort()).toEqual([
      `modules/${MODULE}/python/broken.yaml`,
      `modules/${MODULE}/worked/2.json`,
    ]);
    expect(worked.map((w) => w.n)).toEqual(["1"]);
    expect(tools).toHaveLength(3);
  });
});
