import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCourse, FIXTURE_COURSE, fixtureWith } from "./build-course";

describe("the Fixture Course", () => {
  const build = buildCourse(FIXTURE_COURSE);

  it("builds to plain static files", () => {
    expect(build.ok, build.output).toBe(true);
    expect(build.page("")).toContain("Fixture Course");
    expect(build.page("01-thermal-resistance")).toContain("Thermal resistance");
    for (const route of ["", "01-thermal-resistance"]) {
      expect(build.page(route), "the synthetic Course says so").toContain("Synthetic Course: written to test");
    }
  });

  it("renders math as paper math, chemistry included", () => {
    const page = build.page("01-thermal-resistance");
    // KaTeX keeps each formula's source as an annotation: the list of what was typeset.
    const typeset = [...page.matchAll(/<annotation encoding="application\/x-tex">([^<]*)<\/annotation>/g)].map((m) =>
      (m[1] ?? "").replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&"),
    );
    expect(typeset).toContain("\\ce{CH4 + 2O2 -> CO2 + 2H2O}");
    expect(typeset).toContain("\\dot{Q} = \\frac{\\Delta T}{R}, \\qquad R = \\frac{L}{k A}");
    expect(page.includes('class="mfrac"'), "a stacked fraction").toBe(true);
    expect(page.includes("katex-error"), "a KaTeX error span").toBe(false);
    expect(/\$[^$<]*\\frac/.test(page), "raw TeX left in the page").toBe(false);
  });

  it("ships no JavaScript on a static page, and React islands where a page places one", () => {
    expect(build.page("rules").includes("<script"), "a script on Master Rules").toBe(false);
    expect(build.page("").includes("<astro-island"), "an island on the home page").toBe(false);
    const island = /<astro-island[^>]*component-url="(\/_astro\/PracticeItem\.[^"]+\.js)"[^>]*client="visible"/.exec(
      build.page("01-thermal-resistance"),
    );
    expect(island?.[1], "the practice item's island").toBeDefined();
    expect(existsSync(join(build.outDir, island?.[1] ?? "missing"))).toBe(true);
  });

  it("renders a Worked example as a solved sheet that opens on its question", () => {
    const page = build.page("01-thermal-resistance");
    const island =
      /<astro-island[^>]*component-url="\/_astro\/WorkedSheet\.[^"]+\.js"[^>]*client="visible"[^>]*>([\s\S]*?)<\/astro-island>/.exec(
        page,
      )?.[1] ?? "";
    expect(island, "the Worked example's island").not.toBe("");
    expect(island).toMatch(/>1<span class="text-pencil"> \/ (?:<!-- -->)?6<\/span>/);
    // The Given box is the page's own markup, passed into the island.
    expect(island).toContain('<details class="given-box">');
    // Step 1: the given columns are printed, nothing worked out is on the sheet yet…
    expect(island).toMatch(/data-cell="B1"[^>]*><span[^>]*>0\.02<\/span>/);
    expect(island).toMatch(/data-cell="D1"[^>]*><\/td>/);
    // …and the figure is the question's: two of its four points.
    expect(island.match(/class="plot-point"/g)).toHaveLength(2);
  });

  it("styles the sheet from the course's pad tokens", () => {
    expect(build.page("")).toMatch(/<html lang="en" dir="ltr" data-pad="green" style="[^"]*--pad-print: #2E5A38;/);
    const css = build.css();
    // The colour tokens are CSS variables whether a page uses them or not, and utilities go through them.
    for (const token of [
      "--color-print:var(--pad-print)",
      "--color-muted:var(--pad-muted)",
      "--color-red-pen:#c0341d",
    ]) {
      expect(css).toContain(token);
    }
    expect(css).toMatch(/\.border-print\{border-color:var\(--color-print\)\}/);
  });

  it("marks every page noindex", () => {
    for (const route of ["", "01-thermal-resistance"]) {
      expect(build.page(route)).toContain('<meta name="robots" content="noindex, nofollow">');
    }
  });
});

describe("bad LaTeX fails the build with its file and line", () => {
  it("in a Summary beat (Markdown)", () => {
    const course = fixtureWith("modules/01-thermal-resistance/summary/1.md", (s) =>
      s.replace("(larger $L$)", "(larger $\\frac{L$)"),
    );
    const build = buildCourse(course);
    expect(build.ok).toBe(false);
    expect(build.output).toMatch(/modules\/01-thermal-resistance\/summary\/1\.md:25:\d+ bad LaTeX/);
  });

  it("in a Practice item (YAML)", () => {
    const course = fixtureWith("modules/01-thermal-resistance/practice/1.yaml", (s) =>
      s.replace("$600\\ \\text{K}$", "$600\\ \\txet{K}$"),
    );
    const build = buildCourse(course);
    expect(build.ok).toBe(false);
    expect(build.output).toMatch(
      /modules\/01-thermal-resistance\/practice\/1\.yaml:4:\d+ bad LaTeX: Undefined control sequence: \\txet/,
    );
  });

  it("in a Worked example (JSON)", () => {
    const course = fixtureWith("modules/01-thermal-resistance/worked/1.json", (s) =>
      s.replace("\\\\approx 16.2", "\\\\approx{ 16.2"),
    );
    const build = buildCourse(course);
    expect(build.ok).toBe(false);
    expect(build.output).toMatch(/modules\/01-thermal-resistance\/worked\/1\.json:129:\d+ bad LaTeX/);
  });
});

describe("content that breaks the content contract fails the build", () => {
  it("names the file and the broken field", () => {
    const course = fixtureWith("modules/01-thermal-resistance/worked/1.json", (s) =>
      s.replace('["Brick", "0.20", "0.8", "0.25", "4.06"]', '["Brick", "0.20", "0.25", "4.06"]'),
    );
    const build = buildCourse(course);
    expect(build.ok).toBe(false);
    expect(build.output).toContain("modules/01-thermal-resistance/worked/1.json");
    expect(build.output).toContain("row has 4 cells; the table has 5 columns");
  });
});
