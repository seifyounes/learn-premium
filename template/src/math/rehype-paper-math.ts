// Renders the math nodes remark-math leaves in Markdown (`code.language-math`) through the
// Paper Math step, in place of the stock rehype-katex (which renders bad LaTeX as a red span).
import type { Element, ElementContent, Root, RootContent } from "hast";
import { fromHtml } from "hast-util-from-html";
import type { VFile } from "vfile";
import { checkedTex, type OnFormula } from "./katex.ts";

export interface PaperMathOptions {
  /** Collect instead of throwing (see `OnFormula`). */
  onFormula?: OnFormula;
}

export default function rehypePaperMath({ onFormula }: PaperMathOptions = {}) {
  return (tree: Root, file: VFile) => {
    replaceMath(tree, file, onFormula);
  };
}

function replaceMath(parent: Root | Element, file: VFile, onFormula: OnFormula | undefined): void {
  parent.children = parent.children.flatMap((child: RootContent): RootContent[] => {
    if (child.type !== "element") return [child];
    const math = mathOf(child);
    if (!math) {
      replaceMath(child, file, onFormula);
      return [child];
    }
    const start = (math.node.position ?? child.position)?.start;
    const at = { file: (file.path || "<markdown>").replace(/\\/g, "/"), line: start?.line ?? 0, column: start?.column };
    const html = checkedTex(textOf(math.node), math.display, at, onFormula);
    return fromHtml(html, { fragment: true }).children as ElementContent[];
  });
}

function mathOf(node: Element): { node: Element; display: boolean } | undefined {
  const classes = (node.properties.className as string[] | undefined) ?? [];
  if (node.tagName === "code" && classes.includes("language-math")) {
    return { node, display: classes.includes("math-display") };
  }
  const only = node.children.length === 1 ? node.children[0] : undefined;
  if (node.tagName === "pre" && only?.type === "element") {
    const inner = mathOf(only);
    if (inner) return { node: inner.node, display: true };
  }
  return undefined;
}

function textOf(node: Element): string {
  return node.children.map((c) => (c.type === "text" ? c.value : c.type === "element" ? textOf(c) : "")).join("");
}
