// The mhchem canary: one fixed \ce formula the build sets through its own KaTeX, and the About page
// carries rendered. A second KaTeX (rehype-katex's own) doesn't know \ce and renders it as red text
// without failing the build, so the deploy checks the formula's MathML for what mhchem makes of it.
import { renderTex, type SourceLocation } from "./katex.ts";

/** A reversible half-reaction: an equilibrium arrow, a charge, a state symbol and an electron. */
export const CE_CANARY = String.raw`\ce{Cu^2+(aq) + 2e- <=> Cu(s)}`;
export const CANARY_AT: SourceLocation = { file: "src/math/canary.ts", line: 1 };

/** The canary as the build's KaTeX sets it. Throws a MathError when \ce is undefined. */
export const canaryHtml = () => renderTex(CE_CANARY, false, CANARY_AT);

/** What's wrong with a rendered canary, one problem each; [] when mhchem set it. */
export function canaryProblems(html: string): string[] {
  const problems: string[] = [];
  if (html.includes('class="katex-error"')) problems.push("KaTeX left an error span: the canary didn't render");
  if (html.includes('mathcolor="#cc0000"'))
    problems.push(
      "\\ce came out as red text: KaTeX doesn't know \\ce, so mhchem isn't loaded from the same KaTeX (rehype-katex's own KaTeX does this silently)",
    );
  const shown = html.replace(/<annotation[\s\S]*?<\/annotation>/g, "");
  if (shown.includes("\\ce")) problems.push("raw \\ce on the page");
  if (!/<mo[^>]*>⇌<\/mo>/.test(html)) problems.push("no equilibrium harpoon (⇌): mhchem didn't parse <=>");
  if (!/<msup>(?:(?!<\/msup>)[\s\S])*<mn>2<\/mn><mo>\+<\/mo>(?:(?!<\/msup>)[\s\S])*<\/msup>/.test(html))
    problems.push("no 2+ charge on Cu");
  if (!html.includes('<mi mathvariant="normal">C</mi><mi mathvariant="normal">u</mi>'))
    problems.push("Cu isn't set upright, as an element symbol is");
  return problems;
}
