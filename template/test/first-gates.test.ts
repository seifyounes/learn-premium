import { spawnSync } from "node:child_process";
import { cpSync, globSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BROWSER_GATES } from "../gates/browser.ts";
import { GATES } from "../gates/index.ts";
import { runControls, runGates, verifyReport, type GateInput, type GatePoint } from "../gates/runner.ts";
import { readStructured, splitFrontmatter } from "../src/content/loaders.ts";
import { renderTex, splitProse } from "../src/math/katex.ts";
import { buildCourse, FIXTURE_COURSE, fixtureWith } from "./build-course";

const MODULE = "01-thermal-resistance";
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const TEMPLATE_DIR = resolve(import.meta.dirname, "..");

/** The gates that read files; the browser gates have their own tests (browser-gates.test.ts). */
const STATIC_GATES = GATES.filter((g) => !BROWSER_GATES.includes(g));
const run = (point: GatePoint, input: GateInput) => runGates({ point, commit: COMMIT, input, gates: STATIC_GATES });
const gate = (report: Awaited<ReturnType<typeof run>>, id: string) => report.gates.find((g) => g.id === id);

/** A copy of the built site with `html` put into one page's `<main>`. */
function siteWith(distDir: string, route: string, html: string): string {
  const copy = mkdtempSync(join(tmpdir(), "lp-site-"));
  mkdirSync(join(copy, route), { recursive: true });
  const page = readFileSync(join(distDir, route, "index.html"), "utf8");
  writeFileSync(join(copy, route, "index.html"), page.replace("</main>", `${html}</main>`));
  return copy;
}

/** The formulas in a Module's `provenance.stated` lists. */
function statedFormulas(contentDir: string, module: string): number {
  return globSync(`modules/${module}/{worked,practice,summary}/*`, { cwd: contentDir }).reduce((total, entry) => {
    const source = readFileSync(join(contentDir, entry), "utf8");
    const structured = entry.endsWith(".md") ? (splitFrontmatter(source).frontmatter ?? "") : source;
    const { provenance } = readStructured(structured, entry, () => {}) as { provenance?: { stated?: string[] } };
    const segments = (provenance?.stated ?? []).flatMap((s) => {
      const split = splitProse(s);
      return Array.isArray(split) ? split : [];
    });
    return total + segments.filter((s) => s.kind === "math").length;
  }, 0);
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
    expect(job.gates.map((g) => g.id)).toEqual([
      "content-contract",
      "katex",
      "notation",
      "teaching-method",
      "provenance",
      "master-rules",
      "worked-numbers",
      "sim-numbers",
      "truth-table",
      "stl",
      "scl",
      "pinned-definitions",
      "drawing",
      "part-checks",
      "tools",
    ]);
    expect(gate(job, "content-contract")?.coverage).toEqual({
      modules: 1,
      media: 1,
      rules: 1,
      beats: 1,
      worked: 2,
      practice: 3,
      sims: 1,
    });
    // Module 1's plate cooling, checked three ways against the Fourier series and W01.2's sheet.
    expect(gate(job, "sim-numbers")?.coverage).toMatchObject({ modules: 1, sims: 1, sheetValues: 5 });
    expect(gate(job, "katex")?.coverage.files).toBe(10);
    expect(gate(job, "katex")?.coverage.formulas).toBeGreaterThan(10);

    const module = await run("module", { ...input, module: MODULE });
    expect(module.green, JSON.stringify(module.gates, null, 2)).toBe(true);
    expect(module.gates.map((g) => g.id)).toEqual(["rendered-page-scan", "pyodide", "pad", "red-hue-rule"]);
    expect(gate(module, "rendered-page-scan")?.coverage.pages).toBe(1);
    // The scan sees every formula the Module's content shows, the ones only inside islands' props
    // included (a Practice item's hidden model answer, a Worked example's later steps). An island's
    // first render repeats some of its props' formulas, so it can see more, never fewer. Stated
    // values are declarations the page never shows, so their formulas are the only ones it lacks.
    expect(gate(module, "rendered-page-scan")?.coverage.formulas).toBeGreaterThanOrEqual(
      (gate(job, "katex")?.coverage.formulas ?? Infinity) - statedFormulas(FIXTURE_COURSE, MODULE),
    );
    expect(gate(module, "rendered-page-scan")?.coverage.islands).toBe(6);

    const deploy = await run("deploy", input);
    expect(deploy.green, JSON.stringify(deploy.gates, null, 2)).toBe(true);
    expect(deploy.gates.map((g) => g.id)).toEqual([
      "content-contract",
      "katex",
      "notation",
      "teaching-method",
      "provenance",
      "master-rules",
      "worked-numbers",
      "sim-numbers",
      "truth-table",
      "stl",
      "scl",
      "pinned-definitions",
      "drawing",
      "part-checks",
      "tools",
      "rendered-page-scan",
      "pyodide",
      "pad",
      "red-hue-rule",
      "no-materials",
      "no-build-evidence",
      "noindex",
      "licences",
      "licences-file",
    ]);
    expect(gate(deploy, "content-contract")?.coverage.course).toBe(1);
    // Home, eight Modules, Master Rules, Lab, About, the complete sitting's Revision and the Tool gallery.
    expect(gate(deploy, "rendered-page-scan")?.coverage.pages).toBe(14);
  });

  it("each ship a negative control that they catch, and pass their positive fixture", async () => {
    const result = await runControls({ input, gates: STATIC_GATES });
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

  it("the rendered-page scan looks inside an island's props, where hidden answers wait", async () => {
    const page = readFileSync(join(build.outDir, MODULE, "index.html"), "utf8");
    const broken = page.replace(
      /(props="[^"]*?)&lt;span class=\\&quot;katex\\&quot;&gt;/,
      (_, before: string) =>
        `${before}&lt;span class=\\&quot;katex-error\\&quot;&gt;\\\\frac{L&lt;/span&gt;&lt;span class=\\&quot;katex\\&quot;&gt;`,
    );
    expect(broken).not.toBe(page);
    const site = siteWith(build.outDir, MODULE, "");
    writeFileSync(join(site, MODULE, "index.html"), broken);
    const scan = gate(await run("module", { contentDir: FIXTURE_COURSE, distDir: site }), "rendered-page-scan");
    expect(scan?.status).toBe("block");
    expect(scan?.findings.map((f) => f.message)).toEqual([
      expect.stringMatching(/a KaTeX error rendered on the page/),
      expect.stringMatching(/raw TeX on the page: "\\frac\{L"/),
    ]);
  });

  it("the rendered-page scan blocks prose set as a fraction, and passes paper math", async () => {
    const tex = (source: string) => renderTex(source, false, { file: "planted", line: 1 });
    const prose = siteWith(build.outDir, MODULE, `<p>${tex(String.raw`\frac{Player 1}{Player 2}`)}</p>`);
    const scan = gate(await run("module", { contentDir: FIXTURE_COURSE, distDir: prose }), "rendered-page-scan");
    expect(scan?.status).toBe("block");
    expect(scan?.findings.map((f) => f.message)).toEqual([
      expect.stringMatching(/prose set as a fraction: "Player" in \\frac\{Player 1\}\{Player 2\}/),
    ]);

    const paper = siteWith(
      build.outDir,
      MODULE,
      `<p>${tex(String.raw`\frac{\rho V A c}{k}`)} ${tex(String.raw`\frac{\text{heat in}}{\text{area}}`)} ${tex(String.raw`\frac{mgh}{t}`)}</p>`,
    );
    expect(
      gate(await run("module", { contentDir: FIXTURE_COURSE, distDir: paper }), "rendered-page-scan")?.status,
    ).toBe("pass");
  });

  it("the rendered-page scan blocks copy that assumes a content shape, and wrong numbers", async () => {
    const hollow = siteWith(
      build.outDir,
      MODULE,
      "<p>Score: 0/0</p><p>Heat loss: NaN kW</p><p>Drop: 0.30000000000000004 K</p><p>{{MODULE_TITLE}}</p>",
    );
    const scan = gate(await run("module", { contentDir: FIXTURE_COURSE, distDir: hollow }), "rendered-page-scan");
    expect(scan?.findings.map((f) => f.message)).toEqual([
      expect.stringMatching(/a hollow 0\/0 on the page: "Score: 0\/0"/),
      expect.stringMatching(/a wrong number \(NaN\) on the page: "Heat loss: NaN kW"/),
      expect.stringMatching(/a wrong number \(floating-point noise\) on the page: "Drop: 0\.30000000000000004 K"/),
      expect.stringMatching(/an unrendered \{\{placeholder\}\} on the page: "\{\{MODULE_TITLE\}\}"/),
    ]);
  });

  it("the rendered-page scan holds the content's literal braces to the page", async () => {
    const course = fixtureWith(`modules/${MODULE}/practice/2.yaml`, (s) =>
      s.replace("Find its thermal resistance.", "Find its thermal resistance, one of the pair {hot face, cold face}."),
    );
    const braced = buildCourse(course);
    expect(braced.ok, braced.output).toBe(true);
    const rendered = gate(
      await run("module", { contentDir: course, distDir: braced.outDir, module: MODULE }),
      "rendered-page-scan",
    );
    expect(rendered?.status).toBe("pass");
    expect(rendered?.coverage.braces).toBe(1);

    // The same content against a page that lost them.
    const lost = gate(
      await run("module", { contentDir: course, distDir: build.outDir, module: MODULE }),
      "rendered-page-scan",
    );
    expect(lost?.status).toBe("block");
    expect(lost?.findings).toEqual([
      {
        outcome: "block",
        at: `/${MODULE}/`,
        message: `"{hot face, cold face}" in modules/${MODULE}/practice/2.yaml doesn't render literally on the page`,
      },
    ]);
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
      expect.stringMatching(new RegExp(`^modules/${MODULE}/practice/1\\.yaml:4:\\d+$`)),
      expect.stringMatching(new RegExp(`^modules/${MODULE}/practice/1\\.yaml:5:\\d+$`)),
    ]);
    expect(katex?.findings[0]?.message).toMatch(/Undefined control sequence: \\txet/);
  });

  it("find bad math in a Summary beat's Markdown", async () => {
    const course = fixtureWith(`modules/${MODULE}/summary/1.md`, (s) =>
      s.replace("(larger $L$)", "(larger $\\frac{L$)"),
    );
    const katex = gate(await run("job", { contentDir: course, module: MODULE }), "katex");
    expect(katex?.status).toBe("block");
    expect(katex?.findings[0]?.at).toMatch(new RegExp(`^modules/${MODULE}/summary/1\\.md:26:\\d+$`));
  });

  it("block content that breaks the content contract, naming the file and field", async () => {
    const course = fixtureWith(`modules/${MODULE}/worked/1.json`, (s) =>
      s.replace('["Brick", "0.20", "0.8", "0.25", "4.06"]', '["Brick", "0.20", "0.25", "4.06"]'),
    );
    const contract = gate(await run("job", { contentDir: course, module: MODULE }), "content-contract");
    expect(contract?.status).toBe("block");
    expect(contract?.findings).toEqual([
      {
        outcome: "block",
        at: `modules/${MODULE}/worked/1.json`,
        message: "artefact.rows.1: row has 4 cells; the table has 5 columns",
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

  it("cover nothing, and so fail, for a Module that doesn't exist", async () => {
    const report = await run("job", { contentDir: FIXTURE_COURSE, module: "09-missing" });
    expect(report.gates.map((g) => g.status)).toEqual(Array(14).fill("failed"));
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

  it("accepts a committed report for the commit it checked, until the Course changes after it", () => {
    const repo = mkdtempSync(join(tmpdir(), "lp-course-repo-"));
    cpSync(FIXTURE_COURSE, repo, { recursive: true });
    const git = (...args: string[]) =>
      spawnSync("git", ["-C", repo, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", ...args], {
        encoding: "utf8",
      });
    git("init", "-q");
    git("add", "-A");
    git("commit", "-qm", "course");
    expect(gates("run", "--point", "job", "--content", repo).status).toBe(0);
    // Committing the report moves HEAD, but only within the build records.
    git("add", "-A");
    git("commit", "-qm", "gate report");
    const committed = gates("verify", "--point", "job", "--content", repo);
    expect(committed.stdout).toMatch(/^green/);
    expect(committed.status).toBe(0);

    writeFileSync(join(repo, "modules", MODULE, "module.yaml"), "title: Changed\nsummary: After the report.\n");
    git("commit", "-qam", "content after the report");
    const changed = gates("verify", "--point", "job", "--content", repo);
    expect(changed.status).toBe(1);
    expect(changed.stdout).toMatch(/the report checked commit [0-9a-f]{40}, not [0-9a-f]{40}/);
  });

  it("rejects an unknown gate point", () => {
    const result = gates("run", "--point", "nightly");
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/--point must be one of job, module, deploy/);
  });
});
