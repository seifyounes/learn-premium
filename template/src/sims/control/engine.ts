// The control engine: a gain K in front of the Professor's plant G(s), under unity negative feedback
// (the block diagram's loop). Pure: it closes the loop, steps it exactly (the matrix exponential, as
// python-control does), reads the step characteristics off the response by the Professor's own
// definitions, pinned in the Course style sheet, and gives the open loop's frequency response, its
// margins and the root locus. The number gate runs it in Node; the page runs the same code.
// python-control is the build-time oracle only: it checks this engine and never loads in the page.
import { abs, expm, fromRoots, ordered, plus, roots, scale, type Complex, type Matrix } from "./linear.ts";

/** A root as the Materials write it: a real number, or a complex pair re ± j·im as [re, im]. */
export type Root = number | readonly [number, number];

export interface Model {
  /** G(s) = gain · Π(s − zero) / Π(s − pole), strictly proper. */
  plant: { gain: number; zeros: readonly Root[]; poles: readonly Root[] };
}

/**
 * The Professor's definitions the step characteristics are read by (CONTEXT.md, Course style
 * sheet): the settling band (the response stays within ±band of its final value from Ts on) and the
 * rise time's limits (from `from` to `to` of the final value).
 */
export interface Definitions {
  settlingTime: { band: number };
  riseTime: { from: number; to: number };
}

/** The roots a model's list writes, each complex pair as both of its members. */
export const rootsOf = (list: readonly Root[]): Complex[] =>
  list.flatMap((r): Complex[] =>
    typeof r === "number"
      ? [[r, 0]]
      : [
          [r[0], r[1]],
          [r[0], -r[1]],
        ],
  );

/** The plant's numerator and denominator polynomials, highest power first. */
export function plantPolynomials(model: Model) {
  const numerator = scale(fromRoots(rootsOf(model.plant.zeros)), model.plant.gain);
  const denominator = fromRoots(rootsOf(model.plant.poles));
  return { numerator, denominator };
}

export interface ClosedLoop {
  /** Y/R = K·N / (D + K·N), the denominator monic. */
  numerator: number[];
  denominator: number[];
  /** Its poles, in a fixed order: upper half-plane first, then rightmost first. */
  poles: Complex[];
  /** Every pole strictly in the left half-plane. */
  stable: boolean;
}

export function closedLoop(model: Model, K: number): ClosedLoop {
  const { numerator, denominator } = plantPolynomials(model);
  const kn = scale(numerator, K);
  const characteristic = plus(denominator, kn);
  const lead = characteristic[0] ?? 1;
  const poles = ordered(roots(characteristic));
  return {
    numerator: scale(kn, 1 / lead),
    denominator: scale(characteristic, 1 / lead),
    poles,
    stable: poles.every(([re, im]) => re < -1e-9 * Math.hypot(re, im)),
  };
}

/**
 * The closed loop in controllable canonical form, ẋ = Ax + Bu, y = Cx, augmented with the step
 * input as a state: e^(Mt) then holds the response to a unit step from rest.
 */
function stateSpace(loop: ClosedLoop) {
  const n = loop.denominator.length - 1;
  const a = loop.denominator.slice(1);
  const num = Array.from({ length: n }, (_, i) => loop.numerator[loop.numerator.length - 1 - i] ?? 0);
  const m: Matrix = Array.from({ length: n + 1 }, () => Array.from({ length: n + 1 }, () => 0));
  for (let i = 0; i < n - 1; i++) (m[i] as number[])[i + 1] = 1;
  a.forEach((c, j) => ((m[n - 1] as number[])[n - 1 - j] = -c));
  (m[n - 1] as number[])[n] = 1;
  return { n, m, c: num };
}

/** The unit-step response's state at t, and the output and its slope there. */
function stateAt(space: ReturnType<typeof stateSpace>, t: number) {
  const { n, m, c } = space;
  const e = expm(m.map((row) => row.map((v) => v * t)));
  const x = Array.from({ length: n }, (_, i) => e[i]?.[n] ?? 0);
  const y = c.reduce((s, ci, i) => s + ci * (x[i] ?? 0), 0);
  // ẋ = A x + B: the last row of M times [x, 1].
  const dx = Array.from({ length: n }, (_, i) =>
    (m[i] ?? []).reduce((s, v, j) => s + v * (j < n ? (x[j] ?? 0) : 1), 0),
  );
  const slope = c.reduce((s, ci, i) => s + ci * (dx[i] ?? 0), 0);
  return { y, slope };
}

/** The closed loop's unit-step response at time t. */
export const stepAt = (model: Model, K: number, t: number) => stateAt(stateSpace(closedLoop(model, K)), t).y;

/** How long the response is scanned for: long past the slowest pole's settling. */
export function horizon(loop: ClosedLoop, band = 0.02): number {
  const slowest = Math.min(...loop.poles.map(([re]) => Math.abs(re)).filter((r) => r > 0));
  return (Math.log(1 / band) + 8) / (Number.isFinite(slowest) ? slowest : 1);
}

/** The response sampled at n + 1 evenly spaced times from 0 to `until`, as [t, y]. */
export function stepCurve(model: Model, K: number, until: number, n = 400): [number, number][] {
  const space = stateSpace(closedLoop(model, K));
  const dt = until / n;
  const e = expm(space.m.map((row) => row.map((v) => v * dt)));
  let x = Array.from({ length: space.n + 1 }, (_, i) => +(i === space.n));
  const out: [number, number][] = [];
  for (let k = 0; k <= n; k++) {
    out.push([k * dt, space.c.reduce((s, ci, i) => s + ci * (x[i] ?? 0), 0)]);
    x = e.map((row) => row.reduce((s, v, j) => s + v * (x[j] ?? 0), 0));
  }
  return out;
}

export interface StepInfo {
  /** The value the response settles to: the closed loop's DC gain. */
  final: number;
  /** The highest value, and when it is reached; absent when the response never overshoots. */
  peak?: number;
  Tp?: number;
  /** Per cent above the final value at the peak; 0 when it never overshoots. */
  overshoot: number;
  /**
   * When the response first reaches the rise time's lower limit, and how long it then takes to reach
   * its upper; absent when it never reaches one (a 100 % limit it only approaches).
   */
  riseFrom?: number;
  Tr?: number;
  /** When the response last leaves the pinned band round its final value. */
  Ts: number;
}

/** Bisection on a sign change of f between a and b, to the last float. */
function crossing(f: (t: number) => number, a: number, b: number): number {
  let [lo, hi] = [a, b];
  const below = f(lo) < 0;
  for (let i = 0; i < 200 && hi - lo > 1e-15 * Math.max(1, hi); i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < 0 === below) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * The response sampled for a scan, before each event is found exactly by bisection. Each pole's
 * mode is sampled finely for as long as it lasts (its own horizon): 4000 samples over that span,
 * and never fewer than 24 a swing of an oscillating one, so no two samples straddle a swing. A
 * fast transient keeps its resolution however slow another pole makes the whole horizon.
 */
function scan(loop: ClosedLoop, band: number): [number, number][] {
  const space = stateSpace(loop);
  const until = horizon(loop, band);
  const modes = loop.poles.map(([re, im]) => {
    const lasts = Math.min(until, (Math.log(1 / band) + 8) / Math.abs(re));
    return { lasts, dt: Math.min(lasts / 4000, im !== 0 ? (2 * Math.PI) / Math.abs(im) / 24 : Infinity) };
  });
  const steps = new Map<number, Matrix>();
  const stepOf = (dt: number) => {
    let e = steps.get(dt);
    if (!e) steps.set(dt, (e = expm(space.m.map((row) => row.map((v) => v * dt)))));
    return e;
  };
  let x = Array.from({ length: space.n + 1 }, (_, i) => +(i === space.n));
  const out: [number, number][] = [];
  let t = 0;
  while (out.length < 2_000_000) {
    out.push([t, space.c.reduce((s, ci, i) => s + ci * (x[i] ?? 0), 0)]);
    if (t >= until) break;
    const dt = Math.min(until - t, ...modes.filter((m) => m.lasts > t).map((m) => m.dt), until / 4000);
    const e = stepOf(dt);
    x = e.map((row) => row.reduce((s, v, j) => s + v * (x[j] ?? 0), 0));
    t += dt;
  }
  return out;
}

/**
 * The step characteristics, by the pinned definitions. Undefined when the closed loop is unstable
 * (the response settles nowhere), settles to 0 (a band and limits read as shares of 0 are none),
 * or settles too slowly for the scan to see it settle.
 */
export function stepInfo(model: Model, K: number, definitions: Definitions): StepInfo | undefined {
  const loop = closedLoop(model, K);
  if (!loop.stable) return undefined;
  const space = stateSpace(loop);
  const final = (loop.numerator.at(-1) ?? 0) / (loop.denominator.at(-1) ?? 1);
  if (Math.abs(final) < 1e-12) return undefined;
  const { band } = definitions.settlingTime;
  const { from, to } = definitions.riseTime;
  const samples = scan(loop, band);
  // A scan stopped by its cap before the horizon can't tell where the response settles.
  if ((samples.at(-1)?.[0] ?? 0) < horizon(loop, band)) return undefined;
  const y = (t: number) => stateAt(space, t).y;
  const time = (k: number) => samples[k]?.[0] ?? 0;
  const value = (k: number) => samples[k]?.[1] ?? 0;
  const sign = Math.sign(final) || 1;

  // Rise: the first time the response reaches each limit.
  const reaches = (level: number) => {
    const k = samples.findIndex(([, v]) => sign * (v - level * final) >= 0);
    if (k < 0) return undefined;
    return k === 0 ? 0 : crossing((t) => sign * (y(t) - level * final), time(k - 1), time(k));
  };
  const riseFrom = reaches(from);
  const riseTo = reaches(to);

  // Settling: the last time the response is outside the band, then inside it for good.
  const outside = (v: number) => Math.abs(v / final - 1) - band;
  let last = -1;
  samples.forEach(([, v], k) => {
    if (outside(v) >= 0) last = k;
  });
  if (last === samples.length - 1) return undefined;
  let Ts = last < 0 ? 0 : crossing((t) => outside(y(t)), time(last), time(last + 1));
  // A swing that only just leaves the band can peak between two samples inside it: each turn after
  // the last sample outside is found where the slope changes sign, and one outside the band
  // settles later, where the response comes back in after it.
  const slopeAt = (t: number) => stateAt(space, t).slope;
  for (let k = Math.max(1, last + 1); k < samples.length - 1; k++) {
    const turns = (value(k) - value(k - 1)) * (value(k + 1) - value(k)) <= 0;
    if (!turns) continue;
    const [a, b] = [time(k - 1), time(k + 1)];
    if (Math.sign(slopeAt(a)) === Math.sign(slopeAt(b))) continue;
    const turn = crossing(slopeAt, a, b);
    if (outside(y(turn)) >= 0) Ts = crossing((t) => outside(y(t)), turn, b);
  }

  // Peak: where the slope turns, past the highest sample, if the response ever passes its final value.
  let top = 0;
  samples.forEach(([, v], k) => {
    if (sign * v > sign * value(top)) top = k;
  });
  const info: StepInfo = { final, overshoot: 0, Ts };
  if (riseFrom !== undefined && riseTo !== undefined) Object.assign(info, { riseFrom, Tr: riseTo - riseFrom });
  if (sign * (value(top) - final) > 0 && top < samples.length - 1) {
    const slope = (t: number) => sign * stateAt(space, t).slope;
    const [before, after] = [time(Math.max(0, top - 1)), time(top + 1)];
    // The slope turns between the highest sample's neighbours; if it doesn't, that sample is the peak.
    const Tp = slope(before) > 0 && slope(after) < 0 ? crossing((t) => -slope(t), before, after) : time(top);
    const peak = y(Tp);
    Object.assign(info, { peak, Tp, overshoot: (100 * (peak - final)) / final });
  }
  return info;
}

/**
 * The open loop K·G(jω): magnitude, phase (continuous, in degrees; a negative loop gain turns it
 * by −180°) and its real and imaginary parts.
 */
export function frequency(model: Model, K: number, w: number) {
  const s: Complex = [0, w];
  const zeros = rootsOf(model.plant.zeros);
  const poles = rootsOf(model.plant.poles);
  // Each factor's angle runs continuously up the frequency axis: a right half-plane root's would
  // jump from −180° to 180° as ω passes its imaginary part, so it is taken in (0°, 360°).
  const angle = ([re, im]: Complex) => {
    const a = (Math.atan2(w - im, -re) * 180) / Math.PI;
    return re > 0 && a < 0 ? a + 360 : a;
  };
  const phase =
    zeros.reduce((a, z) => a + angle(z), 0) -
    poles.reduce((a, p) => a + angle(p), 0) -
    (K * model.plant.gain < 0 ? 180 : 0);
  const magnitude =
    Math.abs(K * model.plant.gain) *
    zeros.reduce((m, z) => m * abs([s[0] - z[0], s[1] - z[1]]), 1) *
    poles.reduce((m, p) => m / abs([s[0] - p[0], s[1] - p[1]]), 1);
  const turn = (phase * Math.PI) / 180;
  return { magnitude, phase, re: magnitude * Math.cos(turn), im: magnitude * Math.sin(turn) };
}

/** An angle in degrees, in (−180°, 180°]. */
const wrapped = (degrees: number) => {
  const a = (((degrees + 180) % 360) + 360) % 360;
  return a === 0 ? 180 : a - 180;
};

/** Frequencies a scan looks over, decades round the plant's poles and zeros. */
export function frequencyRange(model: Model): [number, number] {
  const corners = [...rootsOf(model.plant.zeros), ...rootsOf(model.plant.poles)].map(abs).filter((r) => r > 0);
  const lo = corners.length ? Math.min(...corners) : 1;
  const hi = corners.length ? Math.max(...corners) : 1;
  return [lo / 1000, hi * 1000];
}

export interface Margins {
  /** The gain crossover (|L| = 1), in rad/s, and the phase margin there, in degrees. */
  wc?: number;
  PM?: number;
  /** The phase crossover (phase −180°), in rad/s, and the gain margin there, in dB. */
  wpc?: number;
  GM?: number;
}

/**
 * The first gain and phase crossovers up the frequency axis, found exactly by bisection on log ω.
 * The scan starts round the plant's corners and widens a decade at a time while the loop gain
 * still crosses 1 beyond it: the gain moves the crossover anywhere.
 */
export function margins(model: Model, K: number): Margins {
  let [lo, hi] = frequencyRange(model);
  const size = (w: number) => frequency(model, K, w).magnitude;
  for (let i = 0; i < 20 && size(hi) >= 1; i++) hi *= 10;
  // Down while the loop gain still changes from decade to decade, rising or falling: below that it
  // is flat at its DC value and crosses 1 nowhere lower.
  for (let i = 0; i < 20 && Math.abs(Math.log10(size(lo / 10) / size(lo))) > 1e-12; i++) lo /= 10;
  const at = (u: number) => frequency(model, K, 10 ** u);
  const gain = (u: number) => Math.log10(at(u).magnitude);
  // The phase crossover is where L(jω) crosses the negative real axis, read off the response
  // itself, so no unwrapping of the phase can fake one.
  const imag = (u: number) => at(u).im;
  const out: Margins = {};
  const steps = 4000;
  const [a, b] = [Math.log10(lo), Math.log10(hi)];
  // An even log grid, and round each lightly damped root's resonance a fine comb across its width
  // (|re| either side of |root|, in steps of a tenth of it): a narrow peak can lift the gain over 1
  // and back between two grid points.
  const comb = [...rootsOf(model.plant.zeros), ...rootsOf(model.plant.poles)].flatMap(([re, im]) => {
    const r = abs([re, im]);
    if (im === 0 || r === 0) return [];
    const width = Math.max(Math.abs(re), r * 1e-9);
    return Array.from({ length: 81 }, (_, i) => r + ((i - 40) / 10) * width * 4).filter((w) => w > 0);
  });
  const grid = [...Array.from({ length: steps + 1 }, (_, k) => a + ((b - a) * k) / steps), ...comb.map(Math.log10)]
    .filter((v) => v >= a && v <= b)
    .sort((x, y) => x - y);
  const u = (k: number) => grid[k] ?? b;
  // A pole or zero on the imaginary axis flips L(jω) through infinity or 0 there: a sign change of
  // its imaginary part across one is no crossing of the negative real axis.
  const onAxis = [...rootsOf(model.plant.zeros), ...rootsOf(model.plant.poles)]
    .filter(([re, im]) => im > 0 && Math.abs(re) <= 1e-12 * im)
    .map(([, im]) => im);
  for (let k = 0; k < grid.length - 1; k++) {
    if (u(k) === u(k + 1)) continue;
    if (out.wc === undefined && Math.sign(gain(u(k))) !== Math.sign(gain(u(k + 1))) && gain(u(k)) !== 0) {
      out.wc = 10 ** crossing(gain, u(k), u(k + 1));
      out.PM = wrapped(frequency(model, K, out.wc).phase + 180);
    }
    if (
      out.wpc === undefined &&
      Math.sign(imag(u(k))) !== Math.sign(imag(u(k + 1))) &&
      imag(u(k)) !== 0 &&
      !onAxis.some((w) => w >= 10 ** u(k) && w <= 10 ** u(k + 1))
    ) {
      const w = 10 ** crossing(imag, u(k), u(k + 1));
      const there = frequency(model, K, w);
      if (there.re < 0) {
        out.wpc = w;
        out.GM = -20 * Math.log10(there.magnitude);
      }
    }
  }
  return out;
}

/**
 * The root locus over the gains given, one branch per closed-loop pole, each followed from one
 * gain to the next by its nearest pole.
 */
export function locus(model: Model, gains: readonly number[]): Complex[][] {
  const branches: Complex[][] = [];
  for (const K of gains) {
    const poles = K === 0 ? ordered(rootsOf(model.plant.poles)) : closedLoop(model, K).poles;
    if (branches.length === 0) {
      poles.forEach((p) => branches.push([p]));
      continue;
    }
    const left = [...poles];
    for (const branch of branches) {
      const last = branch.at(-1) ?? [0, 0];
      let best = 0;
      left.forEach((p, i) => {
        if (
          abs([p[0] - last[0], p[1] - last[1]]) <
          abs([(left[best]?.[0] ?? 0) - last[0], (left[best]?.[1] ?? 0) - last[1]])
        )
          best = i;
      });
      branch.push(left.splice(best, 1)[0] ?? last);
    }
  }
  return branches;
}

/** Every number the engine gives at the gain K, by the names sheets and recompute logs use. */
export function quantities(model: Model, inputs: { K: number }, definitions: Definitions): Record<string, number> {
  const loop = closedLoop(model, inputs.K);
  const named: Record<string, number> = {};
  loop.poles.forEach(([re, im], i) => {
    named[`pole[${i}].re`] = re;
    named[`pole[${i}].im`] = im;
  });
  // A second-order loop s² + 2ζωn s + ωn² has a damping ratio and natural frequency.
  if (loop.denominator.length === 3 && (loop.denominator[2] ?? 0) > 0) {
    const wn = Math.sqrt(loop.denominator[2] ?? 0);
    named.wn = wn;
    named.zeta = (loop.denominator[1] ?? 0) / (2 * wn);
  }
  const info = stepInfo(model, inputs.K, definitions);
  if (info) {
    named.final = info.final;
    named.overshoot = info.overshoot;
    if (info.Tr !== undefined) named.Tr = info.Tr;
    named.Ts = info.Ts;
    if (info.peak !== undefined && info.Tp !== undefined) {
      named.peak = info.peak;
      named.Tp = info.Tp;
    }
  }
  const m = margins(model, inputs.K);
  for (const key of ["wc", "PM", "wpc", "GM"] as const) if (m[key] !== undefined) named[key] = m[key];
  return named;
}
