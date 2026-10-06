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
  readonly at: SourceLocation;
  readonly tex: string;
  readonly reason: string;

  constructor(at: SourceLocation, tex: string, reason: string) {
    super(`${where(at)} bad LaTeX: ${reason}\n  in: ${tex}`);
    this.name = "MathError";
    this.at = at;
    this.tex = tex;
    this.reason = reason;
  }
}

/** `file:line[:column]`, the way every error names a place in a Course's source. */
export const where = (at: SourceLocation) =>
  at.column === undefined ? `${at.file}:${at.line}` : `${at.file}:${at.line}:${at.column}`;

/**
 * Called once per formula, with its error if it has one. Given one, the math step collects instead
 * of throwing: a bad formula renders as nothing and the rest carry on (the KaTeX gate's mode).
 */
export type OnFormula = (error: MathError | undefined) => void;

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

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** How a prose field's pieces become HTML: its plain text, and each formula as KaTeX rendered it. */
export interface ProsePieces {
  text(raw: string): string;
  math(html: string): string;
}
const PLAIN: ProsePieces = { text: escapeHtml, math: (html) => html };

/**
 * Renders one prose field (plain text with math) to HTML. `locate` maps an offset in the string
 * back to where it sits in the source file, so an error names the real line. `pieces` changes how
 * its text and its formulas are set (an Arabic note isolates its numbers and formulas).
 */
export function renderProse(
  text: string,
  locate: (offset: number) => SourceLocation,
  onFormula?: OnFormula,
  pieces: ProsePieces = PLAIN,
): string {
  const segments = splitProse(text);
  if (!Array.isArray(segments)) {
    const error = new MathError(locate(segments.unclosedAt), text.slice(segments.unclosedAt), "unclosed $");
    if (!onFormula) throw error;
    onFormula(error);
    return "";
  }
  let html = "";
  let carried = "";
  for (const [i, s] of segments.entries()) {
    if (s.kind === "text") {
      html += pieces.text(s.text.slice(carried.length));
      carried = "";
      continue;
    }
    const tex = checkedTex(s.tex, s.display, locate(s.offset), onFormula);
    const math = tex && pieces.math(tex);
    // Punctuation written straight after inline math stays on its line, as it would on paper.
    const next = segments[i + 1];
    carried = (!s.display && next?.kind === "text" && TRAILING_PUNCTUATION.exec(next.text)?.[0]) || "";
    html += carried ? `<span class="whitespace-nowrap">${math}${pieces.text(carried)}</span>` : math;
  }
  return html;
}

const TRAILING_PUNCTUATION = /^[.,;:!?)\]]+/;

/** `renderTex`, but with `onFormula` given a bad formula is reported and renders as nothing. */
export function checkedTex(tex: string, displayMode: boolean, at: SourceLocation, onFormula?: OnFormula): string {
  if (!onFormula) return renderTex(tex, displayMode, at);
  try {
    const html = renderTex(tex, displayMode, at);
    onFormula(undefined);
    return html;
  } catch (error) {
    if (!(error instanceof MathError)) throw error;
    onFormula(error);
    return "";
  }
}
