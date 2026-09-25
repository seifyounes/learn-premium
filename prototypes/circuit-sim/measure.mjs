// PROTOTYPE: steady-state measurements over a time window (trapezoidal, handles uneven steps).
import { readFileSync } from "node:fs";
export function load(path) { return JSON.parse(readFileSync(path, "utf8")).vecs; }
export function win(v, name, t0, t1) {
  const t = v.time, y = v[name], ts = [], ys = [];
  if (!y) throw new Error(`no vector ${name}; have ${Object.keys(v)}`);
  for (let i = 0; i < t.length; i++) if (t[i] >= t0 && t[i] <= t1) { ts.push(t[i]); ys.push(y[i]); }
  return { ts, ys };
}
export function stats({ ts, ys }) {
  let a = 0, s = 0;
  for (let i = 1; i < ts.length; i++) {
    const dt = ts[i] - ts[i - 1];
    a += dt * (ys[i] + ys[i - 1]) / 2;
    s += dt * (ys[i] ** 2 + ys[i - 1] ** 2) / 2;
  }
  const T = ts.at(-1) - ts[0];
  return { avg: a / T, rms: Math.sqrt(s / T), max: Math.max(...ys), min: Math.min(...ys) };
}
export function cmp(label, got, want, tolPct) {
  const err = want === 0 ? Math.abs(got) : (100 * (got - want)) / Math.abs(want);
  const ok = Math.abs(err) <= tolPct;
  return { label, got: +got.toPrecision(5), want, errPct: +err.toFixed(2), tolPct, ok };
}
