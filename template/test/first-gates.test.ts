import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { GATES } from "../gates/index.ts";
import { runControls, runGates, verifyReport, type GateInput, type GatePoint } from "../gates/runner.ts";
import { buildCourse, FIXTURE_COURSE, fixtureWith } from "./build-course";

const MODULE = "01-thermal-resistance";
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const TEMPLATE_DIR = resolve(import.meta.dirname, "..");

const run = (point: GatePoint, input: GateInput) => runGates({ point, commit: COMMIT, input, gates: GATES });
const gate = (report: Awaited<ReturnType<typeof run>>, id: string) => report.gates.find((g) => g.id === id);

/** A copy of the built site with `html` put into one page's `<main>`. */
function siteWith(distDir: string, route: string, html: string): string {
  const copy = mkdtempSync(join(tmpdir(), "lp-site-"));
  mkdirSync(join(copy, route), { recursive: true });
  const page = readFileSync(join(distDir, route, "index.html"), "utf8");
  writeFileSync(join(copy, route, "index.html"), page.replace("</main>", `${html}</main>`));
  return copy;
}

describe("the first gates on the Fixture Course", () => {
  const build = buildCourse(FIXTURE_COURSE);
  const input = { contentDir: FIXTURE_COURSE, distDir: build.outDir };

  it("builds", () => {
    expect(build.ok, build.output).toBe(true);
  });

  it("pass at every gate point, each reporting what it covered", async () => {
    const job = await run("job", { ...input, module: MODULE });
    expect(job.green, JSON.stringify(job.gates, null, 2)).toBe(true);
    expect(job.gates.map((g) => g.id)).toEqual(["content-contract", "katex"]);
    expect(gate(job, "content-contract")?.coverage).toEqual({ modules: 1, beats: 1, worked: 1, practice: 1 });
    expect(gate(job, "katex")?.coverage.files).toBe(4);
    expect(gate(job, "katex")?.coverage.formulas).toBeGreaterThan(10);

    const module = await run("module", { ...input, module: MODULE });
    expect(module.green, JSON.stringify(module.gates, null, 2)).toBe(true);
    expect(module.gates.map((g) => g.id)).toEqual(["rendered-page-scan"]);
    expect(gate(module, "rendered-page-scan")?.coverage.pages).toBe(1);
    expect(gate(module, "rendered-page-scan")?.coverage.formulas).toBeGreaterThan(10);

    const deploy = await run("deploy", input);
    expect(deploy.green, JSON.stringify(deploy.gates, null, 2)).toBe(true);
    expect(deploy.gates.map((g) => g.id)).toEqual(["content-contract", "katex", "rendered-page-scan"]);
    expect(gate(deploy, "content-contract")?.coverage.course).toBe(1);
    expect(gate(deploy, "rendered-page-scan")?.coverage.pages).toBe(2);
  });

  it("each ship a negative control that they catch, and pass their positive fixture", async () => {
    const result = await runControls({ input, gates: GATES });
    expect(result.ok, JSON.stringify(result, null, 2)).toBe(true);
    for (const g of result.gates) {
      expect(g.positive).toBe("pass");
      expect(g.controls.length).toBeGreaterThan(0);
    }
  });

  it("the rendered-page scan blocks a KaTeX error span and raw TeX, naming the page", async () => {
    const error = siteWith(build.outDir, MODULE, '<span class="katex-error" title="ParseError">x</span>');
    const errorScan = gate(await run("module", { contentDir: FIXTURE_COURSE, distDir: error }), "rendered-page-scan");
    expect(errorScan?.status).toBe("block");
    expect(errorScan?.findings).toContainEqual(expect.objectContaining({ at: `/${MODULE}/` }));

    const raw = siteWith(build.outDir, MODULE, "<p>so $R = \\frac{L}{k A}$ per layer</p>");
    const rawScan = gate(await run("module", { contentDir: FIXTURE_COURSE, distDir: raw }), "rendered-page-scan");
    expect(rawScan?.status).toBe("block");
    expect(rawScan?.findings[0]?.message).toMatch(/raw TeX.*\\frac\{L\}\{k A\}/);
  });

  it("the rendered-page scan fails when there is no built site to scan", async () => {
    const report = await run("module", { contentDir: FIXTURE_COURSE, module: MODULE });
    expect(gate(report, "rendered-page-scan")?.status).toBe("failed");
    expect(report.green).toBe(false);
  });
});

describe("the content gates", () => {
  it("list every bad formula with its file and line, not just the first", async () => {
    const course = fixtureWith(`modules/${MODULE}/practice/1.yaml`, (s) =>
      s.replace("$600\\ \\text{K}$", "$600\\ \\txet{K}$").replace("$A = 4\\ \\text{m}^2$", "$A = 4\\ \\text{m}^{2$"),
    );
    const katex = gate(await run("job", { contentDir: course, module: MODULE }), "katex");
    expect(katex?.status).toBe("block");
    expect(katex?.findings.map((f) => f.at)).toEqual([
      expect.stringMatching(new RegExp(`^modules/${MODULE}/practice/1\\.yaml:3:\\d+$`)),
      expect.stringMatching(new RegExp(`^modules/${MODULE}/practice/1\\.yaml:4:\\d+$`)),
    ]);
    expect(katex?.findings[0]?.message).toMatch(/Undefined control sequence: \\txet/);
  });

  it("find bad math in a Summary beat's Markdown", async () => {
    const course = fixtureWith(`modules/${MODULE}/summary/1.md`, (s) =>
      s.replace("(larger $L$)", "(larger $\\frac{L$)"),
    );
    const katex = gate(await run("job", { contentDir: course, module: MODULE }), "katex");
    expect(katex?.status).toBe("block");
    expect(katex?.findings[0]?.at).toMatch(new RegExp(`^modules/${MODULE}/summary/1\\.md:12:\\d+$`));
  });

  it("block content that breaks the content contract, naming the file and field", async () => {
    const course = fixtureWith(`modules/${MODULE}/worked/1.json`, (s) =>
      s.replace('["Brick", "0.20", "0.8", "0.25"]', '["Brick", "0.20", "0.25"]'),
    );
    const contract = gate(await run("job", { contentDir: course, module: MODULE }), "content-contract");
    expect(contract?.status).toBe("block");
    expect(contract?.findings).toEqual([
      {
        outcome: "block",
        at: `modules/${MODULE}/worked/1.json`,
        message: "table.rows.1: row has 3 cells; the table has 4 columns",
      },
    ]);
  });

  it("block a Module folder that isn't named NN-slug", async () => {
    const course = fixtureWith("course.yaml", (s) => s);
    const { renameSync } = await import("node:fs");
    renameSync(join(course, "modules", MODULE), join(course, "modules", "Thermal"));
    const contract = gate(await run("deploy", { contentDir: course }), "content-contract");
    expect(contract?.findings).toContainEqual(expect.objectContaining({ at: "modules/Thermal/module.yaml" }));
  });

  it("cover nothing, and so block, for a Module that doesn't exist", async () => {
    const report = await run("job", { contentDir: FIXTURE_COURSE, module: "09-missing" });
    expect(report.gates.map((g) => g.status)).toEqual(["block", "block"]);
  });
});

describe("the gates entry point", () => {
  const gates = (...args: string[]) =>
    spawnSync(process.execPath, ["gates/cli.ts", ...args], { cwd: TEMPLATE_DIR, encoding: "utf8" });
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: TEMPLATE_DIR, encoding: "utf8" }).stdout.trim();

  it("runs a gate point, writes the Gate report for the commit, and verifies it", () => {
    const out = mkdtempSync(join(tmpdir(), "lp-report-"));
    const report = join(out, "job.json");
    const result = gates("run", "--point", "job", "--module", MODULE, "--report", report);
    const written = JSON.parse(readFileSync(report, "utf8"));
    expect(written).toMatchObject({ commit: head, point: "job", module: MODULE });
    expect(result.stdout).toContain("content-contract");
    // The working tree may be dirty while this is developed; the report is then green only if clean.
    expect(result.status).toBe(written.dirty ? 1 : 0);
    const verified = gates("verify", "--point", "job", "--module", MODULE, "--report", report);
    expect(verified.status).toBe(written.dirty ? 1 : 0);
    expect(verifyReport(written, { commit: head, point: "job", module: MODULE, gates: GATES }).green).toBe(
      !written.dirty,
    );
  });

  it("refuses a report for another commit", () => {
    const out = mkdtempSync(join(tmpdir(), "lp-report-"));
    const report = join(out, "job.json");
    gates("run", "--point", "job", "--module", MODULE, "--report", report);
    const verified = gates(
      "verify",
      "--point",
      "job",
      "--module",
      MODULE,
      "--report",
      report,
      "--commit",
      "f".repeat(40),
    );
    expect(verified.status).toBe(1);
    expect(verified.stdout + verified.stderr).toMatch(/not f{40}/);
  });

  it("rejects an unknown gate point", () => {
    const result = gates("run", "--point", "nightly");
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/--point must be one of job, module, deploy/);
  });
});
