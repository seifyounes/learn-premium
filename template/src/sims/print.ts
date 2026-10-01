// Printing a computed value the way the sheet prints its column. Kept apart from the sheet-reading
// side of `precision.ts`, which parses TeX, so a sim's island ships without KaTeX.

/** Past this, a value is printed in powers of ten so it fits its column. */
const LARGE = 1e6;

/** `value` printed the way the sheet prints its column: `decimals` places and a true minus sign. */
export function printAt(value: number, decimals: number): string {
  const text =
    Math.abs(value) >= LARGE
      ? value.toExponential(Math.max(decimals - 1, 0)).replace("e+", "e")
      : value.toFixed(decimals).replace(/^-(?=0(?:\.0*)?$)/, "");
  return text.replace(/^-/, "−");
}
