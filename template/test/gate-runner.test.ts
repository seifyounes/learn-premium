import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { runControls, runGates, verifyReport, type Gate, type GateRun } from "../gates/runner.ts";

const input = { contentDir: "/nowhere" };
const COMMIT = "0123456789abcdef0123456789abcdef01234567";

/** A gate that returns `result` on the good input and `broken` on its planted control. */
function stubGate(id: string, result: GateRun | (() => never), overrides: Partial<Gate> = {}): Gate {
  return {
    id,
    checks: `stub ${id}`,
    points: ["job", "module", "deploy"],
    run: async (given) => {
      if (given.contentDir === "/planted")
        return { coverage: { items: 1 }, findings: [{ outcome: "block", message: "caught" }] };
      if (typeof result === "function") return result();
      return result;
    },
    controls: [{ defect: "a planted defect", plant: (good) => ({ ...good, contentDir: "/planted" }) }],
    ...overrides,
  };
}

const clean: GateRun = { coverage: { pages: 3, formulas: 12 }, findings: [] };

describe("a gate run", () => {
  it("is green when every gate passes, and records what each gate covered", async () => {
    const report = await runGates({ point: "job", commit: COMMIT, input, gates: [stubGate("a", clean)] });
    expect(report.green).toBe(true);
    expect(report.gates).toEqual([
      { id: "a", checks: "stub a", status: "pass", coverage: { pages: 3, formulas: 12 }, findings: [] },
    ]);
  });

  it("is red when a gate blocks", async () => {
    const blocking: GateRun = {
      coverage: { items: 4 },
      findings: [{ outcome: "block", message: "bad", at: "x.yaml:3" }],
    };
    const report = await runGates({
      point: "job",
      commit: COMMIT,
      input,
      gates: [stubGate("a", clean), stubGate("b", blocking)],
    });
    expect(report.green).toBe(false);
    expect(report.gates.map((g) => g.status)).toEqual(["pass", "block"]);
    expect(report.gates[1]?.findings).toEqual([{ outcome: "block", message: "bad", at: "x.yaml:3" }]);
  });

  it("stays green on Checkpoint items, and lists them for the Owner", async () => {
    const asking: GateRun = {
      coverage: { items: 1 },
      findings: [{ outcome: "checkpoint", message: "Slip or Divergence?" }],
    };
    const report = await runGates({ point: "module", commit: COMMIT, input, gates: [stubGate("a", asking)] });
    expect(report.green).toBe(true);
    expect(report.gates[0]?.status).toBe("checkpoint");
    expect(report.checkpointItems).toEqual([{ gate: "a", outcome: "checkpoint", message: "Slip or Divergence?" }]);
  });

  it("blocks on a block even when the same gate also raises a Checkpoint item", async () => {
    const both: GateRun = {
      coverage: { items: 2 },
      findings: [
        { outcome: "checkpoint", message: "ask" },
        { outcome: "block", message: "fix" },
      ],
    };
    const report = await runGates({ point: "job", commit: COMMIT, input, gates: [stubGate("a", both)] });
    expect(report.gates[0]?.status).toBe("block");
    expect(report.green).toBe(false);
  });

  it("records a gate that crashed as failed", async () => {
    const crash = () => {
      throw new Error("no built site given");
    };
    const report = await runGates({ point: "deploy", commit: COMMIT, input, gates: [stubGate("a", crash)] });
    expect(report.green).toBe(false);
    expect(report.gates[0]).toMatchObject({ id: "a", status: "failed", error: "no built site given" });
  });

  it("records a gate that saw nothing as failed, so it can't pass", async () => {
    const empty: GateRun = { coverage: { pages: 0 }, findings: [] };
    const report = await runGates({ point: "module", commit: COMMIT, input, gates: [stubGate("a", empty)] });
    expect(report.green).toBe(false);
    expect(report.gates[0]).toMatchObject({
      status: "failed",
      coverage: { pages: 0 },
      error: expect.stringMatching(/covered nothing/),
    });
  });

  describe("on a Course with no Modules yet", () => {
    /** A Course's content folder holding `files` (path → text). */
    function course(files: Record<string, string>): string {
      const dir = mkdtempSync(join(tmpdir(), "lp-runner-course-"));
      for (const [entry, text] of Object.entries(files)) {
        mkdirSync(dirname(join(dir, entry)), { recursive: true });
        writeFileSync(join(dir, entry), text);
      }
      return dir;
    }
    // As intake creates it: a course config, and modules/ kept by a .gitkeep.
    const empty = course({ "course.yaml": "name: x\n", "modules/.gitkeep": "" });
    const oneModule = course({ "course.yaml": "name: x\n", "modules/01-first/module.yaml": "title: x\n" });
    const sawNothing: GateRun = { coverage: { examples: 0 }, findings: [] };
    const contentGate = stubGate("content", sawNothing, { points: ["job", "deploy"] });
    const deployRun = (contentDir: string, gates: Gate[], module?: string) =>
      runGates({
        point: "deploy",
        commit: COMMIT,
        input: { contentDir, ...(module === undefined ? {} : { module }) },
        gates,
      });

    it("passes a content gate that covered nothing, and the report says it had nothing to check", async () => {
      const report = await deployRun(empty, [contentGate]);
      expect(report.green).toBe(true);
      expect(report.gates[0]).toEqual({
        id: "content",
        checks: "stub content",
        status: "pass",
        coverage: { examples: 0 },
        findings: [],
        nothingToCheck: "the Course has no Modules yet",
      });
      expect(verifyReport(report, { commit: COMMIT, point: "deploy", gates: [contentGate] }).green).toBe(true);
    });

    it("applies the coverage rule again once one Module exists", async () => {
      const report = await deployRun(oneModule, [contentGate]);
      expect(report.green).toBe(false);
      expect(report.gates[0]).toMatchObject({ status: "failed", error: expect.stringMatching(/covered nothing/) });
      expect(report.gates[0]).not.toHaveProperty("nothingToCheck");
    });

    it("passes a Course with no modules/ folder at all", async () => {
      expect((await deployRun(course({ "course.yaml": "name: x\n" }), [contentGate])).gates[0]?.status).toBe("pass");
    });

    it("counts any other file under modules/ as a Module begun", async () => {
      for (const file of ["modules/notes.txt", "modules/01-first/.gitkeep"]) {
        const begun = course({ "course.yaml": "name: x\n", [file]: "" });
        expect((await deployRun(begun, [contentGate])).gates[0]?.status, file).toBe("failed");
      }
    });

    it("still records a failed gate, never crashes the run, when modules/ can't be read as a folder", async () => {
      const notAFolder = course({ "course.yaml": "name: x\n", modules: "a file where the folder goes" });
      expect((await deployRun(notAFolder, [contentGate])).gates[0]?.status).toBe("failed");
    });

    it("still fails a content gate that covered nothing in a run scoped to one Module", async () => {
      expect((await deployRun(empty, [contentGate], "01-first")).gates[0]?.status).toBe("failed");
    });

    it("still fails a gate on the built site that covered nothing", async () => {
      const buildGate = stubGate("pages", { coverage: { pages: 0 }, findings: [] }, { points: ["module", "deploy"] });
      expect((await deployRun(empty, [buildGate])).gates[0]?.status).toBe("failed");
    });

    it("still fails a content gate that covered nothing in a folder that isn't a Course", async () => {
      expect((await deployRun(course({}), [contentGate])).gates[0]?.status).toBe("failed");
    });

    it("still reports a content gate's findings", async () => {
      const blocking = stubGate(
        "content",
        { coverage: { examples: 0 }, findings: [{ outcome: "block", message: "no course.yaml" }] },
        { points: ["job", "deploy"] },
      );
      expect((await deployRun(empty, [blocking])).gates[0]?.status).not.toBe("pass");
    });
  });

  it("runs only the gates that belong to its gate point", async () => {
    const gates = [
      stubGate("job-only", clean, { points: ["job"] }),
      stubGate("module-only", clean, { points: ["module"] }),
    ];
    const report = await runGates({ point: "module", commit: COMMIT, input, gates });
    expect(report.gates.map((g) => g.id)).toEqual(["module-only"]);
  });

  it("is red when no gate belongs to its gate point", async () => {
    const report = await runGates({
      point: "deploy",
      commit: COMMIT,
      input,
      gates: [stubGate("a", clean, { points: ["job"] })],
    });
    expect(report.gates).toEqual([]);
    expect(report.green).toBe(false);
  });

  it("names the commit, the gate point and the Module it checked", async () => {
    const report = await runGates({
      point: "module",
      commit: COMMIT,
      input: { ...input, module: "01-thermal-resistance" },
      gates: [stubGate("a", clean)],
    });
    expect(report).toMatchObject({ commit: COMMIT, dirty: false, point: "module", module: "01-thermal-resistance" });
  });
});

describe("verifying a Gate report", () => {
  const gates = [stubGate("a", clean), stubGate("b", clean)];
  const green = () => runGates({ point: "module", commit: COMMIT, input, gates });

  it("accepts a green report for the commit being merged", async () => {
    expect(verifyReport(await green(), { commit: COMMIT, point: "module", gates })).toEqual({
      green: true,
      problems: [],
    });
  });

  it("does not accept a report for another commit", async () => {
    const verdict = verifyReport(await green(), { commit: "f".repeat(40), point: "module", gates });
    expect(verdict.green).toBe(false);
    expect(verdict.problems.join("\n")).toMatch(/checked commit 0123456/);
  });

  it("does not accept a report taken on uncommitted changes", async () => {
    const report = await runGates({ point: "module", commit: COMMIT, dirty: true, input, gates });
    expect(report.green).toBe(false);
    expect(verifyReport(report, { commit: COMMIT, point: "module", gates }).problems.join("\n")).toMatch(/uncommitted/);
  });

  it("does not accept a report from another gate point or Module", async () => {
    expect(verifyReport(await green(), { commit: COMMIT, point: "deploy", gates }).green).toBe(false);
    expect(verifyReport(await green(), { commit: COMMIT, point: "module", module: "02-fins", gates }).green).toBe(
      false,
    );
  });

  it("counts a gate missing from the report as failed", async () => {
    const report = await runGates({ point: "module", commit: COMMIT, input, gates: [gates[0] as Gate] });
    const verdict = verifyReport(report, { commit: COMMIT, point: "module", gates });
    expect(verdict.green).toBe(false);
    expect(verdict.problems).toContain('gate "b" did not run: failed');
  });

  it("does not accept a report whose gates are not all green, even if it says it is", async () => {
    const report = { ...(await green()), green: true };
    report.gates = report.gates.map((g) => (g.id === "b" ? { ...g, status: "block" as const } : g));
    expect(verifyReport(report, { commit: COMMIT, point: "module", gates }).green).toBe(false);
  });

  it("does not accept something that isn't a Gate report", () => {
    const verdict = verifyReport({ commit: COMMIT, green: true }, { commit: COMMIT, point: "module", gates });
    expect(verdict.green).toBe(false);
    expect(verdict.problems[0]).toMatch(/not a Gate report/);
  });
});

describe("negative controls", () => {
  it("pass when every gate passes its positive fixture and catches every planted defect", async () => {
    const result = await runControls({ input, gates: [stubGate("a", clean)] });
    expect(result.ok).toBe(true);
    expect(result.gates).toEqual([
      {
        id: "a",
        positive: "pass",
        controls: [{ defect: "a planted defect", expected: "block", status: "block", caught: true }],
      },
    ]);
  });

  it("fail when a negative control passes", async () => {
    const blind = stubGate("blind", clean, {
      run: async () => clean,
      controls: [{ defect: "a defect it can't see", plant: (good) => good }],
    });
    const result = await runControls({ input, gates: [blind] });
    expect(result.ok).toBe(false);
    expect(result.gates[0]?.controls[0]).toMatchObject({ caught: false, status: "pass" });
  });

  it("catch a defect only the Owner can settle when the gate raises it as a Checkpoint item", async () => {
    const asking = (outcome: "block" | "checkpoint") =>
      stubGate("asks", clean, {
        run: async (given) =>
          given.contentDir === "/planted"
            ? { coverage: { items: 1 }, findings: [{ outcome, message: "the sheet differs" }] }
            : clean,
        controls: [
          {
            defect: "a sheet value the engine and the recompute agree against",
            expect: "checkpoint",
            plant: (good) => ({ ...good, contentDir: "/planted" }),
          },
        ],
      });
    const raised = await runControls({ input, gates: [asking("checkpoint")] });
    expect(raised.ok).toBe(true);
    expect(raised.gates[0]?.controls[0]).toMatchObject({ caught: true, status: "checkpoint", expected: "checkpoint" });
    // Blocking what only the Owner may rule is as wrong as letting it through.
    const blocked = await runControls({ input, gates: [asking("block")] });
    expect(blocked.ok).toBe(false);
    expect(blocked.gates[0]?.controls[0]).toMatchObject({ caught: false, status: "block", expected: "checkpoint" });
  });

  it("fail when a gate has no negative control", async () => {
    const result = await runControls({ input, gates: [stubGate("a", clean, { controls: [] })] });
    expect(result.ok).toBe(false);
  });

  it("fail when the positive fixture does not pass", async () => {
    const blocking: GateRun = { coverage: { items: 1 }, findings: [{ outcome: "block", message: "bad" }] };
    const result = await runControls({ input, gates: [stubGate("a", blocking)] });
    expect(result.ok).toBe(false);
    expect(result.gates[0]?.positive).toBe("block");
  });

  it("do not count a gate that crashed on its control as catching it", async () => {
    const crashing = stubGate("a", clean, {
      controls: [
        {
          defect: "x",
          plant: () => {
            throw new Error("the fixture changed; nothing to break");
          },
        },
      ],
    });
    const result = await runControls({ input, gates: [crashing] });
    expect(result.ok).toBe(false);
    expect(result.gates[0]?.controls[0]).toMatchObject({ caught: false, status: "failed" });
  });
});
