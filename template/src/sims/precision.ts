// Numbers at the sheet's printed precision. A sheet value printed with d decimals agrees with a
// computed one when the computed value, rounded to d decimals, is within 1 of it in the last
// printed digit: a hand may round the last digit either way. Pure: the number gate uses it, and a
// sim's table prints the sheet's way with `printAt` (`print.ts`).
import { numbersIn } from "../provenance/values.ts";

export { printAt } from "./print.ts";

export interface Printed {
  value: number;
  /** Decimals as printed: "0.4700" has 4, "12" has 0. */
  decimals: number;
  /** The number as the sheet writes it, sign included. */
  written: string;
}

/** The one number a sheet cell prints, or why it isn't one. */
export function readPrinted(cell: string): Printed | string {
  const text = cell.replace(/\$/g, "").trim();
  if (text === "") return "the cell is blank";
  const scientific = readScientific(text);
  if (scientific !== null) return scientific;
  const found = numbersIn(cell);
  if (found.length === 0) return "the cell holds no number";
  if (found.length > 1)
    return `the cell holds ${found.length} numbers (${found.map((n) => n.written).join(", ")}), not one`;
  const [number] = found as [(typeof found)[number]];
  // The sign is the one just before the number, at the start or after a label's `=` (`R = -0.04`);
  // a minus inside a subscript (`x_{-1}`) belongs to the label. TeX spacing (`-\,0.04`) may sit between.
  // A minus before a grouped value (`-(0.04)`, `-\left(0.04\right)`, `-{0.04}`) applies to it.
  const space = String.raw`(?:\s|\\[,;:! ]|~)*`;
  const opens = String.raw`(?:(?:\\left)?\(|\{)?`;
  const sign = new RegExp(
    `(?:^|[=(:≈]|\\\\approx)${space}([-−])${space}${opens}${space}${escaped(number.written)}(?![\\d.])`,
  ).exec(text)?.[1];
  return {
    value: sign === undefined ? number.value : -number.value,
    decimals: (number.written.split(".")[1] ?? "").length,
    written: `${sign ?? ""}${number.written}`,
  };
}

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A value in scientific notation (`4.0 \times 10^{-2}`, `R = 2 \cdot 10^5`): one number, printed to
 * the mantissa's last digit times the power, so `4.0 \times 10^{-2}` has 3 decimals and
 * `1.25 \times 10^{3}` has −1 (tens). Null when the cell isn't written that way.
 */
function readScientific(text: string): Printed | null {
  const match =
    /(?:^|=)\s*(([-−]?)\s*(\d+(?:\.(\d+))?)\s*(?:\\times|\\cdot|×)\s*10\s*\^\s*\{?\s*([-−]?\d+)\s*\}?)\s*$/.exec(text);
  if (!match) return null;
  const [, written = "", sign = "", mantissa = "", places = "", power = ""] = match;
  const exponent = Number(power.replace("−", "-"));
  const magnitude = Number(`${mantissa}e${exponent}`);
  return { value: sign === "" ? magnitude : -magnitude, decimals: places.length - exponent, written: written.trim() };
}

/**
 * The magnitudes a ruling's value names (a Slip's `sheet`, a Divergence's `value`), matched against
 * sheet cells read by `readPrinted`: one value in scientific notation counts as one number.
 */
export function rulingValues(written: string): number[] {
  const scientific = readScientific(written.replace(/\$/g, "").trim());
  return scientific !== null ? [Math.abs(scientific.value)] : numbersIn(written).map((n) => n.value);
}

/** Whether `value`, rounded as the sheet rounds, is within 1 of its printed number in the last digit. */
export function agreesAtPrint(value: number, printed: Printed): boolean {
  // Counted in whole units of the last printed digit, so float error can't tip the boundary.
  const scale = 10 ** printed.decimals;
  return Math.abs(Math.round(value * scale) - Math.round(printed.value * scale)) <= 1;
}

/** The most decimals any of the cells prints: the sheet's precision. Undefined when none holds a number. */
export function printedDecimals(cells: readonly string[]): number | undefined {
  const decimals = cells.map(readPrinted).flatMap((p) => (typeof p === "string" ? [] : [p.decimals]));
  return decimals.length === 0 ? undefined : Math.max(...decimals);
}
