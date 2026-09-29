// The Logical Direction Rule (DESIGN.md): spacing, borders and positions use logical properties
// so a right-to-left page mirrors. This scan fails on any physical-direction utility or property
// in the template's source.
import { globSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PHYSICAL = [
  // Tailwind utilities: mt-4, -ml-2, pr-3, sm:pb-6, border-l, rounded-tr, left-0, text-right, …
  /(?<![\w-])-?(?:[a-z]+:)*(?:m|p|scroll-m|scroll-p)[tblr]-[\w[.]/,
  /(?<![\w-])(?:[a-z]+:)*border-[tblr](?:-|(?=[\s"'`]))/,
  /(?<![\w-])(?:[a-z]+:)*rounded-(?:[tblr]|tl|tr|bl|br)(?:-|(?=[\s"'`]))/,
  /(?<![\w-])-?(?:[a-z]+:)*(?:left|right|top|bottom)-[\w[.]/,
  /(?<![\w-])(?:[a-z]+:)*(?:text|float|clear)-(?:left|right)(?![\w-])/,
  // CSS properties
  /(?:margin|padding|border|scroll-margin|scroll-padding)-(?:left|right|top|bottom)\s*:/,
  /(?<![\w-])(?:left|right|top|bottom)\s*:/,
  /(?:text-align|float|clear)\s*:\s*(?:left|right)/,
];

function physicalDirections(source: string): string[] {
  return source
    .split("\n")
    .flatMap((line, i) => PHYSICAL.map((p) => p.exec(line)).flatMap((m) => (m ? [`${i + 1}: ${m[0]}`] : [])));
}

describe("the Logical Direction Rule", () => {
  it("catches physical directions (negative control)", () => {
    for (const bad of [
      '<div class="mt-4">',
      '<div class="sm:pl-6">',
      '<div class="border-r border-print">',
      '<div class="rounded-tl-sm">',
      '<div class="absolute left-0">',
      '<p class="text-right">',
      "margin-left: 4px;",
      "  top: 0;",
      "text-align: left;",
    ]) {
      expect(physicalDirections(bad), bad).not.toEqual([]);
    }
    for (const good of [
      '<div class="ms-4 pbs-2 border-s rounded-sheet inset-s-0 text-start">',
      "margin-inline-start: 4px;",
    ]) {
      expect(physicalDirections(good), good).toEqual([]);
    }
  });

  it("holds across the template's source", () => {
    const src = resolve(import.meta.dirname, "../src");
    const findings = globSync("**/*.{astro,ts,tsx,css}", { cwd: src }).flatMap((file) =>
      physicalDirections(readFileSync(join(src, file), "utf8")).map((f) => `${file}:${f}`),
    );
    expect(findings).toEqual([]);
  });
});
