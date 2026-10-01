// What no page's copy may show, read by both the rendered-page scan (the built HTML, islands'
// props included) and the live-page scan in the browser (the page as its scripts left it).

/** TeX that should have been typeset: a control sequence, `\(`/`\[` delimiters, or `$…$` with TeX in it. */
export const RAW_TEX = /\\[A-Za-z]+|\\[()[\]]|\$[^$]*[\\^_{}][^$]*\$/;

export interface CopyDefect {
  kind: "hollow-copy" | "garbled-number";
  /** How a finding names it, before "on the page". */
  what: string;
  pattern: RegExp;
}

/**
 * Copy that assumes a content shape (v1 shipped a hollow "0/0" score), placeholders that never
 * rendered, and numbers a script got wrong.
 */
export const COPY_DEFECTS: readonly CopyDefect[] = [
  { kind: "hollow-copy", what: "a hollow 0/0", pattern: /\b0\s*\/\s*0\b/ },
  { kind: "hollow-copy", what: "an unrendered {{placeholder}}", pattern: /\{\{[^{}]*\}\}/ },
  { kind: "hollow-copy", what: "an [object Object]", pattern: /\[object Object\]/ },
  { kind: "garbled-number", what: "a wrong number (NaN)", pattern: /\bNaN\b/ },
  {
    kind: "garbled-number",
    what: "a wrong number (floating-point noise)",
    pattern: /\b\d+\.\d*(?:0{6,}|9{6,})\d+\b|\b\d+\.\d{12,}\b/,
  },
];

/** A finding's quote of `text`: trimmed, one line, at most 60 characters. */
export const quote = (text: string) => `"${text.replace(/\s+/g, " ").trim().slice(0, 60)}"`;
