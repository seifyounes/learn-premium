// The colour gates, per Module and per deploy. The pad gate: the Course's pad meets every contrast
// requirement once auto-fixed, and every built page wears it. The Red Hue Rule: nothing drawn onto
// the sheet except the red pen sits within 60° of its hue; framed tools keep their own reds. It
// reads every colour a page can paint with: its markup, its islands, and its stylesheets (inline
// in <head> or linked, component styles included).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Element, Nodes } from "hast";
import { fromHtml } from "hast-util-from-html";
import { parse } from "culori";
import { coursePad } from "../src/pads/course-pad.ts";
import { fightsRedPen, gapFromRedPen, oklchOf, RED_PEN, sameColour } from "../src/pads/colour.ts";
import { describeChange, padStyle } from "../src/pads/pad.ts";
import { inMain, islandStrings, sitePages, siteWith, stylesheetWith } from "./pages.ts";
import type { Finding, Gate } from "./runner.ts";

/** Every `property: value` in a style attribute or a stylesheet's rules, in order. */
function declarations(css: string): [property: string, value: string][] {
  return [...css.matchAll(/([\w-]+)\s*:\s*([^;{}]+)/g)].map((m) => [(m[1] ?? "").toLowerCase(), (m[2] ?? "").trim()]);
}

const htmlElement = (page: string) =>
  fromHtml(page).children.find((n): n is Element => n.type === "element" && n.tagName === "html");

export const padGate: Gate = {
  id: "pad",
  checks: "the Course's pad meets every contrast requirement once auto-fixed, and every built page wears it",
  points: ["module", "deploy"],
  async run(input) {
    const pad = coursePad(input.contentDir);
    const findings: Finding[] = pad.checks
      .filter((c) => !c.pass)
      .map((c) => ({
        outcome: "block",
        at: "course.yaml",
        message: `the auto-fix can't make pad ${pad.value} meet "${c.requirement}" (${c.measured})`,
      }));
    const wanted = declarations(padStyle(pad.slots));
    const pages = sitePages(input);
    if (pages.length === 0) throw new Error("no built page in scope to check the pad on");
    for (const { route, path } of pages) {
      const style = htmlElement(readFileSync(path, "utf8"))?.properties.style;
      const worn = new Map(declarations(typeof style === "string" ? style : ""));
      for (const [variable, value] of wanted) {
        const current = worn.get(variable);
        if (current !== undefined && (current === value || sameColour(current, value))) continue;
        const wears = worn.has(variable) ? `${variable}: ${worn.get(variable)}` : `no ${variable}`;
        findings.push({
          outcome: "block",
          at: route,
          message: `the page wears ${wears}; the Course's pad ${pad.value} has ${value}`,
        });
        break;
      }
    }
    return {
      coverage: { pads: 1, requirements: pad.checks.length, pages: pages.length },
      findings,
      fixes: pad.changes.map((c) => `course.yaml pad ${pad.value}: ${describeChange(c)}`),
    };
  },
  controls: [
    {
      defect: "a built page still wearing another pad's print",
      plant: (good, scratch) =>
        siteWith(good, scratch, (page) => page.replace(/--pad-print: #[0-9A-F]{6}/, "--pad-print: #C8461E")),
    },
  ],
};

/** SVG presentation attributes that paint (hast property names). */
const PAINT_ATTRIBUTES = ["fill", "stroke", "stopColor", "floodColor", "lightingColor", "color"] as const;
/** CSS properties that paint, custom properties included (a figure may pass its colour through one). */
const PAINT_PROPERTY =
  /^(?:--|color$|fill$|stroke$|stop-color$|flood-color$|lighting-color$|background|border|outline|text-decoration|text-emphasis|column-rule|caret-color$|accent-color$|box-shadow$|text-shadow$)/;
/** Colour syntaxes; words are kept only when culori reads them as a colour name. */
const COLOUR_TOKEN = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*\)|\b[a-z]+\b/gi;

/**
 * Every visible colour written in a paint value. `url(#red-arrow)` and `var(--color-red-pen)` name
 * no colour, and a fully transparent one (KaTeX's struts) draws nothing.
 */
function coloursIn(value: string): string[] {
  const bare = value.replace(/url\([^)]*\)/gi, " ").replace(/--[\w-]+/g, " ");
  return [...bare.matchAll(COLOUR_TOKEN)]
    .map((m) => m[0])
    .filter((token) => {
      const colour = parse(token);
      return colour !== undefined && colour.alpha !== 0;
    });
}

/** Elements that draw nothing onto the sheet. */
const NOT_DRAWN = new Set(["script", "template", "noscript"]);

/** A stylesheet's rules: each innermost block with the selector (or at-rule) in front of it. */
function cssRules(css: string): { selector: string; body: string }[] {
  return [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]*)\{([^{}]*)\}/g)].map((m) => ({
    selector: (m[1] ?? "").trim(),
    body: m[2] ?? "",
  }));
}

/** A rule scoped inside a framed tool, which keeps its own meaning colours. */
const inFramedTool = (selector: string) => /\[data-framed-tool\b/.test(selector);

export const redHueRule: Gate = {
  id: "red-hue-rule",
  checks: "no colour drawn onto the sheet sits within 60° of the red pen's hue, except the red pen itself",
  points: ["module", "deploy"],
  async run(input) {
    const pages = sitePages(input);
    const distDir = input.distDir ?? "";
    const coverage = { pages: pages.length, svgs: 0, islands: 0, stylesheets: 0, colours: 0 };
    const findings: Finding[] = [];
    // A stylesheet many pages link is judged once, and named in its finding.
    const judgedSheets = new Set<string>();
    for (const { route, path } of pages) {
      const findingAt = (at: string) => (message: string) => findings.push({ outcome: "block", at, message });
      const block = findingAt(route);
      const judge = (colour: string, where: string, report = block) => {
        coverage.colours += 1;
        if (sameColour(colour, RED_PEN)) return;
        const oklch = oklchOf(colour);
        if (!oklch || !fightsRedPen(oklch)) return;
        report(
          `${colour} (${where}) sits ${gapFromRedPen(oklch)?.toFixed(0)}° from the red pen's hue; the Red Hue Rule needs 60° or a grey`,
        );
      };
      const judgeCss = (css: string, where: string, report = block) => {
        // A style attribute is one rule's declarations; a stylesheet is rules.
        const rules = css.includes("{") ? cssRules(css) : [{ selector: "", body: css }];
        for (const { selector, body } of rules) {
          if (inFramedTool(selector)) continue;
          for (const [property, value] of declarations(body)) {
            if (PAINT_PROPERTY.test(property))
              for (const c of coloursIn(value)) judge(c, `${property} in ${where}`, report);
          }
        }
      };
      const judgeStylesheet = (href: string) => {
        if (judgedSheets.has(href)) return;
        judgedSheets.add(href);
        coverage.stylesheets += 1;
        const file = /^\/(?!\/)/.test(href) ? join(distDir, href.split(/[?#]/)[0] ?? "") : "";
        if (!file || !existsSync(file)) {
          block(
            `the page links the stylesheet ${href}, which the built site doesn't hold, so its colours can't be read`,
          );
          return;
        }
        judgeCss(readFileSync(file, "utf8"), `stylesheet ${href}`, findingAt(href));
      };
      const visit = (node: Nodes): void => {
        if (node.type === "element") {
          if (node.tagName === "link") {
            const rel = node.properties.rel;
            const href = node.properties.href;
            if (Array.isArray(rel) && rel.includes("stylesheet") && typeof href === "string") judgeStylesheet(href);
            return;
          }
          // A framed tool keeps its own meaning colours, reds included, inside its frame.
          if (NOT_DRAWN.has(node.tagName) || node.properties.dataFramedTool !== undefined) return;
          if (node.tagName === "svg") coverage.svgs += 1;
          for (const attribute of PAINT_ATTRIBUTES) {
            const value = node.properties[attribute];
            if (typeof value === "string")
              for (const c of coloursIn(value)) judge(c, `${attribute} on <${node.tagName}>`);
          }
          // `<html>` carries the pad's slots, which the pad gate checks; nothing there is drawn.
          if (typeof node.properties.style === "string" && node.tagName !== "html")
            judgeCss(node.properties.style, `<${node.tagName}>`);
          if (node.tagName === "style") {
            judgeCss(node.children.map((child) => (child.type === "text" ? child.value : "")).join(""), "<style>");
            return;
          }
          if (node.tagName === "astro-island") {
            coverage.islands += 1;
            for (const text of islandStrings(node, block)) visit(fromHtml(text, { fragment: true }));
          }
        }
        if (node.type === "element" || node.type === "root") node.children.forEach(visit);
      };
      visit(fromHtml(readFileSync(path, "utf8")));
    }
    return { coverage, findings };
  },
  controls: [
    {
      defect: "a sheet figure stroked in an orange within 60° of the red pen",
      plant: (good, scratch) =>
        siteWith(good, scratch, inMain('<svg viewBox="0 0 10 10"><path d="M0 0H10" stroke="#D9622B"/></svg>')),
    },
    {
      defect: "a sheet figure coloured red through a component stylesheet",
      plant: (good, scratch) => stylesheetWith(good, scratch, ".plot-line { stroke: #D9622B }"),
    },
    {
      defect: "a sheet figure filled red through its own <style>",
      plant: (good, scratch) =>
        siteWith(
          good,
          scratch,
          inMain('<svg viewBox="0 0 10 10"><style>.load { fill: red }</style><circle class="load" r="2"/></svg>'),
        ),
    },
  ],
};
