// Putting RDKit's 2D structure on a page: the SVG verbatim, minus the XML prolog and comments a page
// can't carry, labelled for a screen reader. The drawing itself is never touched, so the page holds
// exactly the bytes the build hashed.
import { escapeHtml } from "../math/katex.ts";

export function inlineSvg(svg: string, label: string): string {
  const body = svg
    .replace(/<\?xml[\s\S]*?\?>\s*/g, "")
    .replace(/<!--[\s\S]*?-->\s*/g, "")
    .trim();
  const opened = body.replace(/^<svg\b/, `<svg role="img" aria-label="${escapeHtml(label)}" class="structure-svg"`);
  if (opened === body) throw new Error("the structure isn't an SVG");
  return opened;
}
