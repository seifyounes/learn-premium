// How the S7 core prints values, like a STEP 7 watch table: a REAL as the shortest decimal that
// reads back as the same float32 (57.3, never 57.29999924, decided on #37), an integer in its
// type's notation.

import { fromPattern, type S7Type } from "./memory.ts";

/** The shortest decimal that reads back as the same float32, with at least one decimal place. */
export function formatReal(x: number): string {
  if (Number.isNaN(x)) return "NaN";
  if (!Number.isFinite(x)) return x > 0 ? "+Inf" : "-Inf";
  if (x === 0) return Object.is(x, -0) ? "-0.0" : "0.0";
  let digits = x.toPrecision(9);
  for (let precision = 1; precision <= 9; precision++) {
    const candidate = x.toPrecision(precision);
    if (Math.fround(Number(candidate)) === x) {
      digits = candidate;
      break;
    }
  }
  const value = Number(digits);
  const magnitude = Math.abs(value);
  if (magnitude >= 1e-4 && magnitude < 1e9) {
    // Plain notation: as many decimals as the shortest digits need.
    const [mantissa = "", exponent = "0"] = digits.split("e");
    const decimals = Math.max(0, (mantissa.split(".")[1] ?? "").length - Number(exponent));
    return withPoint(value.toFixed(decimals));
  }
  const [mantissa = "", exponent = "0"] = value.toExponential(significant(digits) - 1).split("e");
  return `${withPoint(mantissa)}e${exponent.startsWith("-") ? exponent : `+${exponent.replace("+", "")}`}`;
}

/** Significant digits in a `toPrecision` string. */
const significant = (digits: string) => digits.split("e")[0]?.replace(/^-|\./g, "").replace(/^0+/, "").length || 1;
const withPoint = (s: string) => (s.includes(".") ? s : `${s}.0`);

const hex = (value: number, digits: number) => (value >>> 0).toString(16).toUpperCase().padStart(digits, "0");

/** A raw pattern as a watch table prints its type: `1`, `-5`, `L#70000`, `57.3`, `W#16#00FF`. */
export function formatValue(type: S7Type, pattern: number): string {
  const value = fromPattern(type, pattern);
  switch (type) {
    case "BOOL":
      return String(value & 1);
    case "INT":
      return String(value);
    case "DINT":
      return `L#${value}`;
    case "REAL":
      return formatReal(value);
    case "BYTE":
      return `B#16#${hex(value, 2)}`;
    case "WORD":
      return `W#16#${hex(value, 4)}`;
    case "DWORD":
      return `DW#16#${hex(value, 8)}`;
  }
}

/** A 32-bit register as hex, the way the trace shows it: `16#0000_80C7`. */
export const formatRegister = (value: number) => `16#${hex(value >>> 16, 4)}_${hex(value & 0xffff, 4)}`;
