// The S7 core's interface: what the STL interpreter uses today, and what the SCL interpreter and the
// ladder/FBD sim build on next. Byte-addressed memory, INT/DINT that wrap with OV, float32 REAL,
// the status word, FC105/FC106 from Siemens' formula, and the watch-table display. Pure: no DOM,
// the same code in Node at build and in the page.

export * from "./display.ts";
export * from "./library.ts";
export * from "./memory.ts";
export * from "./numbers.ts";

/** The status word's bits, bit 0 first, by their English mnemonics. */
export const STATUS_BITS = ["/FC", "RLO", "STA", "OR", "OS", "OV", "CC0", "CC1", "BR"] as const;
export type StatusBit = (typeof STATUS_BITS)[number];
export type StatusWord = Record<StatusBit, 0 | 1>;

export const clearedStatus = (): StatusWord => ({
  "/FC": 0,
  RLO: 0,
  STA: 0,
  OR: 0,
  OS: 0,
  OV: 0,
  CC0: 0,
  CC1: 0,
  BR: 0,
});

/** The status word as the 16-bit value STEP 7 (and awlsim) reads: /FC is bit 0, BR bit 8. */
export const statusValue = (s: StatusWord) => STATUS_BITS.reduce((word, bit, i) => word | (s[bit] << i), 0);
