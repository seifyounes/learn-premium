// The numerics the control engine stands on: complex numbers, polynomials (highest power first, as
// python-control writes them), their roots, and the matrix exponential that steps a linear system
// exactly. Pure, and small enough to ship in the page with the sim.

/** A complex number, [re, im]. */
export type Complex = readonly [number, number];

export const add = (a: Complex, b: Complex): Complex => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: Complex, b: Complex): Complex => [a[0] - b[0], a[1] - b[1]];
export const mul = (a: Complex, b: Complex): Complex => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
export function div(a: Complex, b: Complex): Complex {
  const d = b[0] * b[0] + b[1] * b[1];
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
}
export const abs = (a: Complex) => Math.hypot(a[0], a[1]);

/** A polynomial's value at `s` (Horner), its coefficients highest power first. */
export function evaluate(coefficients: readonly number[], s: Complex): Complex {
  let value: Complex = [0, 0];
  for (const c of coefficients) value = add(mul(value, s), [c, 0]);
  return value;
}

/** The monic polynomial with these roots, real coefficients (the roots come in conjugate pairs). */
export function fromRoots(roots: readonly Complex[]): number[] {
  let poly: Complex[] = [[1, 0]];
  for (const r of roots) {
    const next: Complex[] = [...poly, [0, 0]];
    poly.forEach((c, i) => (next[i + 1] = sub(next[i + 1] ?? [0, 0], mul(c, r))));
    poly = next;
  }
  return poly.map(([re]) => re);
}

/** `a + b`, the shorter one aligned to the lowest power. */
export function plus(a: readonly number[], b: readonly number[]): number[] {
  const n = Math.max(a.length, b.length);
  const at = (p: readonly number[], i: number) => p[i - (n - p.length)] ?? 0;
  return Array.from({ length: n }, (_, i) => at(a, i) + at(b, i));
}

export const scale = (p: readonly number[], k: number) => p.map((c) => c * k);

/** The derivative's coefficients. */
export const derivative = (p: readonly number[]) => p.slice(0, -1).map((c, i) => c * (p.length - 1 - i));

/**
 * Every root of a polynomial with real coefficients, by the Aberth–Ehrlich iteration, then each
 * polished by Newton's method. A root's conjugate partner is made its exact mirror, and a root
 * within rounding of the real axis is put on it.
 */
export function roots(coefficients: readonly number[]): Complex[] {
  const first = coefficients.findIndex((c) => c !== 0);
  const p = coefficients.slice(first).map((c) => c / (coefficients[first] ?? 1));
  const n = p.length - 1;
  if (n < 1) return [];
  if (n === 1) return [[-(p[1] ?? 0), 0]];
  const dp = derivative(p);
  // Start on a circle that holds every root (Cauchy's bound), off the axes.
  const radius = 1 + Math.max(...p.slice(1).map(Math.abs));
  let z: Complex[] = Array.from({ length: n }, (_, k) => {
    const angle = (2 * Math.PI * k) / n + 0.4;
    return [radius * Math.cos(angle), radius * Math.sin(angle)];
  });
  for (let iteration = 0; iteration < 500; iteration++) {
    let moved = 0;
    z = z.map((zk, k) => {
      const ratio = div(evaluate(p, zk), evaluate(dp, zk));
      let sum: Complex = [0, 0];
      z.forEach((zj, j) => {
        if (j !== k) sum = add(sum, div([1, 0], sub(zk, zj)));
      });
      const step = div(ratio, sub([1, 0], mul(ratio, sum)));
      if (!Number.isFinite(step[0]) || !Number.isFinite(step[1])) return zk;
      moved = Math.max(moved, abs(step) / Math.max(1, abs(zk)));
      return sub(zk, step);
    });
    if (moved < 1e-16) break;
  }
  const polished = z.map((zk) => {
    let r = zk;
    for (let i = 0; i < 3; i++) {
      const d = evaluate(dp, r);
      if (abs(d) === 0) break;
      const next = sub(r, div(evaluate(p, r), d));
      if (!Number.isFinite(next[0]) || !Number.isFinite(next[1])) break;
      r = next;
    }
    return r;
  });
  return conjugateClean(polished);
}

/**
 * Roots tidied, one out for each in: one within rounding of the real axis is put on it, and a root
 * whose conjugate partner was found (the nearest root on the other side of the axis, within the
 * error a repeated root leaves) is made its exact mirror. A root with no partner stays as found.
 */
function conjugateClean(found: readonly Complex[]): Complex[] {
  const scale = (r: Complex) => Math.max(1, abs(r));
  const left = [...found];
  const out: Complex[] = [];
  while (left.length > 0) {
    const r = left.shift() as Complex;
    if (Math.abs(r[1]) <= 1e-9 * scale(r)) {
      out.push([r[0], 0]);
      continue;
    }
    const mirror: Complex = [r[0], -r[1]];
    let i = -1;
    left.forEach((q, j) => {
      const gap = abs(sub(q, mirror));
      if (
        Math.sign(q[1]) === -Math.sign(r[1]) &&
        gap <= 1e-3 * scale(r) &&
        (i < 0 || gap < abs(sub(left[i] ?? q, mirror)))
      )
        i = j;
    });
    const partner = i < 0 ? undefined : left.splice(i, 1)[0];
    if (!partner) {
      out.push(r);
      continue;
    }
    const re = (r[0] + partner[0]) / 2;
    const im = (Math.abs(r[1]) + Math.abs(partner[1])) / 2;
    out.push([re, im], [re, -im]);
  }
  return out;
}

/** Roots in a fixed order: by imaginary part, upper half first, then by real part, right first. */
export const ordered = (rs: readonly Complex[]) => [...rs].sort((a, b) => b[1] - a[1] || b[0] - a[0]);

// ---------- matrices ----------

export type Matrix = number[][];

const identity = (n: number): Matrix =>
  Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => +(i === j)));

function times(a: Matrix, b: Matrix): Matrix {
  return a.map((row) => (b[0] ?? []).map((_, j) => row.reduce((s, v, k) => s + v * (b[k]?.[j] ?? 0), 0)));
}

const combine = (a: Matrix, b: Matrix, ka: number, kb: number): Matrix =>
  a.map((row, i) => row.map((v, j) => ka * v + kb * (b[i]?.[j] ?? 0)));

/** `x` with `a x = b`, by Gaussian elimination with partial pivoting; `b` holds one column per right side. */
function solve(a: Matrix, b: Matrix): Matrix {
  const n = a.length;
  const m = a.map((row, i) => [...row, ...(b[i] ?? [])]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r]?.[col] ?? 0) > Math.abs(m[pivot]?.[col] ?? 0)) pivot = r;
    [m[col], m[pivot]] = [m[pivot] as number[], m[col] as number[]];
    const top = m[col] as number[];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const row = m[r] as number[];
      const f = (row[col] ?? 0) / (top[col] ?? 1);
      if (f !== 0) row.forEach((v, j) => (row[j] = v - f * (top[j] ?? 0)));
    }
  }
  return m.map((row, i) => row.slice(n).map((v) => v / (row[i] ?? 1)));
}

/** The matrix exponential e^M, by scaling and squaring with a degree-8 Padé approximant. */
export function expm(m: Matrix): Matrix {
  const n = m.length;
  const norm = Math.max(...m.map((row) => row.reduce((s, v) => s + Math.abs(v), 0)));
  const squarings = Math.max(0, Math.ceil(Math.log2(norm / 0.5)));
  const x = m.map((row) => row.map((v) => v / 2 ** squarings));
  const q = 8;
  let c = 1;
  let power = identity(n);
  let numerator = identity(n);
  let denominator = identity(n);
  for (let k = 1; k <= q; k++) {
    c = (c * (q - k + 1)) / (k * (2 * q - k + 1));
    power = times(power, x);
    numerator = combine(numerator, power, 1, c);
    denominator = combine(denominator, power, 1, k % 2 === 0 ? c : -c);
  }
  let e = solve(denominator, numerator);
  for (let s = 0; s < squarings; s++) e = times(e, e);
  return e;
}

export { times as matrixTimes };
