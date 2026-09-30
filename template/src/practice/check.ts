// Auto-checks a Practice item's numeric answer: the number the student typed, within the item's
// tolerance. Pure, so the island is a thin view over it.

/** A decimal written with a point, or a comma where a hand writes one (9,6); thousands grouped by
 *  a comma or a space (9,600 or 9 600); then an optional power of ten (e3, × 10^3). */
const NUMBER =
  /^([+\-−]?)(\d{1,3}(?:[ ,]\d{3})+(?:\.\d+)?|\d+(?:[.,]\d+)?|[.,]\d+)(?:\s*(?:[eE]|[×xX*]\s*10\s*\^)\s*([+\-−]?\d+))?/;
/** What may follow the number: a unit the student adds, never another number. */
const UNIT = /^\s*[^\d\s.,][^\d]*$/;

/** The one number a student typed, read the ways a hand writes it; undefined if there isn't one. */
export function readNumber(input: string): number | undefined {
  const text = input.trim();
  const match = NUMBER.exec(text);
  if (!match) return undefined;
  const rest = text.slice(match[0].length);
  if (rest !== "" && !UNIT.test(rest)) return undefined;
  const [, sign = "", digits = "", power] = match;
  // A lone comma with three digits after it groups thousands; with any other count it is a decimal.
  const grouped = /^\d{1,3}(?:[ ,]\d{3})+(?:\.\d+)?$/.test(digits);
  const plain = grouped ? digits.replace(/[ ,]/g, "") : digits.replace(",", ".");
  const value = Number(`${plain}${power === undefined ? "" : `e${power.replace("−", "-")}`}`);
  if (!Number.isFinite(value)) return undefined;
  return sign === "-" || sign === "−" ? -value : value;
}

export type NumericResult = "right" | "wrong" | "unreadable";

/** Right within the tolerance (its edges included), allowing only float noise beyond it. */
export function checkNumeric(input: string, answer: { value: number; tolerance: number }): NumericResult {
  const typed = readNumber(input);
  if (typed === undefined) return "unreadable";
  const noise = 1e-9 * Math.max(1, Math.abs(answer.value));
  return Math.abs(typed - answer.value) <= answer.tolerance + noise ? "right" : "wrong";
}
