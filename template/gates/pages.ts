// The rendered-page scan, per Module and per deploy: reads the built pages the way a student gets
// them and blocks any KaTeX error span or raw TeX that reached the page.
import { cpSync, existsSync, globSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Element, Nodes } from "hast";
import { fromHtml } from "hast-util-from-html";
import type { Finding, Gate, GateInput } from "./runner.ts";

/** Elements whose text is not prose: KaTeX's own copy of each formula's source, scripts, styles. */
const NOT_PROSE = new Set(["annotation", "script", "style", "template"]);

/** TeX that should have been typeset: a control sequence, `\(`/`\[` delimiters, or `$…$` with TeX in it. */
const RAW_TEX = /\\[A-Za-z]+|\\[()[\]]|\$[^$]*[\\^_{}][^$]*\$/;

const classesOf = (node: Element) => (node.properties.className as string[] | undefined) ?? [];

function sitePages({ distDir, module }: GateInput): { route: string; entry: string; path: string }[] {
  if (distDir === undefined) throw new Error("no built site given to scan (distDir)");
  if (!existsSync(distDir)) throw new Error(`the built site ${distDir} does not exist`);
  return globSync("**/*.html", { cwd: distDir })
    .map((entry) => entry.replace(/\\/g, "/"))
    .filter((entry) => module === undefined || entry.startsWith(`${module}/`))
    .sort()
    .map((entry) => ({ route: `/${entry.replace(/(^|\/)index\.html$/, "$1")}`, entry, path: join(distDir, entry) }));
}

export const renderedPageScan: Gate = {
  id: "rendered-page-scan",
  checks: "no built page carries a KaTeX error or raw TeX",
  points: ["module", "deploy"],
  async run(input) {
    const pages = sitePages(input);
    const findings: Finding[] = [];
    let formulas = 0;
    for (const { route, path } of pages) {
      const visit = (node: Nodes): void => {
        if (node.type === "text") {
          const raw = RAW_TEX.exec(node.value);
          if (raw)
            findings.push({
              outcome: "block",
              at: route,
              message: `raw TeX on the page: "${snippet(node.value, raw.index)}"`,
            });
          return;
        }
        if (node.type !== "element" && node.type !== "root") return;
        if (node.type === "element") {
          if (NOT_PROSE.has(node.tagName)) return;
          const classes = classesOf(node);
          if (classes.includes("katex-error")) {
            const title = typeof node.properties.title === "string" ? `: ${node.properties.title}` : "";
            findings.push({ outcome: "block", at: route, message: `a KaTeX error rendered on the page${title}` });
          }
          if (classes.includes("katex")) formulas += 1;
        }
        node.children.forEach(visit);
      };
      visit(fromHtml(readFileSync(path, "utf8")));
    }
    return { coverage: { pages: pages.length, formulas }, findings };
  },
  controls: [
    {
      defect: "a KaTeX error span on a page",
      plant: (good, scratch) =>
        siteWith(good, scratch, '<span class="katex-error" title="ParseError: planted">x</span>'),
    },
    {
      defect: "raw TeX left in a page's prose",
      plant: (good, scratch) =>
        siteWith(good, scratch, "<p>Planted: the rate is $\\dot{Q} = \\frac{\\Delta T}{R}$.</p>"),
    },
  ],
};

function snippet(text: string, at: number): string {
  const start = Math.max(0, at - 20);
  return `${start > 0 ? "…" : ""}${text
    .slice(start, at + 40)
    .replace(/\s+/g, " ")
    .trim()}${at + 40 < text.length ? "…" : ""}`;
}

/** A scratch copy of the built site's pages, with `html` planted at the end of the first page's `<main>`. */
function siteWith(good: GateInput, scratch: string, html: string): GateInput {
  const first = sitePages(good)[0];
  if (!first) throw new Error("no built page to plant a negative control in");
  const distDir = join(scratch, "site");
  cpSync(good.distDir ?? "", distDir, {
    recursive: true,
    filter: (src) => src.endsWith(".html") || statSync(src).isDirectory(),
  });
  const path = join(distDir, first.entry);
  const page = readFileSync(path, "utf8");
  if (!page.includes("</main>")) throw new Error(`${first.route} has no <main> to plant a negative control in`);
  writeFileSync(path, page.replace("</main>", `${html}</main>`));
  return { ...good, distDir };
}
