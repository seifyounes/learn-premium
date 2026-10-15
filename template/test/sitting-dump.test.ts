// `gates/cli.ts sitting`: what the Sitting wave reads of a sitting's content, as the skill's own
// fixture holds it (skill/test/fixtures/sitting-dump/midterm.json: both layers hold the same file,
// so a change to either side's reading fails the other's test).
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { sittingDump } from "../gates/sittings.ts";
import { FIXTURE_COURSE, fixtureWith } from "./build-course";

const TEMPLATE_DIR = resolve(import.meta.dirname, "..");
const SKILL_FIXTURE = resolve(TEMPLATE_DIR, "../skill/test/fixtures/sitting-dump/midterm.json");

describe("the sitting command", () => {
  const cli = (...args: string[]) =>
    spawnSync(process.execPath, ["gates/cli.ts", ...args], { cwd: TEMPLATE_DIR, encoding: "utf8" });

  it("prints midterm as the skill's fixture holds it", () => {
    const run = cli("sitting", "--sitting", "midterm");
    expect(run.status, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual(JSON.parse(readFileSync(SKILL_FIXTURE, "utf8")));
  });

  it("reads the content raw: the question as written, the key as printed, no schema defaults", () => {
    const dump = sittingDump(FIXTURE_COURSE, "midterm");
    const [paper] = dump.papers;
    expect(paper?.questions[0]?.question).toContain(String.raw`$L = 0.25\ \text{m}$`);
    expect(paper?.questions.map((q) => q.key)).toEqual(["0.25", "0.1", null]);
    expect(dump.sitting).toEqual({
      id: "midterm",
      name: "Midterm",
      date: "2026-11-10",
      modules: ["01-thermal-resistance"],
      complete: true,
    });
    // The Fixture's `final` sitting has no `complete` written: the dump doesn't make one up.
    expect(sittingDump(FIXTURE_COURSE, "final").sitting).not.toHaveProperty("complete");
  });

  it("lists the rulings the sitting's own papers carry, and not another entry's", () => {
    const course = fixtureWith("sittings/midterm/papers/2025.yaml", (s) =>
      s.replace(
        "questions:",
        "provenance:\n  divergences:\n    - { value: '0.25', note: 'The exam takes the key.' }\nquestions:",
      ),
    );
    expect(sittingDump(course, "midterm").rulings).toEqual([
      { entry: "sittings/midterm/papers/2025.yaml", kind: "divergence", printed: [0.25] },
    ]);
    // Module 01's own Divergence (Practice item 1) is the Module wave's, not the sitting's.
    expect(sittingDump(FIXTURE_COURSE, "midterm").rulings).toEqual([]);
  });

  it("says a sitting the Course doesn't have is null, with no papers", () => {
    const dump = sittingDump(FIXTURE_COURSE, "nowhere");
    expect(dump.sitting).toBeNull();
    expect(dump.papers).toEqual([]);
    expect(dump.format).toBeNull();
  });

  it("needs a sitting", () => {
    expect(cli("sitting").status).toBe(2);
  });
});
