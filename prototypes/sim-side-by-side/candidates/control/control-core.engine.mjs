// PROTOTYPE (throwaway): a small LTI core for unity-feedback lessons.
// Pure ES module, no DOM: runs in the page and in Node (check-control-core.mjs).
// Polynomials are coefficient arrays, highest power first: s^2 + 2s -> [1, 2, 0].
// Loop: L(s) = K * num(s) / den(s), unity negative feedback.

// ---------- complex numbers ([re, im]) ----------
const cadd = (a, b) => [a[0] + b[0], a[1] + b[1]];
const csub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const cmul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const cdiv = (a, b) => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
const cabs = (a) => Math.hypot(a[0], a[1]);

// ---------- polynomials ----------
export const trim = (p) => { let i = 0; while (i < p.length - 1 && Math.abs(p[i]) < 1e-14) i++; return p.slice(i); };
export function polyAdd(a, b) {
  const n = Math.max(a.length, b.length), out = new Array(n).fill(0);
  a.forEach((c, i) => { out[n - a.length + i] += c; });
  b.forEach((c, i) => { out[n - b.length + i] += c; });
  return trim(out);
}
export function polyMul(a, b) {
  const out = new Array(a.length + b.length - 1).fill(0);
  a.forEach((x, i) => b.forEach((y, j) => { out[i + j] += x * y; }));
  return out;
}
export const polyScale = (p, k) => p.map((c) => c * k);
export const polyDeriv = (p) => p.slice(0, -1).map((c, i) => c * (p.length - 1 - i));
export const polyEval = (p, s) => p.reduce((acc, c) => acc * s + c, 0);
export const polyEvalC = (p, s) => p.reduce((acc, c) => cadd(cmul(acc, s), [c, 0]), [0, 0]);

/** Roots of a real polynomial (Durand-Kerner, then Newton polish), sorted by imag desc then real. */
export function roots(pIn) {
  const p = trim(pIn);
  const n = p.length - 1;
  if (n < 1) return [];
  const a = p.map((c) => c / p[0]);
  if (n === 1) return [[-a[1], 0]];
  if (n === 2) {
    const [, b, c] = a, disc = b * b - 4 * c;
    if (disc >= 0) { const r = Math.sqrt(disc); return [[(-b + r) / 2, 0], [(-b - r) / 2, 0]]; }
    const r = Math.sqrt(-disc) / 2; return [[-b / 2, r], [-b / 2, -r]];
  }
  let z = Array.from({ length: n }, (_, k) => { const ang = (2 * Math.PI * k) / n + 0.4; const R = 1 + Math.max(...a.slice(1).map(Math.abs)); return [R * 0.5 * Math.cos(ang), R * 0.5 * Math.sin(ang)]; });
  for (let it = 0; it < 500; it++) {
    let delta = 0;
    z = z.map((zi, i) => {
      let den = [1, 0];
      z.forEach((zj, j) => { if (j !== i) den = cmul(den, csub(zi, zj)); });
      const step = cdiv(polyEvalC(a, zi), den);
      delta = Math.max(delta, cabs(step));
      return csub(zi, step);
    });
    if (delta < 1e-15) break;
  }
  const d = polyDeriv(a);
  z = z.map((zi) => { for (let k = 0; k < 3; k++) { const dv = polyEvalC(d, zi); if (cabs(dv) < 1e-300) break; zi = csub(zi, cdiv(polyEvalC(a, zi), dv)); } return Math.abs(zi[1]) < 1e-10 ? [zi[0], 0] : zi; });
  return z.sort((u, v) => v[1] - u[1] || u[0] - v[0]);
}

// ---------- the loop ----------
/** Closed loop T(s) = K num / (den + K num). */
export function closedLoop(sys, K) {
  const n = polyScale(sys.num, K);
  return { num: trim(n), den: polyAdd(sys.den, n) };
}

/** Closed-loop poles at gain K. */
export const closedLoopPoles = (sys, K) => roots(closedLoop(sys, K).den);

/** Standard second-order figures from a degree-2 denominator a2 s^2 + a1 s + a0. */
export function secondOrder(den) {
  const d = trim(den);
  if (d.length !== 3) return null;
  const [a2, a1, a0] = d;
  const wn = Math.sqrt(a0 / a2), zeta = a1 / (2 * Math.sqrt(a0 * a2));
  const osPct = zeta < 1 ? 100 * Math.exp((-zeta * Math.PI) / Math.sqrt(1 - zeta * zeta)) : 0;
  return { wn, zeta, osPct, tsTextbook: 4 / (zeta * wn), tpTextbook: zeta < 1 ? Math.PI / (wn * Math.sqrt(1 - zeta * zeta)) : Infinity };
}

// ---------- time domain ----------
/**
 * Unit-step response of a proper T(s) = num/den by RK4 on the controllable canonical form.
 * Returns { t: Float64Array, y: Float64Array }.
 */
export function stepResponse(tf, { tEnd = 8, dt = 1e-3 } = {}) {
  const den = trim(tf.den), a0 = den[0];
  const a = den.map((c) => c / a0);
  const n = a.length - 1;
  let b = tf.num.map((c) => c / a0);
  while (b.length < n + 1) b = [0, ...b];
  // y = sum_i (b_i - b0 a_i) x_i + b0 u, in controllable canonical form
  const d = b[0];
  const c = Array.from({ length: n }, (_, i) => b[i + 1] - d * a[i + 1]);
  const f = (x) => { const dx = new Array(n); for (let i = 0; i < n - 1; i++) dx[i] = x[i + 1]; let acc = 1; for (let i = 0; i < n; i++) acc -= a[n - i] * x[i]; dx[n - 1] = acc; return dx; };
  // state x[0] is the lowest derivative; output uses c reversed to match
  const out = (x) => { let y = d; for (let i = 0; i < n; i++) y += c[n - 1 - i] * x[i]; return y; };
  const N = Math.round(tEnd / dt);
  const t = new Float64Array(N + 1), y = new Float64Array(N + 1);
  let x = new Array(n).fill(0);
  y[0] = out(x);
  for (let k = 1; k <= N; k++) {
    const k1 = f(x), k2 = f(x.map((v, i) => v + (dt / 2) * k1[i])), k3 = f(x.map((v, i) => v + (dt / 2) * k2[i])), k4 = f(x.map((v, i) => v + dt * k3[i]));
    x = x.map((v, i) => v + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
    t[k] = k * dt; y[k] = out(x);
  }
  return { t, y };
}

/** Peak, overshoot, peak time, rise time (10-90 %) and settling time (band, default 2 %). */
export function stepInfo({ t, y }, { band = 0.02, yFinal = 1 } = {}) {
  let iPk = 0; for (let i = 1; i < y.length; i++) if (y[i] > y[iPk]) iPk = i;
  const peak = y[iPk];
  const osPct = Math.max(0, (peak - yFinal) / yFinal * 100);
  const cross = (lvl) => { for (let i = 1; i < y.length; i++) if (y[i] >= lvl) return t[i - 1] + (t[i] - t[i - 1]) * (lvl - y[i - 1]) / (y[i] - y[i - 1]); return NaN; };
  let last = -1; for (let i = 0; i < y.length; i++) if (Math.abs(y[i] - yFinal) > band * yFinal) last = i;
  let ts = 0;
  if (last >= 0 && last < y.length - 1) {
    const lvl = yFinal + Math.sign(y[last] - yFinal) * band * yFinal; // interpolate the exit from the band
    ts = t[last] + (t[last + 1] - t[last]) * (lvl - y[last]) / (y[last + 1] - y[last]);
  } else if (last === y.length - 1) ts = NaN;
  return { peak, osPct, tPeak: t[iPk], tRise: cross(0.9 * yFinal) - cross(0.1 * yFinal), ts, band };
}

// ---------- frequency domain ----------
/** L(jw) for the open loop K num/den. */
export const loopAt = (sys, K, w) => cmul([K, 0], cdiv(polyEvalC(sys.num, [0, w]), polyEvalC(sys.den, [0, w])));

/** Magnitude (dB) and continuous phase (deg), phase summed factor by factor so it never wraps. */
export function bodePoint(sys, K, w) {
  const zs = roots(sys.num), ps = roots(sys.den);
  return bodePointFrom(zs, ps, sys, K, w);
}
function bodePointFrom(zs, ps, sys, K, w) {
  const L = loopAt(sys, K, w);
  const lead = K * trim(sys.num)[0] / trim(sys.den)[0];
  let ph = lead < 0 ? -180 : 0;
  for (const z of zs) ph += Math.atan2(w - z[1], -z[0]) * 180 / Math.PI;
  for (const p of ps) ph -= Math.atan2(w - p[1], -p[0]) * 180 / Math.PI;
  return { w, magDb: 20 * Math.log10(cabs(L)), phaseDeg: ph, re: L[0], im: L[1] };
}

export function bode(sys, K, { wMin = 0.01, wMax = 100, n = 400 } = {}) {
  const zs = roots(sys.num), ps = roots(sys.den);
  const out = [];
  for (let i = 0; i < n; i++) { const w = wMin * Math.pow(wMax / wMin, i / (n - 1)); out.push(bodePointFrom(zs, ps, sys, K, w)); }
  return out;
}

function bisect(f, lo, hi, iters = 200) {
  let flo = f(lo);
  for (let i = 0; i < iters; i++) {
    const mid = Math.sqrt(lo * hi), fm = f(mid);
    if ((fm > 0) === (flo > 0)) { lo = mid; flo = fm; } else hi = mid;
    if (hi / lo - 1 < 1e-14) break;
  }
  return Math.sqrt(lo * hi);
}

/** Gain and phase margins by scanning a log grid for sign changes, then bisection. */
export function margins(sys, K, { wMin = 1e-4, wMax = 1e4, n = 2000 } = {}) {
  const zs = roots(sys.num), ps = roots(sys.den);
  const P = (w) => bodePointFrom(zs, ps, sys, K, w);
  let wgc = null, wpc = null;
  let prev = P(wMin), prevW = wMin;
  for (let i = 1; i < n; i++) {
    const w = wMin * Math.pow(wMax / wMin, i / (n - 1)), cur = P(w);
    if (wgc === null && (prev.magDb > 0) !== (cur.magDb > 0)) wgc = bisect((x) => P(x).magDb, prevW, w);
    if (wpc === null && (prev.phaseDeg > -180) !== (cur.phaseDeg > -180)) wpc = bisect((x) => P(x).phaseDeg + 180, prevW, w);
    prev = cur; prevW = w;
  }
  const pm = wgc === null ? Infinity : 180 + P(wgc).phaseDeg;
  const gmDb = wpc === null ? Infinity : -P(wpc).magDb;
  return { pmDeg: pm, wgc, gmDb, wpc };
}

/** Nyquist samples of L(jw) for w > 0 (mirror for w < 0). Points beyond `clip` are dropped. */
export function nyquist(sys, K, { wMin = 0.05, wMax = 200, n = 500, clip = 1e3 } = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const w = wMin * Math.pow(wMax / wMin, i / (n - 1)), L = loopAt(sys, K, w);
    if (cabs(L) <= clip) out.push({ w, re: L[0], im: L[1] });
  }
  return out;
}

// ---------- root locus ----------
/** Branches of the closed-loop poles as K sweeps Ks, matched point to point by nearest neighbour. */
export function rootLocus(sys, Ks) {
  let prev = null;
  const branches = [];
  for (const K of Ks) {
    let r = closedLoopPoles(sys, K);
    if (prev) {
      const used = new Set(), ordered = [];
      for (const p of prev) {
        let best = -1, bd = Infinity;
        r.forEach((q, j) => { if (used.has(j)) return; const dd = Math.hypot(p[0] - q[0], p[1] - q[1]); if (dd < bd) { bd = dd; best = j; } });
        used.add(best); ordered.push(r[best]);
      }
      r = ordered;
    }
    r.forEach((p, i) => { (branches[i] ||= []).push({ K, re: p[0], im: p[1] }); });
    prev = r;
  }
  return branches;
}

/** Real break-away / break-in points: real roots of num' den - num den' with K = -den/num > 0. */
export function breakPoints(sys) {
  const eq = polyAdd(polyMul(polyDeriv(sys.num), sys.den), polyScale(polyMul(sys.num, polyDeriv(sys.den)), -1));
  return roots(eq).filter((r) => Math.abs(r[1]) < 1e-9).map((r) => ({ s: r[0], K: -polyEval(sys.den, r[0]) / polyEval(sys.num, r[0]) })).filter((b) => b.K > 0);
}

/** The gain whose closed-loop pole sits nearest to the point s (used when a pole is dragged). */
export function gainNearest(sys, s, { kMin = 0.05, kMax = 50 } = {}) {
  const dist = (K) => Math.min(...closedLoopPoles(sys, K).map((p) => Math.hypot(p[0] - s[0], p[1] - s[1])));
  let bestK = kMin, bd = Infinity;
  for (let i = 0; i <= 400; i++) { const K = kMin * Math.pow(kMax / kMin, i / 400); const d = dist(K); if (d < bd) { bd = d; bestK = K; } }
  let lo = bestK / 1.03, hi = bestK * 1.03; // golden-section refine
  const g = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < 60; i++) { const a = hi - g * (hi - lo), b = lo + g * (hi - lo); if (dist(a) < dist(b)) hi = b; else lo = a; }
  return Math.min(kMax, Math.max(kMin, (lo + hi) / 2));
}

/** A simulation horizon long enough for the response to settle (about 8 time constants of the slowest pole). */
export function horizon(sys, K, viewEnd, { maxT = 400, steps = 16000 } = {}) {
  const sig = Math.min(...closedLoopPoles(sys, K).map((p) => Math.abs(p[0])).filter((v) => v > 1e-9));
  const tEnd = Math.min(maxT, Math.max(viewEnd, 8 / sig));
  return { tEnd, dt: Math.max(1e-3, tEnd / steps) };
}

/** Everything a view needs at gain K, in one call. */
export function analyse(sys, K, { tEnd = 8, dt = 1e-3 } = {}) {
  const cl = closedLoop(sys, K);
  const poles = roots(cl.den);
  const step = stepResponse(cl, { tEnd, dt });
  const info = stepInfo(step);
  const so = secondOrder(cl.den);
  const m = margins(sys, K);
  return { K, cl, poles, step, info, so, margins: m };
}

/** The lesson's plant: G(s) = K / (s (s + 2)). */
export const PLANT = { num: [1], den: [1, 2, 0], label: 'K / s(s+2)' };
