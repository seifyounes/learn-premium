// A Module's Summary is at most five short beats, each around one figure, so it never becomes a
// text wall. The teaching-method gate holds every Module to these limits.
import { splitProse } from "../math/katex.ts";

export const MAX_BEATS = 5;
export const MAX_BEAT_WORDS = 90;

/**
 * The words a reader reads in a beat's Markdown body. A formula, inline or display, reads as one
 * word; Markdown's own marks (headings, emphasis, list numbers, link targets) aren't words.
 */
export function beatWords(body: string): number {
  const segments = splitProse(body);
  const text = Array.isArray(segments)
    ? segments.map((s) => (s.kind === "text" ? s.text : " formula ")).join("")
    : body;
  const words = text
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/\]\([^)]*\)/g, "] ")
    .replace(/^[ \t]*(?:\d+[.)]|[-*+>]|#{1,6})[ \t]/gm, " ")
    .split(/\s+/)
    .filter((token) => /[\p{L}\p{N}]/u.test(token));
  return words.length;
}
