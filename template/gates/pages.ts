// The rendered-page scan, per Module and per deploy: reads the built pages the way a student gets
// them and blocks any KaTeX error span or raw TeX that reached the page.
import { cpSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Element, Nodes } from "hast";
import { fromHtml } from "hast-util-from-html";
import { filesIn } from "./course-files.ts";
import type { Finding, Gate, GateInput } from "./runner.ts";

/** Elements whose text is not prose: KaTeX's own copy of each formula's source, scripts, styles. */
const NOT_PROSE = new Set(["annotation", "script", "style", "template"]);

/** TeX that should have been typeset: a control sequence, `\(`/`\[` delimiters, or `$…$` with TeX in it. */
const RAW_TEX = /\\[A-Za-z]+|\\[()[\]]|\$[^$]*[\\^_{}][^$]*\$/;

const classesOf = (node: Element) => (node.properties.className as string[] | undefined) ?? [];

/** The built site the gate input names; a page gate can't run without one. */
export function siteOf({ distDir }: GateInput): string {
  if (distDir === undefined) throw new Error("no built site given to scan (distDir)");
  if (!existsSync(distDir)) throw new Error(`the built site ${distDir} does not exist`);
  return distDir;
}

/** The built pages in scope: a Module's own route, or every page. */
export function sitePages(input: GateInput) {
  const inScope = (entry: string) => input.module === undefined || entry.startsWith(`${input.module}/`);
  return filesIn(siteOf(input), "**/*.html", inScope).map((page) => ({
    route: `/${page.entry.replace(/(^|\/)index\.html$/, "$1")}`,
    ...page,
  }));
}

export const renderedPageScan: Gate = {
  id: "rendered-page-scan",
  checks: "no built page carries a KaTeX error or raw TeX, islands' props included",
  points: ["module", "deploy"],
  async run(input) {
    const pages = sitePages(input);
    const coverage = { pages: pages.length, formulas: 0, islands: 0 };
    const findings: Finding[] = [];
    for (const { route, path } of pages) {
      const block = (message: string) => findings.push({ outcome: "block", at: route, message });
      const visit = (node: Nodes): void => {
        if (node.type === "text") {
          const raw = RAW_TEX.exec(node.value);
          if (raw) block(`raw TeX on the page: "${snippet(node.value, raw.index)}"`);
          return;
        }
        if (node.type !== "element" && node.type !== "root") return;
        if (node.type === "element") {
          if (NOT_PROSE.has(node.tagName)) return;
          const classes = classesOf(node);
          if (classes.includes("katex-error")) {
            const title = typeof node.properties.title === "string" ? `: ${node.properties.title}` : "";
            block(`a KaTeX error rendered on the page${title}`);
          }
          if (classes.includes("katex")) coverage.formulas += 1;
          if (node.tagName === "astro-island") {
            coverage.islands += 1;
            for (const text of islandStrings(node, block)) visit(fromHtml(text, { fragment: true }));
          }
        }
        node.children.forEach(visit);
      };
      visit(fromHtml(readFileSync(path, "utf8")));
    }
    return { coverage, findings };
  },
  controls: [
    {
      defect: "a KaTeX error span on a page",
      plant: (good, scratch) =>
        siteWith(good, scratch, inMain('<span class="katex-error" title="ParseError: planted">x</span>')),
    },
    {
      defect: "raw TeX left in a page's prose",
      plant: (good, scratch) =>
        siteWith(good, scratch, inMain("<p>Planted: the rate is $\\dot{Q} = \\frac{\\Delta T}{R}$.</p>")),
    },
    {
      defect: "a KaTeX error inside an island's props, where a hidden answer waits",
      plant: (good, scratch) =>
        siteWith(
          good,
          scratch,
          inMain(
            '<astro-island props="{&quot;modelHtml&quot;:[0,&quot;&lt;span class=\\&quot;katex-error\\&quot;&gt;x&lt;/span&gt;&quot;]}"></astro-island>',
          ),
        ),
    },
  ],
};

/**
 * Every string in an island's serialised props: what the island renders once it hydrates. A
 * Practice item's model answer reaches the page only this way, never in the page's own markup.
 */
export function islandStrings(island: Element, block: (message: string) => void): string[] {
  const props = island.properties.props;
  if (typeof props !== "string") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(props);
  } catch {
    block("an island's props can't be read, so what it renders can't be scanned");
    return [];
  }
  const strings: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === "string") strings.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(parsed);
  return strings;
}

function snippet(text: string, at: number): string {
  const start = Math.max(0, at - 20);
  return `${start > 0 ? "…" : ""}${text
    .slice(start, at + 40)
    .replace(/\s+/g, " ")
    .trim()}${at + 40 < text.length ? "…" : ""}`;
}

/** A scratch copy of the built site's pages, with the first page changed by `edit`. */
export function siteWith(good: GateInput, scratch: string, edit: (page: string, route: string) => string): GateInput {
  const first = sitePages(good)[0];
  if (!first) throw new Error("no built page to plant a negative control in");
  const distDir = join(scratch, "site");
  cpSync(siteOf(good), distDir, {
    recursive: true,
    filter: (src) => src.endsWith(".html") || statSync(src).isDirectory(),
  });
  const path = join(distDir, first.entry);
  const page = readFileSync(path, "utf8");
  const edited = edit(page, first.route);
  if (edited === page) throw new Error(`${first.route} had nothing to plant a negative control in`);
  writeFileSync(path, edited);
  return { ...good, distDir };
}

/** An edit that plants `html` at the end of the page's `<main>`, the sheet. */
export const inMain = (html: string) => (page: string) => page.replace("</main>", `${html}</main>`);
