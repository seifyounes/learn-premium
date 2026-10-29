// The links-only gate, per Module and per deploy: PhET and Falstad appear only as credited plain
// links that open in a new tab. Never framed, embedded, loaded as a script or a stylesheet, or
// copied onto the site: each of those hands a visitor's browser to another site's code from inside a
// page of this one. Every link to them sits in a "Go further" list beside its makers' credit.
import { readFileSync } from "node:fs";
import type { Element, Nodes } from "hast";
import { fromHtml } from "hast-util-from-html";
import { linkOnlyHost } from "../src/content/links-only.ts";
import { allFiles } from "./course-files.ts";
import { inMain, sitePages, siteFilesWith, siteWith } from "./pages.ts";
import type { Finding, Gate } from "./runner.ts";

/** Elements that load or draw another site's page or code, and the attribute that names where from. */
const EMBEDDING: Record<string, "src" | "href" | "data"> = {
  iframe: "src",
  frame: "src",
  embed: "src",
  object: "data",
  script: "src",
  link: "href",
  img: "src",
  video: "src",
  audio: "src",
  source: "src",
};

/** A copy of a link-only site's own code on this site, by its path. */
const SELF_HOSTED_PATH = /phet|falstad/i;
/** A link-only site's own code, by what it says of itself. */
const SELF_HOSTED_BODY = /\bphet-io\b|phetsims/i;

/**
 * What a page's code says, without what its words say: every attribute, and the text of its scripts and
 * styles. A page may name "PhET-iO" in a sentence; only a copy of PhET's own code carries the name in its markup.
 */
function markupOf(node: Nodes): string {
  if (node.type === "text") return "";
  if (node.type !== "element") return "children" in node ? node.children.map(markupOf).join("\n") : "";
  const attributes = Object.entries(node.properties).map(([name, value]) => `${name}=${String(value)}`);
  const code = node.tagName === "script" || node.tagName === "style" ? textOf(node) : "";
  return [...attributes, code, ...node.children.map(markupOf)].join("\n");
}

const classesOf = (node: Element) => (node.properties.className as string[] | undefined) ?? [];
const textOf = (node: Nodes): string =>
  node.type === "text" ? node.value : "children" in node ? node.children.map(textOf).join("") : "";

/** The text of a built file that can carry PhET's code: a page's markup, a script's whole body. */
const codeOf = (entry: string, path: string): string =>
  entry.endsWith(".html") ? markupOf(fromHtml(readFileSync(path, "utf8"))) : readFileSync(path, "utf8");

export const linksOnly: Gate = {
  id: "links-only",
  checks:
    "PhET and Falstad appear only as credited plain links in a new tab: never framed, embedded, loaded or self-hosted",
  points: ["module", "deploy"],
  async run(input) {
    const pages = sitePages(input);
    const coverage = { pages: pages.length, links: 0, embeds: 0, files: 0 };
    const findings: Finding[] = [];
    for (const { route, path } of pages) {
      const block = (message: string) => findings.push({ outcome: "block", at: route, message });
      /** The `[data-further]` entry each node sits in, if any. */
      const visit = (node: Nodes, entry: Element | undefined): void => {
        if (node.type === "element") {
          const own = node.properties.dataFurther !== undefined ? node : entry;
          const attribute = EMBEDDING[node.tagName];
          if (attribute !== undefined) {
            const url = node.properties[attribute];
            if (typeof url === "string") {
              coverage.embeds += 1;
              const host = linkOnlyHost(url);
              if (host)
                block(
                  `<${node.tagName}> loads ${url}: ${host.site} appears only as a credited plain link in a new tab, never framed, embedded or loaded`,
                );
            }
          }
          const href = node.properties.href;
          if (node.tagName === "a" && typeof href === "string") {
            const host = linkOnlyHost(href);
            if (host) {
              coverage.links += 1;
              const rel = node.properties.rel;
              if (node.properties.target !== "_blank")
                block(`the link to ${href} doesn't open in a new tab: it needs target="_blank"`);
              if (!(Array.isArray(rel) ? rel : String(rel ?? "").split(/\s+/)).includes("noopener"))
                block(`the link to ${href} lacks rel="noopener"`);
              const credit = own?.children
                .flatMap((c) => (c.type === "element" ? [c] : []))
                .find((c) => classesOf(c).includes("further-credit"));
              if (!own || !credit || !textOf(credit).includes(host.credit))
                block(
                  `the link to ${href} carries no credit: it sits in a "Go further" list beside ${host.site}'s credit, ${host.credit}`,
                );
            }
          }
          for (const child of node.children) visit(child, own);
          return;
        }
        if (node.type === "root") for (const child of node.children) visit(child, entry);
      };
      visit(fromHtml(readFileSync(path, "utf8")), undefined);
    }

    // Nothing of theirs is copied onto the site: no file of that name, no page or script saying whose it is.
    const dist = input.distDir === undefined ? [] : allFiles(input.distDir);
    for (const file of dist) {
      coverage.files += 1;
      if (SELF_HOSTED_PATH.test(file.entry)) {
        findings.push({
          outcome: "block",
          at: `/${file.entry}`,
          message: `the built site holds ${file.entry}: PhET and Falstad are never self-hosted, only linked`,
        });
        continue;
      }
      if (/\.(?:html|js|mjs)$/.test(file.entry) && SELF_HOSTED_BODY.test(codeOf(file.entry, file.path)))
        findings.push({
          outcome: "block",
          at: `/${file.entry}`,
          message: `${file.entry} is a copy of PhET's own code: PhET and Falstad are never self-hosted, only linked`,
        });
    }
    return { coverage, findings };
  },
  controls: [
    {
      defect: "a PhET sim framed in an iframe",
      plant: (good, scratch) =>
        siteWith(
          good,
          scratch,
          inMain(
            '<iframe src="https://phet.colorado.edu/sims/html/concentration/latest/concentration_all.html"></iframe>',
          ),
        ),
    },
    {
      defect: "a PhET link that opens in the same tab",
      plant: (good, scratch) =>
        siteWith(
          good,
          scratch,
          inMain(
            '<ul><li data-further><a href="https://phet.colorado.edu/en/simulations/concentration">Concentration</a><span class="further-credit">PhET Interactive Simulations, University of Colorado Boulder, CC BY-NC 4.0</span></li></ul>',
          ),
        ),
    },
    {
      defect: "a PhET link with no credit",
      plant: (good, scratch) =>
        siteWith(
          good,
          scratch,
          inMain(
            '<ul><li data-further><a href="https://phet.colorado.edu/en/simulations/concentration" target="_blank" rel="noopener noreferrer">Concentration</a></li></ul>',
          ),
        ),
    },
    {
      defect: "a self-hosted PhET copy",
      plant: (good, scratch) =>
        siteFilesWith(good, scratch, { "phet/concentration_all.html": "<html><body data-phet-io></body></html>" }),
    },
    {
      defect: "a Falstad applet loaded as a script",
      plant: (good, scratch) =>
        siteWith(good, scratch, inMain('<script src="https://www.falstad.com/circuit/circuitjs.js"></script>')),
    },
    {
      defect: "a PhET sim framed by a protocol-relative src",
      plant: (good, scratch) =>
        siteWith(
          good,
          scratch,
          inMain('<iframe src="//phet.colorado.edu/sims/html/concentration/latest/concentration_all.html"></iframe>'),
        ),
    },
    {
      defect: "a PhET link to phet.colorado.edu. (trailing dot)",
      plant: (good, scratch) =>
        siteWith(
          good,
          scratch,
          inMain(
            '<ul><li data-further><a href="https://phet.colorado.edu./en/simulations/concentration" target="_blank" rel="noopener noreferrer">Concentration</a></li></ul>',
          ),
        ),
    },
  ],
};
