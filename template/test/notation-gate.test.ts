import { rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { notationGate } from "../gates/notation.ts";
import { runControls } from "../gates/runner.ts";
import { FIXTURE_COURSE, fixtureWith } from "./build-course";

const MODULE = "01-thermal-resistance";
const WORKED = `modules/${MODULE}/worked/1.json`;
const run = (contentDir: string, module: string | undefined = MODULE) =>
  notationGate.run({ contentDir, ...(module === undefined ? {} : { module }) });

describe("the notation lint", () => {
  it("passes the Fixture Course, which writes its style sheet's notation", async () => {
    const result = await run(FIXTURE_COURSE);
    expect(result.findings).toEqual([]);
    expect(result.coverage.styleSheetRules).toBeGreaterThan(0);
    expect(result.coverage.entries).toBe(10);
  });

  it("blocks a variant the style sheet's machine-readable part says not to write, naming the field", async () => {
    // The Fixture style sheet writes the heat rate \dot{Q} and never \dot{q}.
    const course = fixtureWith(WORKED, (s) =>
      s.replace("Find the heat loss $\\\\dot{Q}$", "Find the heat loss $\\\\dot{q}$"),
    );
    const result = await run(course);
    expect(result.findings).toEqual([
      {
        outcome: "block",
        at: `${WORKED} (statement)`,
        message: "writes \\dot{q} for the heat rate; the Course style sheet writes \\dot{Q}",
      },
    ]);
  });

  it("reads a TeX variant as a whole command, never inside a longer one", async () => {
    // `R_{th}` is off-notation for the thermal resistance; `\quad` and `R_{total}` are not it.
    const course = fixtureWith(`modules/${MODULE}/summary/9.md`, () =>
      ["---", "title: Planted", "---", "", "A wall $R_{total} \\quad R$ and $R_{th}$ here.", ""].join("\n"),
    );
    const result = await run(course);
    expect(result.findings.map((f) => f.message)).toEqual([
      "writes R_{th} for the thermal resistance; the Course style sheet writes R",
    ]);
    expect(result.findings[0]?.at).toBe(`modules/${MODULE}/summary/9.md (body)`);
  });

  it("blocks a unit written the way the style sheet says not to, in text as in math", async () => {
    const course = fixtureWith(`modules/${MODULE}/practice/9.yaml`, () =>
      [
        "kind: numeric",
        "question: 'Planted: a slab of conductivity 0.5 W/mK. Find nothing.'",
        "answer: { value: 1, unit: K, tolerance: 0 }",
        "model: One.",
        "",
      ].join("\n"),
    );
    const result = await run(course);
    expect(result.findings.map((f) => f.message)).toEqual([
      "writes the unit W/mK; the Course style sheet writes W/(m·K)",
    ]);
  });

  it("blocks a Course with no style sheet: Module 1's wave writes it before any other Module is written", async () => {
    const course = fixtureWith("course.yaml", (s) => s);
    rmSync(join(course, "style-sheet.yaml"));
    const result = await run(course);
    expect(result.findings).toEqual([
      expect.objectContaining({
        outcome: "block",
        at: "style-sheet.yaml",
        message: expect.stringMatching(/no Course style sheet/),
      }),
    ]);
  });

  it("blocks a style sheet that breaks its contract, naming the field", async () => {
    const course = fixtureWith("style-sheet.yaml", (s) => s.replace(/^notation:/m, "notations:"));
    const result = await run(course);
    expect(result.findings[0]).toMatchObject({ outcome: "block", at: "style-sheet.yaml" });
    expect(result.findings.map((f) => f.message).join("\n")).toMatch(/notation/);
  });

  it("catches every one of its negative controls", async () => {
    const result = await runControls({ input: { contentDir: FIXTURE_COURSE, module: MODULE }, gates: [notationGate] });
    expect(result.ok, JSON.stringify(result, null, 2)).toBe(true);
    expect(result.gates[0]?.controls.length).toBeGreaterThanOrEqual(3);
  });
});
