// The Markdown processor every Summary beat goes through: remark-math finds the math, and the
// Paper Math step renders it. The build and the KaTeX gate share it, so the gate checks exactly
// the math the build renders.
import { unified } from "@astrojs/markdown-remark";
import remarkMath from "remark-math";
import rehypePaperMath, { type PaperMathOptions } from "./rehype-paper-math.ts";

export const paperMathProcessor = (options: PaperMathOptions = {}) =>
  unified({ remarkPlugins: [remarkMath], rehypePlugins: [[rehypePaperMath, options]] });
