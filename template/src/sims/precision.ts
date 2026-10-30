// Numbers at the sheet's printed precision. A sheet value printed with d decimals agrees with a
// computed one when the computed value, rounded to d decimals, is within 1 of it in the last
// printed digit: a hand may round the last digit either way. Pure: the number gate uses it, and a
// sim's table prints the sheet's way with `printAt` (`print.ts`).
import { groupThousands, numbersIn as provenanceNumbers } from "../provenance/values.ts";

/** The numbers in a text. Eastern Arabic digits are no number here: the provenance gate reports them (as NaN), a sheet comparison would match them to anything. */
const numbersIn = (text: string) => provenanceNumbers(text).filter((n) => Number.isFinite(n.value));

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
  // Grouped thousands are looked for as the parser read them (`1{,}250` is `1,250`).
  const sign = new RegExp(`${SIGN_BEFORE}${escaped(number.written)}(?![\\d.])`).exec(groupThousands(text))?.[1];
  return {
    value: sign === undefined ? number.value : -number.value,
    decimals: (number.written.split(".")[1] ?? "").length,
    written: `${sign ?? ""}${number.written}`,
  };
}

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The sign is the one just before the number, at the start or after a label's `=` (`R = -0.04`);
// a minus inside a subscript (`x_{-1}`) belongs to the label. TeX spacing (`-\,0.04`) may sit between.
// A minus before a grouped value (`-(0.04)`, `-\left(0.04\right)`, `-{0.04}`) applies to it.
// Group 1 is the minus, when there is one; the number itself follows.
const SPACE = String.raw`(?:\s|\\[,;:! ]|~)*`;
const OPENS = String.raw`(?:(?:\\left)?\(|\{)?`;
const signBefore = (starts: string) => `(?:^|[${starts}]|\\\\approx)${SPACE}([-−])${SPACE}${OPENS}${SPACE}`;
const SIGN_BEFORE = signBefore("=(:≈");

/**
 * The value of each number `found` in a ruling's text, in reading order, with the sign `readPrinted`
 * gives a cell's: a ruling on -5.00 is not a ruling on 5.00. Each number is looked for after the one
 * before it, so a list ("$-0.02$, $0.5$") gives every number its own sign. A number the text can't
 * be found in again (the parser reads math differently from the raw text) keeps its unsigned value.
 */
function signedValues(source: string, found: ReadonlyArray<{ written: string; value: number }>): number[] {
  const text = groupThousands(source);
  // Among several values, a minus also starts one after a math delimiter, a comma or a semicolon.
  const before = new RegExp(`${signBefore("=(:≈$,;")}$`);
  let from = 0;
  return found.map((n) => {
    const whole = new RegExp(`(?<![\\d.])${escaped(n.written)}(?![\\d.])`, "g");
    whole.lastIndex = from;
    // The occurrence that is the value, not a subscript or power the parser left out with the same
    // digits (`x_1 = -1`): blanking a value takes one number away; blanking notation takes none.
    for (let at = whole.exec(text); at !== null; at = whole.exec(text)) {
      const end = at.index + n.written.length;
      const blanked = text.slice(0, at.index) + "#".repeat(n.written.length) + text.slice(end);
      if (numbersIn(blanked).length !== found.length - 1) continue;
      from = end;
      return before.test(text.slice(0, at.index)) ? -n.value : n.value;
    }
    return n.value;
  });
}

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
 * The signed values a ruling's text names (a Slip's `sheet`, a Divergence's `value`), matched against
 * sheet cells read by `readPrinted`: one value in scientific notation counts as one number. A ruling
 * on -5.00 settles a cell printing -5.00, never one printing 5.00.
 */
export function rulingValues(written: string): number[] {
  const scientific = readScientific(written.replace(/\$/g, "").trim());
  return scientific !== null ? [scientific.value] : signedValues(written, numbersIn(written));
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
