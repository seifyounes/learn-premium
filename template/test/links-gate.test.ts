// PhET (and Falstad) appear on a built page only as a credited plain link that opens in a new tab:
// Module 13's "Go further" list links PhET's Concentration simulation with PhET's credit and
// licence, and the links-only gate holds every page, and the built site, to that.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fromHtml } from "hast-util-from-html";
import type { Element, Nodes } from "hast";
import { linksOnly } from "../gates/links.ts";
import { pagesOf } from "../gates/pages.ts";
import { runControls } from "../gates/runner.ts";
import { buildCourse, FIXTURE_COURSE } from "./build-course";

const MODULE = "13-cell-potential";
const build = buildCourse(FIXTURE_COURSE);
const input = { contentDir: FIXTURE_COURSE, distDir: build.outDir };

const elements = (node: Nodes, tag: string): Element[] => [
  ...(node.type === "element" && node.tagName === tag ? [node] : []),
  ...("children" in node ? node.children.flatMap((c) => elements(c, tag)) : []),
];
const text = (node: Nodes): string =>
  node.type === "text" ? node.value : "children" in node ? node.children.map(text).join("") : "";

describe("the go-further link on the built page", () => {
  it("builds", () => {
    expect(build.ok, build.output).toBe(true);
  });

  it("Module 13's Go further link opens in a new tab with PhET's credit", () => {
    const page = fromHtml(build.page(MODULE));
    const aside = elements(page, "aside").find((a) =>
      (a.properties.className as string[] | undefined)?.includes("further"),
    );
    expect(aside).toBeDefined();
    const [link] = elements(aside as Element, "a");
    expect(link?.properties.href).toBe("https://phet.colorado.edu/en/simulations/concentration");
    expect(link?.properties.target).toBe("_blank");
    expect(link?.properties.rel).toEqual(expect.arrayContaining(["noopener"]));
    expect(text(link as Element)).toBe("Concentration");
    const credit = elements(aside as Element, "span").find((s) =>
      (s.properties.className as string[] | undefined)?.includes("further-credit"),
    );
    expect(text(credit as Element)).toBe("PhET Interactive Simulations, University of Colorado Boulder, CC BY-NC 4.0");
    // At the end of the Module, after Practice's place, and nothing of PhET is framed or loaded.
    expect(build.page(MODULE)).toContain("Go further");
    expect(build.page(MODULE)).not.toMatch(/<(?:iframe|embed|script)[^>]*phet/i);
    // A Module without links has no such list.
    expect(build.page("01-thermal-resistance")).not.toContain("Go further");
  });

  it("links-only passes the Fixture build", async () => {
    const result = await linksOnly.run(input);
    expect(result.findings).toEqual([]);
    expect(result.coverage.links).toBe(1);
    expect(result.coverage.pages).toBe(pagesOf(build.outDir).length);
    expect(result.coverage.files).toBeGreaterThan(100);
    expect(result.coverage.embeds).toBeGreaterThan(10);
  });

  it("names each way a PhET page could be put on the site", async () => {
    const found = async (control: number) => {
      const scratch = mkdtempSync(join(tmpdir(), "lp-links-"));
      try {
        const planted = (linksOnly.controls[control] as NonNullable<(typeof linksOnly.controls)[number]>).plant(
          input,
          scratch,
        );
        return (await linksOnly.run(planted)).findings.map((f) => f.message);
      } finally {
        rmSync(scratch, { recursive: true, force: true });
      }
    };
    const url = "https://phet.colorado.edu/en/simulations/concentration";
    expect(await found(0)).toEqual([
      "<iframe> loads https://phet.colorado.edu/sims/html/concentration/latest/concentration_all.html: PhET appears only as a credited plain link in a new tab, never framed, embedded or loaded",
    ]);
    expect(await found(1)).toEqual([
      `the link to ${url} doesn't open in a new tab: it needs target="_blank"`,
      `the link to ${url} lacks rel="noopener"`,
    ]);
    expect(await found(2)).toEqual([
      `the link to ${url} carries no credit: it sits in a "Go further" list beside PhET's credit, PhET Interactive Simulations, University of Colorado Boulder`,
    ]);
    expect(await found(3)).toEqual([
      "the built site holds phet/concentration_all.html: PhET and Falstad are never self-hosted, only linked",
    ]);
    expect(await found(4)).toEqual([
      "<script> loads https://www.falstad.com/circuit/circuitjs.js: Falstad appears only as a credited plain link in a new tab, never framed, embedded or loaded",
    ]);
  });

  it("links-only catches its five controls", async () => {
    const result = await runControls({ input, gates: [linksOnly] });
    expect(result.gates[0]?.positive).toBe("pass");
    expect(result.gates[0]?.controls.map((c) => `${c.caught ? "caught" : "MISSED"}: ${c.defect}`)).toEqual([
      "caught: a PhET sim framed in an iframe",
      "caught: a PhET link that opens in the same tab",
      "caught: a PhET link with no credit",
      "caught: a self-hosted PhET copy",
      "caught: a Falstad applet loaded as a script",
    ]);
    expect(result.ok).toBe(true);
  });
});
