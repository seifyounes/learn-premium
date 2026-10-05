import { describe, expect, it } from "vitest";
import { plantedExample, teachingMethod } from "../gates/teaching.ts";
import { beatWords } from "../src/content/summary.ts";
import { FIXTURE_COURSE, fixtureWith } from "./build-course";

const MODULE = "01-thermal-resistance";
const WORKED = `modules/${MODULE}/worked/1.json`;

/** The teaching-method gate on a copy of the Fixture Course with its Worked example edited. */
async function withExample(edit: (example: Record<string, unknown>) => void) {
  const course = fixtureWith(WORKED, (source) => {
    const example = JSON.parse(source) as Record<string, unknown>;
    edit(example);
    return JSON.stringify(example);
  });
  return teachingMethod.run({ contentDir: course, module: MODULE });
}
const messages = (run: Awaited<ReturnType<typeof withExample>>) => run.findings.map((f) => f.message);

// The Fixture Course's example has six steps; its last draws onto the figure.
type Step = { fill?: string[]; marks?: string[]; figure: { add?: string[]; ring?: string[] } };
const steps = (example: Record<string, unknown>) => example.steps as [Step, Step, Step, Step, Step, Step];

describe("the teaching-method gate", () => {
  it("passes the Fixture Course's Worked example, reporting what it covered", async () => {
    const run = await teachingMethod.run({ contentDir: FIXTURE_COURSE, module: MODULE });
    expect(run.findings).toEqual([]);
    expect(run.coverage).toEqual({ examples: 2, steps: 11, beats: 1 });
  });

  it("passes its own planted example before a control breaks it", async () => {
    const course = fixtureWith(WORKED, () => JSON.stringify(plantedExample()));
    const run = await teachingMethod.run({ contentDir: course, module: MODULE });
    expect(run.findings).toEqual([]);
  });

  it("blocks an example that declares no artefact, naming the file", async () => {
    const run = await withExample((e) => {
      delete e.artefact;
    });
    expect(run.findings).toEqual([
      { outcome: "block", at: WORKED, message: expect.stringMatching(/declares no solving artefact/) },
    ]);
  });

  it("blocks an artefact kind this template doesn't ship", async () => {
    const run = await withExample((e) => {
      (e.artefact as { kind: string }).kind = "tree";
    });
    expect(messages(run)).toEqual([expect.stringMatching(/"tree" artefact, which this template doesn't ship/)]);
  });

  it("blocks a missing fill order", async () => {
    const run = await withExample((e) => {
      delete e.fillOrder;
    });
    expect(messages(run)).toEqual([expect.stringMatching(/declares no fill order/)]);
  });

  it("blocks a worked-out cell no step fills, or one filled twice", async () => {
    const run = await withExample((e) => {
      steps(e)[2].fill = ["D2", "D1"];
    });
    expect(messages(run)).toEqual([
      "D1 is filled at steps 2 and 3: each value is written once",
      "D3 is never filled: no step writes it",
    ]);
  });

  it("blocks a step that fills a given cell or a blank one", async () => {
    const run = await withExample((e) => {
      steps(e)[1].fill = ["D1", "B1", "B4"];
    });
    expect(messages(run)).toEqual([
      "step 2 fills B1, which is given with the question",
      "step 2 fills B4, which is blank on the Professor's sheet",
    ]);
  });

  it("blocks a red-pen mark on a value not yet written", async () => {
    const run = await withExample((e) => {
      steps(e)[1].marks = ["D4"];
    });
    expect(messages(run)).toEqual(["step 2 rings D4 before its value is written"]);
  });

  it("blocks a first step that draws onto the question figure", async () => {
    const run = await withExample((e) => {
      steps(e)[0].figure = { add: ["profile"] };
      steps(e)[5].figure.add = ["t2", "t3"];
    });
    expect(messages(run)).toEqual([
      'step 1 draws "profile" onto the question figure: the first step shows the figure as the question sets it',
    ]);
  });

  it("blocks a figure with no question figure, and elements never drawn", async () => {
    const run = await withExample((e) => {
      (e.figure as { question: string[] }).question = [];
    });
    expect(messages(run)).toEqual([
      "the figure declares no question figure: list the elements the question shows (figure.question)",
      'step 6 rings "t4" before it is drawn',
      'figure element "inside-face" is never drawn',
      'figure element "plaster-brick" is never drawn',
      'figure element "brick-insulation" is never drawn',
      'figure element "outside-face" is never drawn',
      'figure element "t1" is never drawn',
      'figure element "t4" is never drawn',
    ]);
  });

  it("blocks an element drawn twice", async () => {
    const run = await withExample((e) => {
      steps(e)[5].figure.add = ["t2", "t3", "profile", "t1"];
    });
    expect(messages(run)).toEqual(['step 6 draws "t1", which is already on the figure']);
  });
});

describe("the teaching-method gate on Summary beats", () => {
  const beat = (words: number) =>
    `---\ntitle: A planted beat\n---\n\n${Array.from({ length: words }, (_, i) => (i % 9 === 4 ? "$R_i$" : "word")).join(" ")}\n`;
  const withBeats = (beats: Record<string, string>) => {
    let course = FIXTURE_COURSE;
    for (const [file, text] of Object.entries(beats))
      course = fixtureWith(`modules/${MODULE}/summary/${file}`, () => text, course);
    return teachingMethod.run({ contentDir: course, module: MODULE });
  };

  it("counts the Module's beats", async () => {
    const run = await teachingMethod.run({ contentDir: FIXTURE_COURSE, module: MODULE });
    expect(run.coverage).toMatchObject({ beats: 1 });
  });

  it("passes five beats of 90 words, formulas counting one word each", async () => {
    const run = await withBeats({ "2.md": beat(90), "3.md": beat(10), "4.md": beat(10), "5.md": beat(10) });
    expect(run.findings).toEqual([]);
    expect(run.coverage).toMatchObject({ beats: 5 });
  });

  it("blocks a sixth beat, naming the Module's Summary", async () => {
    const run = await withBeats({
      "2.md": beat(10),
      "3.md": beat(10),
      "4.md": beat(10),
      "5.md": beat(10),
      "6.md": beat(10),
    });
    expect(run.findings).toEqual([
      {
        outcome: "block",
        at: `modules/${MODULE}/summary`,
        message: "the Summary has 6 beats; a Summary is at most 5 short beats, each around one figure",
      },
    ]);
  });

  it("blocks a beat over 90 words, naming the file", async () => {
    const run = await withBeats({ "2.md": beat(91) });
    expect(run.findings).toEqual([
      {
        outcome: "block",
        at: `modules/${MODULE}/summary/2.md`,
        message: "the beat runs 91 words; a beat is at most 90 (a formula counts as one)",
      },
    ]);
  });
});

describe("counting a beat's words", () => {
  it("reads a formula as one word and leaves out Markdown's own marks", () => {
    expect(beatWords("In steady conduction, the heat rate")).toBe(6);
    expect(beatWords("A thicker wall (larger $L$) resists more.")).toBe(7);
    expect(beatWords("$$\n\\dot{Q} = \\frac{\\Delta T}{R}\n$$\n")).toBe(1);
    expect(beatWords("## Heading here\n\n1. First point\n- second [link](https://x.org/a b)\n> quoted")).toBe(7);
    expect(beatWords("   \n\n")).toBe(0);
  });
});
