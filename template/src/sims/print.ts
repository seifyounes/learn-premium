// Printing a computed value the way the sheet prints its column. Kept apart from the sheet-reading
// side of `precision.ts`, which parses TeX, so a sim's island ships without KaTeX.

/** How many decimals a number is written with: 0.01 has 2, 30 has 0. */
export const decimalsOf = (n: number) => (String(n).split(".")[1] ?? "").length;

/**
 * A given number as the sheet writes it, never padded to the sheet's places: 1, 0.1, 0.01, 7.5.
 * For a sim's own inputs (a run, a probe's position), not for values it computes.
 */
export const asWritten = (n: number) => String(Number(n.toPrecision(10)));

/** Past this, a value is printed in powers of ten so it fits its column. */
const LARGE = 1e6;

/** `value` printed the way the sheet prints its column: `decimals` places and a true minus sign. */
export function printAt(value: number, decimals: number): string {
  // Negative decimals round to tens, hundreds…, as a sheet printing `1.25 × 10^3` does.
  if (decimals < 0) {
    const unit = 10 ** -decimals;
    const rounded = Math.round(value / unit) * unit;
    if (Math.abs(rounded) < LARGE) return printAt(rounded, 0);
    // In powers of ten, keep the mantissa digits down to that unit: 1250000 at tens of thousands is 1.25e6.
    const exponent = Math.floor(Math.log10(Math.abs(rounded)));
    return rounded
      .toExponential(Math.max(exponent + decimals, 0))
      .replace("e+", "e")
      .replace(/^-/, "−");
  }
  const text =
    Math.abs(value) >= LARGE
      ? value.toExponential(Math.max(decimals - 1, 0)).replace("e+", "e")
      : value.toFixed(decimals).replace(/^-(?=0(?:\.0*)?$)/, "");
  return text.replace(/^-/, "−");
}
