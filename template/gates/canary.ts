// The mhchem canary, per deploy: the build's own KaTeX sets a fixed \ce formula through mhchem, and
// the deployed About page carries it rendered. A KaTeX without mhchem renders \ce as red text and
// fails nothing, so every deploy looks at the formula's MathML for what mhchem makes of it.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import katex from "katex";
import { CANARY_AT, CE_CANARY, canaryHtml, canaryProblems } from "../src/math/canary.ts";
import { MathError, renderTex } from "../src/math/katex.ts";
import { copySite, sitePages } from "./pages.ts";
import type { Finding, Gate, GateInput } from "./runner.ts";

const ABOUT = "/about/";
/** The canary as the About page carries it: inert markup, never shown. */
const CARRIED = /(<template\b[^>]*\bdata-ce-canary\b[^>]*>)([\s\S]*?)(<\/template>)/;

/** A scratch copy of the built site whose About page's canary is changed by `edit`. */
function aboutWith(good: GateInput, scratch: string, edit: (page: string) => string): GateInput {
  const about = sitePages(good).find((page) => page.route === ABOUT);
  if (!about) throw new Error("no built About page to plant a negative control in");
  const distDir = copySite(good, scratch);
  const path = join(distDir, about.entry);
  const page = readFileSync(path, "utf8");
  const edited = edit(page);
  if (edited === page) throw new Error("the About page had nothing to plant a negative control in");
  writeFileSync(path, edited);
  return { ...good, distDir };
}

const carrying = (html: string) => (page: string) =>
  page.replace(CARRIED, (_all, open, _body, close) => `${open}${html}${close}`);

export const mhchemCanary: Gate = {
  id: "mhchem-canary",
  checks: "the build's KaTeX sets a \\ce canary through mhchem, and the deployed About page carries it rendered",
  points: ["deploy"],
  async run(input) {
    const findings: Finding[] = [];
    const block = (at: string, message: string) => findings.push({ outcome: "block", at, message });
    const coverage = { renders: 0, pages: 0 };

    // 1. The build's own KaTeX.
    try {
      coverage.renders += 1;
      for (const problem of canaryProblems(canaryHtml())) block(CANARY_AT.file, problem);
    } catch (error) {
      if (!(error instanceof MathError)) throw error;
      block(
        CANARY_AT.file,
        `the build's KaTeX can't set \\ce (${error.reason}): import katex/contrib/mhchem from the KaTeX the build renders with`,
      );
    }

    // 2. The deployed copy.
    const about = sitePages(input).find((page) => page.route === ABOUT);
    if (!about) throw new Error(`the built site has no ${ABOUT} page: the canary gate didn't run`);
    coverage.pages += 1;
    const carried = CARRIED.exec(readFileSync(about.path, "utf8"));
    if (!carried) block(ABOUT, "the About page carries no \\ce canary");
    else {
      coverage.renders += 1;
      for (const problem of canaryProblems(carried[2] ?? "")) block(ABOUT, problem);
    }
    return { coverage, findings };
  },
  controls: [
    {
      defect: "a deploy whose About page lost its \\ce canary",
      plant: (good, scratch) => aboutWith(good, scratch, (page) => page.replace(CARRIED, "")),
    },
    {
      defect: "a canary set by a KaTeX that doesn't know \\ce",
      // KaTeX's own output for a command it doesn't know: red text, and no error.
      plant: (good, scratch) =>
        aboutWith(
          good,
          scratch,
          carrying(katex.renderToString(CE_CANARY.replace("\\ce", "\\cee"), { throwOnError: false })),
        ),
    },
    {
      defect: "a canary whose arrow mhchem never parsed",
      plant: (good, scratch) =>
        aboutWith(
          good,
          scratch,
          carrying(renderTex(String.raw`\mathrm{Cu}^{2+}(aq) + 2e^- <=> \mathrm{Cu}(s)`, false, CANARY_AT)),
        ),
    },
  ],
};
