// The TI-S7 converting blocks a Professor's listings call, written from Siemens' formula (its
// application example 23330722), with the clamp and RET_VAL W#16#0008. Siemens publishes no code for
// them, so no binary is checked on either side: the STL build oracle runs the same formula, written
// apart from this one in STL (`oracle/fc105.awl`, `oracle/fc106.awl`), and the registers a block
// leaves behind are shown as "left by FC105" (or FC106), never gated.
//
// Each step is one REAL operation, rounded to a REAL, in the order the oracle's STL performs it.

import { int16, roundHalfEven, toReal } from "./numbers.ts";
import type { S7Type } from "./memory.ts";

const K2 = 27648;

export interface LibraryBlock {
  number: number;
  name: string;
  /** Parameters in, by name and type, in the order the block declares them. */
  inputs: Readonly<Record<string, S7Type>>;
  /** Parameters out (RET_VAL is the return value). */
  outputs: Readonly<Record<string, S7Type>>;
  run(inputs: Record<string, number>): Record<string, number>;
}

/** FC105 SCALE: an INT from an analog input to a REAL between LO_LIM and HI_LIM. */
export function scale(IN: number, HI_LIM: number, LO_LIM: number, BIPOLAR: number) {
  const K1 = BIPOLAR ? -K2 : 0;
  const x = int16(IN);
  if (x > K2) return { OUT: toReal(HI_LIM), RET_VAL: 0x0008 };
  if (x < K1) return { OUT: toReal(LO_LIM), RET_VAL: 0x0008 };
  const span = toReal(K2 - K1);
  const fraction = toReal(toReal(x - K1) / span);
  return { OUT: toReal(toReal(toReal(toReal(HI_LIM) - toReal(LO_LIM)) * fraction) + toReal(LO_LIM)), RET_VAL: 0 };
}

/**
 * FC106 UNSCALE: a REAL between LO_LIM and HI_LIM back to an INT for an analog output, rounded to the
 * nearest whole number (a tie to the even one). A value outside the limits clamps to the end of the
 * range it passed.
 */
export function unscale(IN: number, HI_LIM: number, LO_LIM: number, BIPOLAR: number) {
  const K1 = BIPOLAR ? -K2 : 0;
  const x = toReal(IN);
  const hi = toReal(HI_LIM);
  const lo = toReal(LO_LIM);
  const rising = hi >= lo;
  if (x > Math.max(hi, lo)) return { OUT: rising ? K2 : K1, RET_VAL: 0x0008 };
  if (x < Math.min(hi, lo)) return { OUT: rising ? K1 : K2, RET_VAL: 0x0008 };
  const fraction = toReal(toReal(x - lo) / toReal(hi - lo));
  const out = toReal(toReal(fraction * toReal(K2 - K1)) + K1);
  return { OUT: roundHalfEven(out), RET_VAL: 0 };
}

export const LIBRARY: Readonly<Record<number, LibraryBlock>> = {
  105: {
    number: 105,
    name: "SCALE",
    inputs: { IN: "INT", HI_LIM: "REAL", LO_LIM: "REAL", BIPOLAR: "BOOL" },
    outputs: { RET_VAL: "WORD", OUT: "REAL" },
    run: (p) => scale(p.IN ?? 0, p.HI_LIM ?? 0, p.LO_LIM ?? 0, p.BIPOLAR ?? 0),
  },
  106: {
    number: 106,
    name: "UNSCALE",
    inputs: { IN: "REAL", HI_LIM: "REAL", LO_LIM: "REAL", BIPOLAR: "BOOL" },
    outputs: { RET_VAL: "WORD", OUT: "INT" },
    run: (p) => unscale(p.IN ?? 0, p.HI_LIM ?? 0, p.LO_LIM ?? 0, p.BIPOLAR ?? 0),
  },
};
