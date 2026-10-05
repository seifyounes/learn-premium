// The plane-wall engine: transient conduction through a wall at one temperature whose two faces
// are suddenly held at another, ∂T/∂t = α ∂²T/∂x², marched by Crank–Nicolson. A pure function of
// the model (the Professor's wall, which students never change) and the inputs students tune: how
// long it has cooled, and the material's diffusivity. The same code runs in Node for the build's
// number gate and in the page for the student. Units are the model's own: lengths in one unit,
// α in that unit squared per second, time in seconds.

export interface Model {
  /** The wall's thickness L. */
  thickness: number;
  /** The whole wall's temperature before the faces change. */
  initial: number;
  /** What both faces are held at from t = 0. */
  surface: number;
}

/** What a student tunes: the time since the faces changed, and the thermal diffusivity α. */
export interface Inputs {
  time: number;
  diffusivity: number;
}

/** Intervals across the wall: a multiple of 4, so the quarter points are nodes. */
const INTERVALS = 80;
/**
 * The largest α·Δt/Δx² a step takes. Crank–Nicolson is stable at any, but the sudden change at the
 * faces rings through the wall when steps are long; at 1 or less it dies out in a few steps.
 */
const MAX_RATIO = 1;
/** The fewest steps any march takes, so a short time is still resolved. */
const MIN_STEPS = 40;

export interface Profile {
  /** The node positions, 0 to L. */
  x: number[];
  /** The temperature at each node. */
  T: number[];
  /** The temperature at x, between nodes by straight line. */
  at(x: number): number;
}

const nodes = (L: number) => Array.from({ length: INTERVALS + 1 }, (_, i) => (L * i) / INTERVALS);

/** The wall at t = 0: still at its initial temperature, its faces already at the surface's. */
function start({ initial, surface }: Model): number[] {
  return Array.from({ length: INTERVALS + 1 }, (_, i) => (i === 0 || i === INTERVALS ? surface : initial));
}

/**
 * A stepper for one Δt: each call takes T to the next step in place. Crank–Nicolson's
 * (1 + r)Tᵢ′ − (r/2)(Tᵢ₋₁′ + Tᵢ₊₁′) = (1 − r)Tᵢ + (r/2)(Tᵢ₋₁ + Tᵢ₊₁), the faces held, solved by
 * the Thomas algorithm with its forward sweep worked once.
 */
function stepper(r: number): (T: number[]) => void {
  const n = INTERVALS - 1; // the interior nodes
  const off = -r / 2;
  const diag = 1 + r;
  // Forward-sweep coefficients of the constant tridiagonal matrix.
  const c = new Float64Array(n);
  const m = new Float64Array(n);
  c[0] = off / diag;
  m[0] = diag;
  for (let i = 1; i < n; i++) {
    m[i] = diag - off * (c[i - 1] ?? 0);
    c[i] = off / (m[i] ?? 1);
  }
  const d = new Float64Array(n);
  return (T) => {
    const face0 = T[0] ?? 0;
    const face1 = T[INTERVALS] ?? 0;
    for (let i = 0; i < n; i++) {
      const left = T[i] ?? 0;
      const here = T[i + 1] ?? 0;
      const right = T[i + 2] ?? 0;
      let rhs = (1 - r) * here + (r / 2) * (left + right);
      // The held faces' terms move across from the matrix side of the equation.
      if (i === 0) rhs -= off * face0;
      if (i === n - 1) rhs -= off * face1;
      d[i] = (rhs - off * (i > 0 ? (d[i - 1] ?? 0) : 0)) / (m[i] ?? 1);
    }
    for (let i = n - 1; i >= 0; i--) {
      const next = i < n - 1 ? (T[i + 2] ?? 0) : 0;
      T[i + 1] = (d[i] ?? 0) - (c[i] ?? 0) * next;
    }
  };
}

/** How many steps a march to `time` takes, each no longer than the ratio allows. */
function stepsTo(model: Model, time: number, diffusivity: number): number {
  const dx = model.thickness / INTERVALS;
  const longest = (MAX_RATIO * dx * dx) / diffusivity;
  return Math.max(MIN_STEPS, Math.ceil(time / longest));
}

function interpolate(x: number[], T: number[]): (at: number) => number {
  const L = x.at(-1) ?? 0;
  return (at) => {
    const s = (Math.min(Math.max(at, 0), L) / L) * INTERVALS;
    const i = Math.min(Math.floor(s), INTERVALS - 1);
    const share = s - i;
    const lo = T[i] ?? 0;
    return share === 0 ? lo : lo + share * ((T[i + 1] ?? 0) - lo);
  };
}

/** The wall's temperatures at `time`. */
export function profile(model: Model, { time, diffusivity }: Inputs): Profile {
  const x = nodes(model.thickness);
  const T = start(model);
  if (time > 0) {
    const steps = stepsTo(model, time, diffusivity);
    const dx = model.thickness / INTERVALS;
    const step = stepper((diffusivity * (time / steps)) / (dx * dx));
    for (let k = 0; k < steps; k++) step(T);
  }
  return { x, T, at: interpolate(x, T) };
}

/** The probes a sheet reads, by name and share of L: the faces, the quarter points and the mid-plane. */
export const PROBES = [
  ["T(0)", 0],
  ["T(L/4)", 1 / 4],
  ["T(L/2)", 1 / 2],
  ["T(3L/4)", 3 / 4],
  ["T(L)", 1],
] as const;

/**
 * Every number the engine gives, by the name a sheet mapping or a recompute log uses: the
 * temperature at each probe, then the Fourier number Fo = αt/L².
 */
export function quantities(model: Model, inputs: Inputs): Record<string, number> {
  const { T } = profile(model, inputs);
  const named: Record<string, number> = {};
  for (const [name, share] of PROBES) named[name] = T[Math.round(share * INTERVALS)] ?? Number.NaN;
  named.Fo = (inputs.diffusivity * inputs.time) / model.thickness ** 2;
  return named;
}

/** T over x and t, for the heatmap: rows by time, columns by position. */
export interface Field {
  x: number[];
  t: number[];
  T: number[][];
}

/** How many rows of time the heatmap has after the start. */
const FIELD_ROWS = 60;

/** The wall from t = 0 to `until`, sampled at evenly spaced times. */
export function field(model: Model, { diffusivity, until }: { diffusivity: number; until: number }): Field {
  const x = nodes(model.thickness);
  const T = start(model);
  const rows = [[...T]];
  const t = [0];
  // A whole number of steps per row, so every row's time is exact.
  const per = Math.ceil(stepsTo(model, until, diffusivity) / FIELD_ROWS);
  const dt = until / (per * FIELD_ROWS);
  const dx = model.thickness / INTERVALS;
  const step = stepper((diffusivity * dt) / (dx * dx));
  for (let row = 1; row <= FIELD_ROWS; row++) {
    for (let k = 0; k < per; k++) step(T);
    rows.push([...T]);
    t.push(row * per * dt);
  }
  return { x, t, T: rows };
}
