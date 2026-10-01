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

const MINUS = /^[-−]/;

/** The one number a sheet cell prints, or why it isn't one. */
export function readPrinted(cell: string): Printed | string {
  const text = cell.replace(/\$/g, "").trim();
  if (text === "") return "the cell is blank";
  const found = numbersIn(cell);
  if (found.length === 0) return "the cell holds no number";
  if (found.length > 1)
    return `the cell holds ${found.length} numbers (${found.map((n) => n.written).join(", ")}), not one`;
  const [number] = found as [(typeof found)[number]];
  const negative = MINUS.test(text);
  return {
    value: negative ? -number.value : number.value,
    decimals: (number.written.split(".")[1] ?? "").length,
    written: `${negative ? (text[0] ?? "-") : ""}${number.written}`,
  };
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
