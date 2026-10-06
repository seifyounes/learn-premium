// The S7 core's memory: byte-addressed, big-endian areas, read and written by absolute address
// (`I 0.1`, `MW 20`, `PIW 256`, `QD 8`). Every interpreter on the core reads and writes here; a
// peripheral read (`PIW`) sees the input bytes at its address, as the build oracle's does.

import { bitsToReal, int16, int32, realToBits } from "./numbers.ts";

/** I: process-image inputs (a peripheral input reads them too); Q: outputs; M: bit memory. */
export const AREAS = ["I", "Q", "M"] as const;
export type Area = (typeof AREAS)[number];

/** Bytes in each area: the same sizes the build oracle runs with. */
export const AREA_SIZES: Record<Area, number> = { I: 512, Q: 256, M: 512 };

export type Width = "bit" | "byte" | "word" | "dword";
export const WIDTH_BYTES: Record<Exclude<Width, "bit">, number> = { byte: 1, word: 2, dword: 4 };

export interface Address {
  area: Area;
  width: Width;
  byte: number;
  /** The bit in its byte, for a bit address; 0 otherwise. */
  bit: number;
  /** A peripheral input (PIB/PIW/PID): read straight from the input bytes. */
  peripheral?: true;
}

/** The elementary data types an operand is read as. */
export const S7_TYPES = ["BOOL", "BYTE", "WORD", "DWORD", "INT", "DINT", "REAL"] as const;
export type S7Type = (typeof S7_TYPES)[number];
export const WIDTH_OF: Record<S7Type, Width> = {
  BOOL: "bit",
  BYTE: "byte",
  WORD: "word",
  INT: "word",
  DWORD: "dword",
  DINT: "dword",
  REAL: "dword",
};

const SIZE_LETTER: Record<string, Width> = { B: "byte", W: "word", D: "dword" };
const LETTER_OF: Record<Exclude<Width, "bit">, string> = { byte: "B", word: "W", dword: "D" };

/**
 * An absolute address as STEP 7 writes it, English mnemonics: `I 0.1`, `Q 4.0`, `M 1.2`, `IB 0`,
 * `MW 20`, `QD 8`, `PIW 256`. Spaces are optional. Anything else is `undefined`.
 */
export function parseAddress(text: string): Address | undefined {
  const match = /^(PI|I|Q|M)(B|W|D)?\s*(\d+)(?:\.(\d+))?$/i.exec(text.trim());
  if (!match) return undefined;
  const [, rawArea = "", size, byteText = "", bitText] = match;
  const area = rawArea.toUpperCase();
  const byte = Number(byteText);
  if (size === undefined) {
    if (area === "PI" || bitText === undefined) return undefined;
    const bit = Number(bitText);
    if (bit > 7) return undefined;
    return { area: area as Area, width: "bit", byte, bit };
  }
  if (bitText !== undefined) return undefined;
  const width = SIZE_LETTER[size.toUpperCase()];
  if (!width) return undefined;
  return area === "PI"
    ? { area: "I", width, byte, bit: 0, peripheral: true }
    : { area: area as Area, width, byte, bit: 0 };
}

/** An address the way STEP 7 prints it: `I 0.1`, `MW 20`, `PIW 256`. */
export function formatAddress(a: Address): string {
  if (a.width === "bit") return `${a.area} ${a.byte}.${a.bit}`;
  return `${a.peripheral ? "PI" : a.area}${LETTER_OF[a.width]} ${a.byte}`;
}

/** Whether every byte of the address lies inside its area. */
export const inRange = (a: Address) =>
  a.byte >= 0 && a.byte + (a.width === "bit" ? 1 : WIDTH_BYTES[a.width]) <= AREA_SIZES[a.area];

/** The bytes an address covers, as [area, offset] pairs. */
export function bytesOf(a: Address): [Area, number][] {
  const count = a.width === "bit" ? 1 : WIDTH_BYTES[a.width];
  return Array.from({ length: count }, (_, i) => [a.area, a.byte + i]);
}

/** One byte a write changed. */
export interface ByteWrite {
  area: Area;
  offset: number;
  value: number;
}

export class S7Memory {
  readonly areas: Record<Area, Uint8Array>;

  constructor(from?: S7Memory) {
    const area = (name: Area) => (from ? from.areas[name].slice() : new Uint8Array(AREA_SIZES[name]));
    this.areas = { I: area("I"), Q: area("Q"), M: area("M") };
  }

  clone(): S7Memory {
    return new S7Memory(this);
  }

  /** The raw unsigned pattern at an address: a bit 0/1, else the big-endian bytes. */
  read(a: Address): number {
    if (!inRange(a))
      throw new RangeError(`${formatAddress(a)} is outside the ${AREA_SIZES[a.area]} bytes of ${a.area}`);
    const bytes = this.areas[a.area];
    if (a.width === "bit") return ((bytes[a.byte] ?? 0) >> a.bit) & 1;
    let value = 0;
    for (let i = 0; i < WIDTH_BYTES[a.width]; i++) value = value * 256 + (bytes[a.byte + i] ?? 0);
    return value >>> 0;
  }

  /** Writes the low bits of `value` at an address; returns the bytes that changed. */
  write(a: Address, value: number): ByteWrite[] {
    if (!inRange(a))
      throw new RangeError(`${formatAddress(a)} is outside the ${AREA_SIZES[a.area]} bytes of ${a.area}`);
    const bytes = this.areas[a.area];
    const changed: ByteWrite[] = [];
    const put = (offset: number, byte: number) => {
      if (bytes[offset] !== byte) {
        bytes[offset] = byte;
        changed.push({ area: a.area, offset, value: byte });
      }
    };
    if (a.width === "bit") {
      const old = bytes[a.byte] ?? 0;
      put(a.byte, value & 1 ? old | (1 << a.bit) : old & ~(1 << a.bit));
      return changed;
    }
    const count = WIDTH_BYTES[a.width];
    for (let i = 0; i < count; i++) put(a.byte + i, Math.floor((value >>> 0) / 256 ** (count - 1 - i)) & 0xff);
    return changed;
  }
}

/** A raw pattern read as a value of its type: a BOOL 0/1, INT and DINT signed, REAL a number. */
export function fromPattern(type: S7Type, pattern: number): number {
  switch (type) {
    case "INT":
      return int16(pattern);
    case "DINT":
      return int32(pattern);
    case "REAL":
      return bitsToReal(pattern);
    default:
      return pattern >>> 0;
  }
}

/** A value of its type as the raw pattern written to memory. */
export function toPattern(type: S7Type, value: number): number {
  switch (type) {
    case "REAL":
      return realToBits(value);
    case "BOOL":
      return value ? 1 : 0;
    default:
      return Math.trunc(value) >>> 0;
  }
}

/** Whether a value fits its type: a BOOL 0 or 1, an integer in range, a REAL any number. */
export function fits(type: S7Type, value: number): boolean {
  if (type === "REAL") return Number.isFinite(value);
  if (!Number.isInteger(value)) return false;
  const ranges: Record<Exclude<S7Type, "REAL">, readonly [number, number]> = {
    BOOL: [0, 1],
    BYTE: [0, 0xff],
    WORD: [0, 0xffff],
    DWORD: [0, 0xffffffff],
    INT: [-32768, 32767],
    DINT: [-2147483648, 2147483647],
  };
  const [lo, hi] = ranges[type];
  return value >= lo && value <= hi;
}
