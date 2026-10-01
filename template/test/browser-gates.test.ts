import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BROWSER_GATES } from "../gates/browser.ts";
import { WIDTHS } from "../gates/browser/run.ts";
import { GATES } from "../gates/index.ts";
import { runGates, type Gate, type GateInput } from "../gates/runner.ts";
import { buildCourse, FIXTURE_COURSE } from "./build-course";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const BROWSERS = 2;

/** What each negative control's finding must say: the check that names its defect caught it. */
const CAUGHT_BY: Record<string, RegExp> = {
  "a block wider than the viewport, so the page scrolls sideways": /the page scrolls sideways/,
  "a value chip positioned over a figure's line": /"9\.6 kW" covers its path/,
  "content lifted above the top of the page": /"Lifted off the page\." sits \d+px above the page/,
  "two paragraphs drawn on the same pixels":
    /"Heat flows from hot to cold\." and .*"Resistances in series add\." overlap/,
  "a height-locked box whose content is taller than it": /holds \d+px of content in a 24px box/,
  "text set under the 12px floor": /"Small print under the floor\." is drawn at 10\.0px, under the 12px floor/,
  "a KaTeX error span on the page": /a KaTeX error on the page: ParseError: planted/,
  "raw TeX a script wrote into the page": /raw TeX on the page: "so \$R = \\frac\{L\}\{kA\}\$"/,
  "a hollow 0/0 score a script wrote": /a hollow 0\/0 on the page: "Score: 0\/0"/,
  "floating-point noise a script computed":
    /a wrong number \(floating-point noise\) on the page: "Heat loss: 0\.30000000000000004 kW"/,
  "an uncaught error as the page loads": /an uncaught error on the page: planted/,
  "an island control that works before its island hydrates": /<button> "Try first" works before its island hydrates/,
  "an island that never hydrates": /the island \/_astro\/missing\.js never hydrated/,
  "a button that does nothing when tapped": /a tap on <button> "Does nothing" changed nothing/,
  "a button under a transparent layer that takes the tap": /<button> "Tap me" can't be tapped/,
  "three.js loaded with the page": /three\.js loads with the page/,
  "Pyodide loaded with the page": /Pyodide loads with the page/,
  "Plotly loaded with the page": /Plotly loads with the page/,
  "a Trap page whose folded figure is labelled at a legal size":
    /missed the Trap page's a figure labelled under the 12px floor/,
  "a Trap page without its KaTeX error": /missed the Trap page's a KaTeX error/,
  "a Trap page whose value chip sits clear of its figure": /missed the Trap page's a value chip laid over a figure/,
  "a Trap page that computes its number right": /missed the Trap page's a wrong number/,
  "a build without the Trap page": /no Trap page at \/trap\//,
};

const gate = (id: string) => BROWSER_GATES.find((g) => g.id === id) as Gate;

describe("the browser gates on the Fixture Course", () => {
  const build = buildCourse(FIXTURE_COURSE);
  const input: GateInput = { contentDir: FIXTURE_COURSE, distDir: build.outDir };

  it("builds, with the Trap page in the preview build", () => {
    expect(build.ok, build.output).toBe(true);
    expect(existsSync(join(build.outDir, "trap", "index.html"))).toBe(true);
  });

  it("run at the Module and deploy points, after the static page gates", () => {
    const at = (point: "job" | "module" | "deploy") => GATES.filter((g) => g.points.includes(point)).map((g) => g.id);
    for (const g of BROWSER_GATES) {
      expect(at("module")).toContain(g.id);
      expect(at("deploy")).toContain(g.id);
      expect(at("job")).not.toContain(g.id);
    }
  });

  it("pass on the whole Course, sweeping every page at every width in both browsers", async () => {
    const report = await runGates({ point: "deploy", commit: COMMIT, input, gates: BROWSER_GATES });
    expect(report.green, JSON.stringify(report.gates, null, 2)).toBe(true);
    const coverage = (id: string) => report.gates.find((g) => g.id === id)?.coverage ?? {};
    const pages = 2; // home and the Module; never the Trap page
    expect(coverage("layout-sweep")).toMatchObject({ browsers: BROWSERS, widths: WIDTHS.length, pages });
    expect(coverage("layout-sweep").sweeps).toBe(BROWSERS * WIDTHS.length * pages);
    // The Given box is the Module page's collapsible; the sweep opened it.
    expect(coverage("layout-sweep").collapsibles).toBeGreaterThanOrEqual(1);
    // A Worked example's Table | Plot tabs add a view at the widths that show them.
    expect(coverage("layout-sweep").views).toBeGreaterThan(coverage("layout-sweep").sweeps ?? 0);
    expect(coverage("live-page-scan").formulas).toBeGreaterThan(0);
    expect(coverage("hydration")).toMatchObject({ islands: 4 });
    expect(coverage("hydration").controls).toBeGreaterThan(10);
    expect(coverage("touch").taps).toBeGreaterThan(20);
    expect(coverage("initial-load").requests).toBeGreaterThan(0);
    // Every sweep of the Trap page found all four seeded defects.
    expect(coverage("trap-page")).toEqual({ sweeps: BROWSERS * WIDTHS.length, defects: BROWSERS * WIDTHS.length * 4 });
  }, 600_000);

  it("each catch every negative control, by the check that names its defect", async () => {
    const misses: string[] = [];
    for (const g of BROWSER_GATES) {
      expect(g.controls.length, g.id).toBeGreaterThan(0);
      for (const control of g.controls) {
        const scratch = mkdtempSync(join(tmpdir(), `lp-browser-${g.id}-`));
        try {
          const result = await g.run(control.plant(input, scratch));
          const blocks = result.findings.filter((f) => f.outcome === "block").map((f) => f.message);
          const expected = CAUGHT_BY[control.defect];
          if (!expected) misses.push(`${g.id}: no expectation for "${control.defect}"`);
          else if (!blocks.some((m) => expected.test(m)))
            misses.push(
              `${g.id}: "${control.defect}" was not caught as ${expected}; it found ${JSON.stringify(blocks)}`,
            );
        } catch (error) {
          misses.push(`${g.id}: "${control.defect}" crashed: ${(error as Error).message}`);
        } finally {
          rmSync(scratch, { recursive: true, force: true });
        }
      }
    }
    expect(misses).toEqual([]);
  }, 1_200_000);

  it("a run that misses a Trap page defect is void: every other browser gate fails", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "lp-browser-void-"));
    try {
      const control = gate("trap-page").controls.find((c) => /KaTeX/.test(c.defect));
      const report = await runGates({
        point: "module",
        commit: COMMIT,
        input: control?.plant(input, scratch) ?? input,
        gates: BROWSER_GATES,
      });
      expect(report.green).toBe(false);
      for (const result of report.gates) {
        if (result.id === "trap-page") expect(result.status).toBe("block");
        else {
          expect(result.status, result.id).toBe("failed");
          expect(result.error).toMatch(/the browser run is void: the run missed the Trap page's a KaTeX error/);
        }
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 300_000);
});

describe("the Trap page", () => {
  it("is left out of a production build", () => {
    const build = buildCourse(FIXTURE_COURSE, { VERCEL_ENV: "production" });
    expect(build.ok, build.output).toBe(true);
    expect(existsSync(join(build.outDir, "trap"))).toBe(false);
    expect(existsSync(join(build.outDir, "index.html"))).toBe(true);
  });
});
