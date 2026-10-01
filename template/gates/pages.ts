// The rendered-page scan, per Module and per deploy: reads the built pages the way a student gets
// them (islands' props included) and blocks a KaTeX error span, raw TeX, prose set as a fraction,
// copy that assumes a content shape, and content braces that didn't render literally.
import { cpSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Element, ElementContent, Nodes } from "hast";
import { fromHtml } from "hast-util-from-html";
import { COLLECTIONS, moduleOf } from "../src/content/layout.ts";
import { readStructured, splitFrontmatter } from "../src/content/loaders.ts";
import { splitProse } from "../src/math/katex.ts";
import { TRAP_ROUTE } from "../src/trap/route.ts";
import { COPY_DEFECTS, quote, RAW_TEX } from "./copy-checks.ts";
import { courseFiles, courseWith, filesIn } from "./course-files.ts";
import type { Finding, Gate, GateInput } from "./runner.ts";

/** Elements whose text is not prose: KaTeX's own copy of each formula's source, scripts, styles. */
const NOT_PROSE = new Set(["annotation", "script", "style", "template"]);

const classesOf = (node: Element) => (node.properties.className as string[] | undefined) ?? [];

/** The built site the gate input names; a page gate can't run without one. */
function siteOf({ distDir }: GateInput): string {
  if (distDir === undefined) throw new Error("no built site given to scan (distDir)");
  if (!existsSync(distDir)) throw new Error(`the built site ${distDir} does not exist`);
  return distDir;
}

/** The built pages in scope: a Module's own route, or every page. Never the Trap page, whose defects are seeded. */
export function sitePages(input: GateInput) {
  const inScope = (entry: string) => input.module === undefined || entry.startsWith(`${input.module}/`);
  return filesIn(siteOf(input), "**/*.html", inScope)
    .map((page) => ({ route: `/${page.entry.replace(/(^|\/)index\.html$/, "$1")}`, ...page }))
    .filter((page) => page.route !== TRAP_ROUTE);
}

export const renderedPageScan: Gate = {
  id: "rendered-page-scan",
  checks:
    "no built page carries a KaTeX error, raw TeX, prose set as a fraction or hollow copy like 0/0, islands' props included; the content's braces render literally",
  points: ["module", "deploy"],
  async run(input) {
    const pages = sitePages(input);
    const coverage = { pages: pages.length, formulas: 0, islands: 0, fractions: 0, braces: 0 };
    const findings: Finding[] = [];
    /** Each page's text, to find the content's braces in. */
    const textOf = new Map<string, string>();
    for (const { route, path } of pages) {
      const block = (message: string) => findings.push({ outcome: "block", at: route, message });
      const texts: string[] = [];
      /** `formula`: the TeX of the formula being visited, if inside one. */
      const visit = (node: Nodes, formula: string | undefined): void => {
        if (node.type === "text") {
          texts.push(node.value);
          if (formula !== undefined) return;
          const raw = RAW_TEX.exec(node.value);
          if (raw) block(`raw TeX on the page: "${snippet(node.value, raw.index)}"`);
          for (const { what, pattern } of COPY_DEFECTS)
            if (pattern.test(node.value)) block(`${what} on the page: ${quote(node.value)}`);
          return;
        }
        if (node.type !== "element" && node.type !== "root") return;
        let inside = formula;
        if (node.type === "element") {
          if (NOT_PROSE.has(node.tagName)) return;
          const classes = classesOf(node);
          if (classes.includes("katex-error")) {
            const title = typeof node.properties.title === "string" ? `: ${node.properties.title}` : "";
            block(`a KaTeX error rendered on the page${title}`);
          }
          if (classes.includes("katex")) {
            coverage.formulas += 1;
            inside = sourceOf(node);
          }
          if (node.tagName === "mfrac") {
            coverage.fractions += 1;
            const word = proseIn(node);
            if (word) block(`prose set as a fraction: "${word}" in ${inside || "a formula"}`);
          }
          if (node.tagName === "astro-island") {
            coverage.islands += 1;
            for (const text of islandStrings(node, block)) visit(fromHtml(text, { fragment: true }), undefined);
          }
        }
        for (const child of node.children) visit(child, inside);
      };
      visit(fromHtml(readFileSync(path, "utf8")), undefined);
      textOf.set(route, texts.join(""));
    }

    // Braces written in the content's prose reach the page as braces, never eaten as markup.
    const spaced = (text: string) => text.replace(/\s+/g, " ");
    for (const { group, file, module } of contentBraces(input)) {
      coverage.braces += 1;
      const routes = module === undefined ? [...textOf.keys()] : [`/${module}/`];
      if (routes.some((route) => spaced(textOf.get(route) ?? "").includes(spaced(group)))) continue;
      findings.push({
        outcome: "block",
        at: routes[0] ?? file,
        message: `"${group}" in ${file} doesn't render literally on the page`,
      });
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
    {
      defect: "prose set as a fraction",
      plant: (good, scratch) =>
        siteWith(
          good,
          scratch,
          inMain(
            '<span class="katex"><math><semantics><mrow><mfrac><mrow><mi>P</mi><mi>l</mi><mi>a</mi><mi>y</mi><mi>e</mi><mi>r</mi></mrow><mi>n</mi></mfrac></mrow><annotation encoding="application/x-tex">\\frac{Player}{n}</annotation></semantics></math></span>',
          ),
        ),
    },
    {
      defect: "a hollow 0/0 score in a page's copy",
      plant: (good, scratch) => siteWith(good, scratch, inMain("<p>Practice: 0/0</p>")),
    },
    {
      defect: "a brace in the content's prose that didn't reach the page",
      plant: (good, scratch) =>
        courseWith(good, scratch, {
          "practice/900.yaml": [
            "kind: prose",
            "question: 'Planted: name the pair {hot face, cold face}.'",
            "model: 'Planted.'",
            "earns: ['Planted.']",
            "",
          ].join("\n"),
        }),
    },
  ],
};

/** The TeX a KaTeX formula was written as, from its MathML annotation. */
function sourceOf(katex: Element): string {
  let found = "";
  const visit = (node: Element) => {
    for (const child of node.children) {
      if (found || child.type !== "element") continue;
      if (child.tagName === "annotation") found = textIn(child);
      else visit(child);
    }
  };
  visit(katex);
  return found;
}

/**
 * A word set as variables in a fraction's numerator or denominator: four or more single Latin
 * letters in a row, mostly lower case, with a vowel ("Player 1 / Player 2" typeset as a fraction).
 * Products of variables (`\rho V A c`, `mgh`) and `\text{…}` word fractions pass.
 */
function proseIn(mfrac: Element): string | undefined {
  const looksLikeWord = (run: string) =>
    run.length >= 4 && (run.match(/[a-z]/g)?.length ?? 0) >= 3 && /[aeiouy]/i.test(run);
  for (const part of mfrac.children) {
    if (part.type !== "element") continue;
    let run = "";
    for (const leaf of [...leavesOf(part), undefined]) {
      const letter = leaf?.tagName === "mi" ? textIn(leaf) : "";
      if (/^[A-Za-z]$/.test(letter)) {
        run += letter;
        continue;
      }
      if (looksLikeWord(run)) return run;
      run = "";
    }
  }
  return undefined;
}

/** A MathML element's token elements, in reading order. */
function leavesOf(node: Element): Element[] {
  const children = node.children.filter((c): c is Element => c.type === "element");
  return children.length === 0 ? [node] : children.flatMap(leavesOf);
}

const textIn = (node: ElementContent): string =>
  node.type === "text" ? node.value : node.type === "element" ? node.children.map(textIn).join("") : "";

/** Every literal brace group (`{a, b}`) in the prose of the Course's content in scope. */
function contentBraces(input: GateInput): { group: string; file: string; module: string | undefined }[] {
  const found: { group: string; file: string; module: string | undefined }[] = [];
  for (const file of courseFiles(input)) {
    const source = readFileSync(file.path, "utf8");
    const strings: string[] = [];
    const collect = (value: unknown): void => {
      if (typeof value === "string") strings.push(value);
      else if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === "object") Object.values(value).forEach(collect);
    };
    try {
      if (COLLECTIONS[file.collection].format === "markdown") {
        const { frontmatter, body } = splitFrontmatter(source);
        if (frontmatter !== undefined) collect(readStructured(frontmatter, file.entry, () => {}));
        strings.push(body);
      } else collect(readStructured(source, file.entry, () => {}));
    } catch {
      continue; // content that can't be read is the content gates' to block
    }
    for (const text of strings) {
      const segments = splitProse(text);
      if (!Array.isArray(segments)) continue;
      for (const segment of segments) {
        if (segment.kind !== "text") continue;
        for (const [group] of segment.text.matchAll(/\{[^{}\n]*\}/g))
          found.push({ group, file: file.entry, module: moduleOf(file.entry) });
      }
    }
  }
  return found;
}

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

/** A scratch copy of the built site's pages and stylesheets. */
function copySite(good: GateInput, scratch: string): string {
  const distDir = join(scratch, "site");
  cpSync(siteOf(good), distDir, {
    recursive: true,
    filter: (src) => /\.(?:html|css)$/.test(src) || statSync(src).isDirectory(),
  });
  return distDir;
}

/** A scratch copy of the built site, with the first page changed by `edit`. */
export function siteWith(good: GateInput, scratch: string, edit: (page: string) => string): GateInput {
  const first = sitePages(good)[0];
  if (!first) throw new Error("no built page to plant a negative control in");
  const distDir = copySite(good, scratch);
  const path = join(distDir, first.entry);
  const page = readFileSync(path, "utf8");
  const edited = edit(page);
  if (edited === page) throw new Error(`${first.route} had nothing to plant a negative control in`);
  writeFileSync(path, edited);
  return { ...good, distDir };
}

/** A scratch copy of the built site with `css` added to the stylesheet the first page links. */
export function stylesheetWith(good: GateInput, scratch: string, css: string): GateInput {
  const first = sitePages(good)[0];
  if (!first) throw new Error("no built page to plant a negative control in");
  const href = /<link rel="stylesheet" href="(\/[^"]+)"/.exec(readFileSync(first.path, "utf8"))?.[1];
  if (!href) throw new Error(`${first.route} links no stylesheet to plant a negative control in`);
  const distDir = copySite(good, scratch);
  const path = join(distDir, href);
  writeFileSync(
    path,
    `${readFileSync(path, "utf8")}
${css}
`,
  );
  return { ...good, distDir };
}

/** An edit that plants `html` at the end of the page's `<main>`, the sheet. */
export const inMain = (html: string) => (page: string) => page.replace("</main>", `${html}</main>`);
