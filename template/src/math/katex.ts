// The Paper Math step: every piece of math in a Course is rendered here, at build, by KaTeX.
// Bad LaTeX never reaches a page: it throws a MathError naming the file and line it came from.
import katex from "katex";
import "katex/contrib/mhchem";

export interface SourceLocation {
  file: string;
  line: number;
  column?: number | undefined;
}

export class MathError extends Error {
  constructor(
    readonly at: SourceLocation,
    readonly tex: string,
    reason: string,
  ) {
    const where = at.column === undefined ? `${at.file}:${at.line}` : `${at.file}:${at.line}:${at.column}`;
    super(`${where} bad LaTeX: ${reason}\n  in: ${tex}`);
    this.name = "MathError";
  }
}

export function renderTex(tex: string, displayMode: boolean, at: SourceLocation): string {
  try {
    return katex.renderToString(tex, { displayMode, throwOnError: true, strict: "error", output: "htmlAndMathml" });
  } catch (error) {
    const reason = error instanceof katex.ParseError ? error.rawMessage : String(error);
    throw new MathError(at, tex, reason);
  }
}

export type ProseSegment =
  { kind: "text"; text: string } | { kind: "math"; tex: string; display: boolean; offset: number };

/**
 * Splits a prose string into text and math. `$$…$$` is display math, `$…$` inline math, and
 * `\$` a literal dollar sign. An unclosed `$` is an error, not text.
 */
export function splitProse(text: string): ProseSegment[] | { unclosedAt: number } {
  const segments: ProseSegment[] = [];
  let plain = "";
  let i = 0;
  while (i < text.length) {
    if (text.startsWith("\\$", i)) {
      plain += "$";
      i += 2;
      continue;
    }
    if (text[i] !== "$") {
      plain += text[i];
      i += 1;
      continue;
    }
    const display = text.startsWith("$$", i);
    const fence = display ? "$$" : "$";
    const start = i + fence.length;
    const end = findClosing(text, fence, start);
    if (end === -1) return { unclosedAt: i };
    if (plain) segments.push({ kind: "text", text: plain });
    plain = "";
    segments.push({ kind: "math", tex: text.slice(start, end).trim(), display, offset: start });
    i = end + fence.length;
  }
  if (plain) segments.push({ kind: "text", text: plain });
  return segments;
}

function findClosing(text: string, fence: string, from: number): number {
  for (let j = from; j < text.length; j++) {
    if (text[j] === "\\") {
      j += 1;
      continue;
    }
    if (text.startsWith(fence, j)) return j;
  }
  return -1;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Renders one prose field (plain text with math) to HTML. `locate` maps an offset in the string
 * back to where it sits in the source file, so an error names the real line.
 */
export function renderProse(text: string, locate: (offset: number) => SourceLocation): string {
  const segments = splitProse(text);
  if (!Array.isArray(segments)) {
    throw new MathError(locate(segments.unclosedAt), text.slice(segments.unclosedAt), "unclosed $");
  }
  return segments
    .map((s) => (s.kind === "text" ? escapeHtml(s.text) : renderTex(s.tex, s.display, locate(s.offset))))
    .join("");
}
