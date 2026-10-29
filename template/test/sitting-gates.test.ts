// The sitting gate point and its three gates, on the Fixture Course's midterm (complete, one past
// paper keyed by the Professor, two mocks and an announced format): each gate passes its positive
// fixture and catches each planted defect, and the point runs scoped to one sitting.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BROWSER_GATES } from "../gates/browser.ts";
import { GATES } from "../gates/index.ts";
import { runControls, runGates, type GateInput } from "../gates/runner.ts";
import { mockDna, pastPapers, revisionShipped, SITTING_GATES } from "../gates/sittings.ts";
import { buildCourse, FIXTURE_COURSE, fixtureWith } from "./build-course";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const TEMPLATE_DIR = resolve(import.meta.dirname, "..");
const PAPER = "sittings/midterm/papers/2025.yaml";
const MOCK = "sittings/midterm/mocks/mock-1.yaml";

/** The gates that read files; the browser gates have their own tests (browser-gates.test.ts). */
const STATIC_GATES = GATES.filter((g) => !BROWSER_GATES.includes(g));

describe("the sitting gates on the Fixture Course's midterm", () => {
  const build = buildCourse(FIXTURE_COURSE);
  const input: GateInput = { contentDir: FIXTURE_COURSE, distDir: build.outDir, sitting: "midterm" };
  const run = (gate: (typeof SITTING_GATES)[number], given: GateInput = input) => gate.run(given);

  it("builds", () => {
    expect(build.ok, build.output).toBe(true);
  });

  it("a sitting run on midterm is green and names the three gates", async () => {
    const report = await runGates({ point: "sitting", commit: COMMIT, input, gates: STATIC_GATES });
    expect(report.green, JSON.stringify(report.gates, null, 2)).toBe(true);
    expect(report.sitting).toBe("midterm");
    expect(report.gates.map((g) => g.id)).toEqual([
      "rendered-page-scan",
      "past-papers",
      "mock-dna",
      "revision-shipped",
    ]);
    // The sitting's own pages only: the Exam room, its three papers, and Revision.
    expect(report.gates[0]?.coverage.pages).toBe(5);
    expect(report.checkpointItems).toEqual([]);
  });

  it("with no sitting given, checks every complete sitting", async () => {
    const report = await runGates({
      point: "sitting",
      commit: COMMIT,
      input: { contentDir: FIXTURE_COURSE, distDir: build.outDir },
      gates: SITTING_GATES,
    });
    expect(report.green, JSON.stringify(report.gates, null, 2)).toBe(true);
    expect(report.gates.every((g) => g.coverage.sittings === 1)).toBe(true);
  });

  it("past-papers passes midterm's keyed paper three ways", async () => {
    const result = await run(pastPapers);
    expect(result.coverage).toMatchObject({ papers: 1, values: 2 });
    expect(result.findings).toEqual([]);
  });

  it("mock-dna passes midterm's mocks", async () => {
    const result = await run(mockDna);
    expect(result.coverage).toMatchObject({ mocks: 2, papers: 1 });
    expect(result.findings).toEqual([]);
  });

  it("revision-shipped: the midterm Revision sections are exactly Module 01, in weight order", async () => {
    const result = await run(revisionShipped);
    expect(result.coverage).toMatchObject({ sittings: 1, sections: 1, pages: 5 });
    expect(result.findings).toEqual([]);
  });

  it("each gate passes its positive fixture and catches every planted defect", async () => {
    const result = await runControls({ input, gates: SITTING_GATES });
    expect(result.ok, JSON.stringify(result, null, 2)).toBe(true);
    for (const g of result.gates) {
      expect(g.positive).toBe("pass");
      expect(g.controls.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("revision-shipped blocks a planted section, reordered Modules and a missing Exam room, by name", async () => {
    const result = await runControls({ input, gates: [revisionShipped] });
    const defects = result.gates[0]?.controls.map((c) => [c.defect, c.status]);
    expect(defects).toEqual([
      ["a Revision section for a Module the sitting doesn't cover", "block"],
      ["a Revision with its Modules out of exam-weight order", "block"],
      ["an Exam room missing from the build", "block"],
      ["a paper's page missing from the build", "block"],
    ]);
  });
});

describe("past-papers on content planted with a defect", () => {
  const messages = async (course: string) => {
    const result = await pastPapers.run({ contentDir: course, sitting: "midterm" });
    return result.findings.map((f) => `${f.outcome}: ${f.message}`);
  };
  const edited = (edit: (text: string) => string) => fixtureWith(PAPER, edit);

  it("blocks an answer that neither the key nor the recompute gives", async () => {
    const found = await messages(edited((s) => s.replace("value: 0.25, unit: K/W", "value: 0.3, unit: K/W")));
    expect(found).toEqual([expect.stringMatching(/^block: question 1's answer 0.3 matches neither the key 0.25 nor/)]);
  });

  it("raises a Checkpoint item for a key the answer and recompute disagree with, in the form the wave reads", async () => {
    const found = await messages(edited((s) => s.replace("key: '0.25'", "key: '0.30'")));
    expect(found).toEqual([
      "checkpoint: question 1's key prints 0.30, but the answer and the recompute give 0.25: rule it a Slip or a Divergence",
    ]);
  });

  it("passes a key the Owner ruled a Slip, since the site ships the recompute's value", async () => {
    const course = edited((s) =>
      s
        .replace("key: '0.25'", "key: '0.30'")
        .replace("questions:", "provenance:\n  slips:\n    - { value: '0.25', sheet: '0.30' }\nquestions:"),
    );
    expect(await messages(course)).toEqual([]);
  });

  it("blocks a key ruled a Divergence while the answer still ships the recompute's value", async () => {
    const course = edited((s) =>
      s
        .replace("key: '0.25'", "key: '0.30'")
        .replace(
          "questions:",
          "provenance:\n  divergences:\n    - { value: '0.30', note: 'The exam takes the key.' }\nquestions:",
        ),
    );
    expect(await messages(course)).toEqual([
      expect.stringMatching(/^block: question 1's key prints 0.30, which the Owner ruled a Divergence/),
    ]);
  });

  it("passes a Divergence when the answer ships the key's value", async () => {
    const course = edited((s) =>
      s
        .replace(
          "value: 0.25, unit: K/W, tolerance: 0.005, key: '0.25'",
          "value: 0.3, unit: K/W, tolerance: 0.005, key: '0.30'",
        )
        .replace(
          "questions:",
          "provenance:\n  divergences:\n    - { value: '0.30', note: 'The exam takes the key.' }\nquestions:",
        ),
    );
    expect(await messages(course)).toEqual([]);
  });

  it("raises a Checkpoint item when the answer matches the key but the recompute differs", async () => {
    const course = edited((s) =>
      s.replace(
        "value: 0.25, unit: K/W, tolerance: 0.005, key: '0.25'",
        "value: 0.3, unit: K/W, tolerance: 0.005, key: '0.30'",
      ),
    );
    expect(await messages(course)).toEqual([
      expect.stringMatching(
        /^checkpoint: question 1's key prints 0.30 and the answer matches it, but the independent recompute gives 0.25/,
      ),
    ]);
  });

  it("asks the Owner to confirm a paper with no Professor key, naming a digest of its answers", async () => {
    const course = edited((s) => s.replace("key: professor", "key: solved").replaceAll(/, key: '[^']*'/g, ""));
    const found = await messages(course);
    expect(found).toEqual([
      expect.stringMatching(/^checkpoint: no Professor key; .* Confirm them \(answers [0-9a-f]{10}\)$/),
    ]);
    // A different solution is a different digest.
    const changed = await messages(
      fixtureWith(PAPER, (s) =>
        s
          .replace("key: professor", "key: solved")
          .replaceAll(/, key: '[^']*'/g, "")
          .replace("value: 0.25,", "value: 0.251,"),
      ),
    );
    expect(changed).toHaveLength(1);
    expect(changed[0]).not.toBe(found[0]);
    // So is a change to what only the rubric or the unit says: the Owner confirms the whole answer.
    const solved = (edit: (s: string) => string) =>
      messages(
        fixtureWith(PAPER, (s) => edit(s.replace("key: professor", "key: solved").replaceAll(/, key: '[^']*'/g, ""))),
      );
    const earns = await solved((s) =>
      s.replace("The same $\\dot{Q}$ crosses every layer in series.", "Heat is the same in every layer."),
    );
    expect(earns[0]).not.toBe(found[0]);
    const tolerance = await solved((s) => s.replace("tolerance: 0.005 }", "tolerance: 0.01 }"));
    expect(tolerance[0]).not.toBe(found[0]);
  });

  it("blocks a solved paper whose answer differs from the recompute by more than its tolerance", async () => {
    const course = edited((s) =>
      s
        .replace("key: professor", "key: solved")
        .replaceAll(/, key: '[^']*'/g, "")
        .replace("value: 0.25", "value: 0.3"),
    );
    expect((await messages(course)).filter((m) => m.startsWith("block:"))).toEqual([
      expect.stringMatching(/question 1's answer 0.3 and the independent recompute 0.25 differ/),
    ]);
  });

  it("blocks an answer and a recompute on opposite sides of the key, each a unit from it", async () => {
    const recompute = (s: string) => {
      const log = JSON.parse(s) as { answers: Record<string, number> };
      return JSON.stringify({ ...log, answers: { ...log.answers, "1": 0.26 } });
    };
    const course = fixtureWith(
      "build-records/recompute/sittings/midterm/2025.json",
      recompute,
      fixtureWith(PAPER, (s) => s.replace("value: 0.25, unit: K/W", "value: 0.24, unit: K/W")),
    );
    expect(await messages(course)).toEqual([
      expect.stringMatching(
        /^block: question 1's answer 0.24 and the independent recompute 0.26 disagree with each other/,
      ),
    ]);
  });

  it("asks the Owner to confirm a numeric answer the Professor's key sheet leaves out, not blocking the paper", async () => {
    // The key sheet gives question 1 but not question 2: question 2 is treated as a solved paper's answer is.
    const found = await messages(edited((s) => s.replace(", key: '0.1'", "")));
    expect(found).toEqual([
      expect.stringMatching(
        /^checkpoint: question 2 has no printed Professor key; its answer is the build's solution, recomputed independently\. Confirm it \(answers [0-9a-f]{10}\)$/,
      ),
    ]);
    // Question 1's key is still held three ways.
    const off = await messages(
      edited((s) => s.replace(", key: '0.1'", "").replace("value: 0.25, unit: K/W", "value: 0.3, unit: K/W")),
    );
    expect(off).toEqual([
      expect.stringMatching(/^block: question 1's answer 0.3 matches neither the key 0.25 nor/),
      expect.stringMatching(/^checkpoint: question 2 has no printed/),
    ]);
    // Both answers unkeyed: one item for the paper, naming both.
    const both = await messages(edited((s) => s.replaceAll(/, key: '[^']*'/g, "")));
    expect(both).toEqual([
      expect.stringMatching(
        /^checkpoint: questions 1, 2 have no printed Professor key; their answers are the build's solution/,
      ),
    ]);
    // A different answer for the unkeyed question is a different digest: the Owner confirms again.
    const changed = await messages(
      edited((s) => s.replace(", key: '0.1'", "").replace("value: 0.1,", "value: 0.101,")),
    );
    expect(changed).toHaveLength(1);
    expect(changed[0]).not.toBe(found[0]);
  });

  it("blocks an unkeyed numeric answer that differs from the independent recompute by more than its tolerance", async () => {
    const found = await messages(
      edited((s) => s.replace(", key: '0.1'", "").replace("value: 0.1, unit: m", "value: 0.2, unit: m")),
    );
    expect(found.filter((m) => m.startsWith("block:"))).toEqual([
      expect.stringMatching(
        /question 2's answer 0.2 and the independent recompute 0.1 differ by more than its tolerance/,
      ),
    ]);
  });

  it("blocks marks that don't add up, and a written answer with too few points", async () => {
    const marks = await messages(edited((s) => s.replace("marks: 10\nminutes: 30", "marks: 11\nminutes: 30")));
    expect(marks).toEqual([expect.stringMatching(/the questions carry 10 marks, but the paper prints a total of 11/)]);
    const earns = await messages(
      edited((s) => s.replace("        - 'The same $\\dot{Q}$ crosses every layer in series.'\n", "")),
    );
    expect(earns).toEqual([expect.stringMatching(/question 3 is worth 2 marks, but its answer lists 1 point/)]);
  });

  it("blocks a recompute log that is missing, or leaves out a question", async () => {
    const course = fixtureWith("build-records/recompute/sittings/midterm/2025.json", (s) => {
      const log = JSON.parse(s) as { answers: Record<string, number> };
      return JSON.stringify({ ...log, answers: { "1": 0.25 } });
    });
    expect(await messages(course)).toEqual([expect.stringMatching(/doesn't give question 2/)]);
    const missing = fixtureWith("course.yaml", (s) => s);
    rmSync(join(missing, "build-records/recompute/sittings/midterm/2025.json"));
    expect(await messages(missing)).toEqual([
      expect.stringMatching(/no recompute log at build-records\/recompute\/sittings\/midterm\/2025.json/),
    ]);
  });

  it("blocks a paper the content contract rejects", async () => {
    const found = await messages(edited((s) => s.replace("marks: 10\n", "marks: ten\n")));
    expect(found).toEqual([
      expect.stringMatching(/^block: can't check the past paper: the content contract reports marks/),
    ]);
  });
});

describe("mock-dna on content planted with a defect", () => {
  const messages = async (course: string) => {
    const result = await mockDna.run({ contentDir: course, sitting: "midterm" });
    return result.findings.map((f) => `${f.outcome}: ${f.message}`);
  };

  it("blocks a mock with no sibling past paper: mocks but no past paper is Revision only", async () => {
    const course = fixtureWith("course.yaml", (s) => s);
    rmSync(join(course, "sittings/midterm/papers"), { recursive: true });
    expect(await messages(course)).toEqual([expect.stringMatching(/has no past papers: Revision only/)]);
  });

  it("blocks a sitting with past papers but no pattern-matched mock", async () => {
    const course = fixtureWith("course.yaml", (s) => s);
    rmSync(join(course, "sittings/midterm/mocks/mock-1.yaml"));
    rmSync(join(course, "build-records/recompute/sittings/midterm/mock-1.json"));
    expect(await messages(course)).toEqual([expect.stringMatching(/no pattern-matched mock/)]);
  });

  it("blocks one extra reverse question's worth too many: +2 of a type blocks, +1 passes", async () => {
    const question = (n: number) =>
      `  - module: 01-thermal-resistance\n    type: calculation\n    reverse: true\n    marks: 1\n    question: 'Q${n} of $R = \\frac{L}{kA}$.'\n    answer: { kind: numeric, value: 1, tolerance: 0.1 }\n`;
    const plant = (extra: number) => {
      const course = fixtureWith(
        MOCK,
        (s) =>
          `${s.replace("marks: 10", `marks: ${10 + extra}`)}${Array.from({ length: extra }, (_, i) => question(i + 4)).join("")}`,
      );
      const log = join(course, "build-records/recompute/sittings/midterm/mock-1.json");
      const answers = Object.fromEntries(
        [1, 2, ...Array.from({ length: extra }, (_, i) => i + 4)].map((n) => [
          String(n),
          n === 1 ? 0.5 : n === 2 ? 0.2 : 1,
        ]),
      );
      writeFileSync(log, JSON.stringify({ recompute: "learn-premium paper recompute v1", by: "test", answers }));
      return course;
    };
    expect(await messages(plant(1))).toEqual([]);
    expect(await messages(plant(2))).toEqual([
      expect.stringMatching(/asks 4 calculation questions; the past papers average 2/),
    ]);
  });

  it("blocks a mock whose reverse rate falls below the past papers'", async () => {
    const course = fixtureWith(MOCK, (s) => s.replace("reverse: true", "reverse: false"));
    expect(await messages(course)).toEqual([
      expect.stringMatching(/rate of reverse questions is 0, below the past papers' 0.33/),
    ]);
  });

  it("blocks an announced mock with a slot's marks changed, or two announced mocks, or none", async () => {
    const marks = fixtureWith("sittings/midterm/mocks/announced.yaml", (s) =>
      s
        .replace("marks: 10\nminutes: 20", "marks: 11\nminutes: 20")
        .replace("    marks: 4\n", "    marks: 5\n")
        .replace(
          "        - 'Their heat rates add, so their conductances add.'\n",
          "        - 'Their heat rates add, so their conductances add.'\n        - 'Names the sum of conductances.'\n",
        ),
    );
    expect(await messages(marks)).toEqual([
      expect.stringMatching(/slot 2: the mock gives 5 marks; the format says 4 marks/),
      expect.stringMatching(/carry 11 marks; the format's slots carry 10/),
    ]);
    const none = fixtureWith("course.yaml", (s) => s);
    rmSync(join(none, "sittings/midterm/mocks/announced.yaml"));
    rmSync(join(none, "build-records/recompute/sittings/midterm/announced.json"));
    expect(await messages(none)).toEqual([expect.stringMatching(/exactly one announced mock; it has 0/)]);
    const noFormat = fixtureWith("course.yaml", (s) => s);
    rmSync(join(noFormat, "sittings/midterm/format.yaml"));
    expect(await messages(noFormat)).toEqual([expect.stringMatching(/an announced mock but no format.yaml/)]);
  });

  it("blocks a key on a mock's numeric answer: mocks are never keyed", async () => {
    const course = fixtureWith(MOCK, (s) => s.replace("tolerance: 0.01 }", "tolerance: 0.01, key: '0.5' }"));
    expect(await messages(course)).toEqual([
      expect.stringMatching(/can't check the mock: the content contract reports/),
    ]);
  });
});

describe("the sitting gate point's entry point", () => {
  const gates = (...args: string[]) =>
    spawnSync(process.execPath, ["gates/cli.ts", ...args], { cwd: TEMPLATE_DIR, encoding: "utf8" });

  it("refuses the sitting point without a sitting", () => {
    const run = gates("run", "--point", "sitting");
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("needs --sitting ID");
    expect(gates("verify", "--point", "sitting").status).toBe(2);
  });

  it("holds a report to its sitting and its commit: green for midterm, red for another sitting", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lp-sitting-"));
    const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: TEMPLATE_DIR, encoding: "utf8" }).stdout.trim();
    const report = await runGates({
      point: "sitting",
      commit: head,
      input: { contentDir: FIXTURE_COURSE, sitting: "midterm" },
      gates: SITTING_GATES.filter((g) => g !== revisionShipped),
    });
    const path = join(dir, "report.json");
    writeFileSync(path, JSON.stringify(report));
    // The report lacks the revision-shipped gate, which the sitting point also runs: red either way.
    const verdict = gates("verify", "--point", "sitting", "--sitting", "midterm", "--report", path, "--commit", head);
    expect(verdict.stdout).toContain('gate "revision-shipped" did not run');
    const other = gates("verify", "--point", "sitting", "--sitting", "final", "--report", path, "--commit", head);
    expect(other.stdout).toContain("the report is for midterm, not final");
    rmSync(dir, { recursive: true, force: true });
  });
});
