// The mhchem canary: a fixed \ce formula the build sets through its own KaTeX, and the About page
// carries rendered. KaTeX's contrib mhchem must come from the same KaTeX the build renders with; a
// second copy (rehype-katex's own) renders \ce as red "undefined command" text without failing, so
// the deploy checks the formula's MathML for what mhchem makes of it.
import { describe, expect, it } from "vitest";
import katex from "katex";
import { mhchemCanary } from "../gates/canary.ts";
import { runControls } from "../gates/runner.ts";
import { CANARY_AT, CE_CANARY, canaryHtml, canaryProblems } from "../src/math/canary.ts";
import { renderTex } from "../src/math/katex.ts";
import { buildCourse, FIXTURE_COURSE } from "./build-course";

describe("the mhchem canary", () => {
  it("the canary renders through the build's KaTeX with mhchem", () => {
    const html = canaryHtml();
    expect(canaryProblems(html)).toEqual([]);
    // The equilibrium harpoon, the 2+ charge as a superscript, and an upright Cu.
    expect(html).toMatch(/<mo[^>]*>⇌<\/mo>/);
    expect(html).toMatch(/<msup>[\s\S]*?<mn>2<\/mn><mo>\+<\/mo>[\s\S]*?<\/msup>/);
    expect(html).toContain('<mi mathvariant="normal">C</mi><mi mathvariant="normal">u</mi>');
  });

  it("canaryProblems sees an undefined \\ce, an error span and a plain-text arrow", () => {
    // KaTeX's own output for a command it doesn't know: red text, no error thrown.
    const undefinedCe = katex.renderToString(CE_CANARY.replace("\\ce", "\\cee"), { throwOnError: false });
    expect(canaryProblems(undefinedCe)).toEqual([
      expect.stringMatching(/came out as red text/),
      "raw \\ce on the page",
      expect.stringMatching(/no equilibrium harpoon/),
      expect.stringMatching(/no 2\+ charge on Cu/),
      expect.stringMatching(/Cu isn't set upright/),
    ]);

    const errorSpan = '<span class="katex-error" title="ParseError: planted">x</span>';
    expect(canaryProblems(errorSpan)[0]).toBe("KaTeX left an error span: the canary didn't render");

    // The same species written as plain TeX: the arrow is never parsed into a harpoon.
    const plainArrow = renderTex(String.raw`\mathrm{Cu}^{2+}(aq) + 2e^- <=> \mathrm{Cu}(s)`, false, CANARY_AT);
    expect(canaryProblems(plainArrow)).toEqual([expect.stringMatching(/^no equilibrium harpoon/)]);
  });
});

describe("the mhchem-canary deploy gate on the Fixture Course's production build", () => {
  const build = buildCourse(FIXTURE_COURSE, { VERCEL_ENV: "production" });
  const input = { contentDir: FIXTURE_COURSE, distDir: build.outDir };

  it("the deploy gate passes the Fixture production build", async () => {
    expect(build.ok, build.output).toBe(true);
    const result = await mhchemCanary.run(input);
    expect(result.findings).toEqual([]);
    expect(result.coverage).toEqual({ renders: 2, pages: 1 });
  });

  it("mhchem-canary catches its three controls", async () => {
    const result = await runControls({ input, gates: [mhchemCanary] });
    expect(result.gates[0]?.controls.map((c) => `${c.caught ? "caught" : "MISSED"}: ${c.defect}`)).toEqual([
      "caught: a deploy whose About page lost its \\ce canary",
      "caught: a canary set by a KaTeX that doesn't know \\ce",
      "caught: a canary whose arrow mhchem never parsed",
    ]);
    expect(result.ok).toBe(true);
  });
});
