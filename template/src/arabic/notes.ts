// Arabic notes (CONTEXT.md): a Course whose Arabic-notes toggle is on can give a Summary beat or a
// Worked example step a note in Arabic, set right to left beside the English. In a line set right
// to left a number reorders ("−5" reads "5−", a phone number's groups swap), so every number and
// every formula in a note is isolated left to right. Pure: the pages and the island both use it.
import { escapeHtml, renderProse } from "../math/katex.ts";

/**
 * A number as a note writes it, kept left to right as one run. It is a sign (unless a letter or a
 * digit comes before it, so a dash glued to a word stays a dash, and `القيمة:−5` keeps its minus), a
 * decimal point where the number opens with one (`.5`, `−.25`), then digits with the separators of
 * decimals, thousands, dates, times, ranges (`−5–−3`) and phone numbers between them (spaces,
 * no-break, narrow and thin ones included, so `+20 100 123 4567` stays one run), and a percent
 * sign. It always ends on a digit or `%`, so a sentence's full stop stays outside it.
 */
export const NUMBER_RUN =
  /(?:(?<![\p{L}\p{N}])[+\-−±])?(?:(?<![\p{L}\p{N}.])\.)?\d(?:[\d.,:/+\-−– \u00A0\u2009\u202F]*\d)?%?/gu;

/** Plain note text as HTML, every number in it isolated left to right. */
export function isolateNumbers(raw: string): string {
  let html = "";
  let last = 0;
  for (const m of raw.matchAll(NUMBER_RUN)) {
    html += `${escapeHtml(raw.slice(last, m.index))}<span dir="ltr" class="ltr-number">${escapeHtml(m[0])}</span>`;
    last = m.index + m[0].length;
  }
  return html + escapeHtml(raw.slice(last));
}

const NOTE_PIECES = { text: isolateNumbers, math: (html: string) => `<span dir="ltr">${html}</span>` };

/**
 * An Arabic note's prose → HTML: paper math, each formula and number isolated left to right. The
 * loader already checked every formula, so a location is never needed here.
 */
export const arabicProse = (text: string) =>
  renderProse(text, () => ({ file: "<checked at load>", line: 0 }), undefined, NOTE_PIECES);
