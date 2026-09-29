// PROTOTYPE (throwaway, ticket #37): the shared S7 core under the STL and SCL interpreters
// (and, later, the ladder sim). Pure: no DOM, runs in Node and the browser.
//
// - Byte-addressed, big-endian memory areas: I, Q, M, PI (peripheral inputs), PQ, DBn.
// - INT/DINT 16/32-bit two's-complement wrap with OV/OS reporting.
// - REAL is IEEE float32: every result goes through Math.fround.
// - FC105 SCALE / FC106 UNSCALE written from Siemens' formula (application example 23330722),
//   including the clamp and RET_VAL W#16#0008.
// - Float32 display: shortest round-trip ("57.3", like a watch table) or exact float32 digits.

export const f32 = Math.fround;

const scratch = new DataView(new ArrayBuffer(8));
export function realToBits(x) { scratch.setFloat32(0, x); return scratch.getUint32(0); }
export function bitsToReal(u) { scratch.setUint32(0, u >>> 0); return scratch.getFloat32(0); }
export const int16 = (u) => (u << 16) >> 16;
export const int32 = (u) => u | 0;
export const uint16 = (u) => u & 0xffff;
export const uint32 = (u) => u >>> 0;
export const isF32 = (x) => typeof x === 'number' && (Number.isNaN(x) || f32(x) === x);

// ---- integer arithmetic with S7 wrap and status bits ------------------------------------
// Returns { value (wrapped, signed), ov, cc1, cc0 } per the STL manual's status tables (7.3-7.12).
function ccOfSigned(v) { return v === 0 ? [0, 0] : v < 0 ? [0, 1] : [1, 0]; }
export function intResult(exact, bits) {
  const lo = bits === 16 ? -32768 : -2147483648, hi = bits === 16 ? 32767 : 2147483647;
  const ov = exact < lo || exact > hi;
  const value = bits === 16 ? int16(Number(BigInt.asIntN(16, BigInt(exact)))) : Number(BigInt.asIntN(32, BigInt(exact)));
  // On overflow the manual reports the sign of the true result inverted in CC (wrapped sign).
  let [cc1, cc0] = ccOfSigned(value);
  if (ov) [cc1, cc0] = exact > hi ? [0, 1] : [1, 0];
  return { value, ov: ov ? 1 : 0, cc1, cc0 };
}
export const wrapInt = (x) => int16(Math.trunc(x) & 0xffff);
export const wrapDint = (x) => Number(BigInt.asIntN(32, BigInt(Math.trunc(x))));

// REAL result status: CC1/CC0/OV per the manual's floating-point tables.
export function realStatus(r) {
  if (Number.isNaN(r)) return { cc1: 1, cc0: 1, ov: 1 };
  if (r === Infinity) return { cc1: 1, cc0: 0, ov: 1 };
  if (r === -Infinity) return { cc1: 0, cc0: 1, ov: 1 };
  const a = Math.abs(r);
  if (a !== 0 && a < 1.1754943508222875e-38) return { cc1: 0, cc0: 0, ov: 1 }; // denormal = underflow
  if (r === 0) return { cc1: 0, cc0: 0, ov: 0 };
  return r < 0 ? { cc1: 0, cc0: 1, ov: 0 } : { cc1: 1, cc0: 0, ov: 0 };
}

// ---- memory ---------------------------------------------------------------------------
export class S7Memory {
  constructor(sizes = { I: 128, Q: 128, M: 256, PI: 512, PQ: 512 }) {
    this.areas = {};
    for (const [k, n] of Object.entries(sizes)) this.areas[k] = new DataView(new ArrayBuffer(n));
  }
  area(name) {
    if (!this.areas[name]) {
      if (/^DB\d+$/.test(name)) this.areas[name] = new DataView(new ArrayBuffer(256));
      else throw new Error('no memory area ' + name);
    }
    return this.areas[name];
  }
  // size: 'X' bit, 'B' byte, 'W' word, 'D' dword. Returns the raw unsigned pattern.
  read(area, size, byte, bit = 0) {
    const dv = this.area(area);
    if (size === 'B') return dv.getUint8(byte);
    if (size === 'W') return dv.getUint16(byte);
    if (size === 'D') return dv.getUint32(byte);
    return (dv.getUint8(byte) >> bit) & 1;
  }
  write(area, size, byte, value, bit = 0) {
    const dv = this.area(area);
    if (size === 'B') dv.setUint8(byte, value & 0xff);
    else if (size === 'W') dv.setUint16(byte, value & 0xffff);
    else if (size === 'D') dv.setUint32(byte, value >>> 0);
    else { const b = dv.getUint8(byte); dv.setUint8(byte, value ? b | (1 << bit) : b & ~(1 << bit)); }
  }
  bytes(area, from = 0, count) {
    const dv = this.area(area); const n = count ?? dv.byteLength - from;
    return Array.from({ length: n }, (_, i) => dv.getUint8(from + i));
  }
  clone() {
    const m = new S7Memory({});
    for (const [k, dv] of Object.entries(this.areas)) m.areas[k] = new DataView(dv.buffer.slice(0));
    return m;
  }
}

// ---- FC105 SCALE / FC106 UNSCALE (TI-S7 library), from Siemens' formula -----------------
// OUT = ((FLOAT(IN) - K1) / (K2 - K1)) * (HI_LIM - LO_LIM) + LO_LIM
// K1 = -27648 (bipolar) or 0 (unipolar), K2 = +27648.
// IN > K2: OUT = HI_LIM, RET_VAL = W#16#0008.  IN < K1: OUT = LO_LIM, RET_VAL = W#16#0008.
// Every intermediate is a float32 operation, in this order (the STL build oracle uses the same order).
export function fc105(IN, HI_LIM, LO_LIM, BIPOLAR) {
  const K2 = 27648, K1 = BIPOLAR ? -27648 : 0;
  const x = f32(int16(IN));
  if (x > K2) return { OUT: f32(HI_LIM), RET_VAL: 0x0008 };
  if (x < K1) return { OUT: f32(LO_LIM), RET_VAL: 0x0008 };
  const q = f32(f32(x - K1) / f32(K2 - K1));
  return { OUT: f32(f32(q * f32(HI_LIM - LO_LIM)) + f32(LO_LIM)), RET_VAL: 0 };
}
// FC106: OUT = ((IN - LO_LIM) / (HI_LIM - LO_LIM)) * (K2 - K1) + K1, rounded to INT.
// IN outside the limits clamps to K1/K2 and returns W#16#0008. (Rounding mode unverified.)
export function fc106(IN, HI_LIM, LO_LIM, BIPOLAR) {
  const K2 = 27648, K1 = BIPOLAR ? -27648 : 0;
  const x = f32(IN), lo = Math.min(LO_LIM, HI_LIM), hi = Math.max(LO_LIM, HI_LIM);
  if (x > hi) return { OUT: HI_LIM >= LO_LIM ? K2 : K1, RET_VAL: 0x0008 };
  if (x < lo) return { OUT: HI_LIM >= LO_LIM ? K1 : K2, RET_VAL: 0x0008 };
  const q = f32(f32(x - f32(LO_LIM)) / f32(f32(HI_LIM) - f32(LO_LIM)));
  const r = f32(f32(q * (K2 - K1)) + K1);
  return { OUT: wrapInt(roundHalfEven(r)), RET_VAL: 0 };
}
export function roundHalfEven(v) {
  const f = Math.floor(v), d = v - f;
  return d > 0.5 || (d === 0.5 && f % 2 !== 0) ? f + 1 : f;
}

// ---- display ----------------------------------------------------------------------------
// 'short': the shortest decimal that reads back as the same float32 (what a watch table shows).
// 'exact': ten significant digits of the float32 value itself (57.3 -> 57.29999924).
export function formatReal(x, mode = 'short') {
  if (Number.isNaN(x)) return 'NaN';
  if (!Number.isFinite(x)) return x > 0 ? '+Inf' : '-Inf';
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
  let s;
  if (mode === 'exact') s = x.toPrecision(10);
  else for (let p = 1; p <= 9; p++) { s = x.toPrecision(p); if (f32(parseFloat(s)) === x) break; }
  if (/e/.test(s)) {
    const [m, e] = s.split('e'); const n = parseFloat(s);
    if (Math.abs(n) >= 1e-4 && Math.abs(n) < 1e9) s = trimZeros(n.toFixed(Math.max(0, (m.split('.')[1] || '').length - +e)));
    else return s;
  } else s = trimZeros(s);
  return s.includes('.') ? s : s + '.0';
}
const trimZeros = (s) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '.0') : s);
export const hex = (u, digits = 8) => (u >>> 0).toString(16).toUpperCase().padStart(digits, '0');
