// The gradient-descent engine: batch gradient descent fitting the line h(x) = θ0 + θ1·x by the
// half mean squared error J(θ) = (1/2m) Σ (h(x) − y)². A pure function of the model (the
// Professor's data, which students never change) and the inputs students tune. The same code runs
// in Node for the build's number gate and in the page for the student.

export interface Model {
  /** The data points (x, y), as the Professor gives them. */
  data: readonly (readonly [number, number])[];
}

/** What a student tunes: where descent starts, the learning rate and how many steps it takes. */
export interface Inputs {
  theta0: number;
  theta1: number;
  alpha: number;
  iterations: number;
}

export interface Iterate {
  /** The iteration, counted from 0 (the start). */
  k: number;
  theta0: number;
  theta1: number;
  J: number;
}

export interface Trace {
  /** The start and every step after it, up to the last one with finite numbers. */
  iterates: Iterate[];
  /** α is past the limit: the steps overshoot the minimum further each time. */
  diverges: boolean;
  /** The least-squares fit: where descent ends when it converges. */
  minimum: { theta0: number; theta1: number; J: number };
  /** The largest α that still converges: 2 / λmax of the cost's Hessian. */
  alphaLimit: number;
}

interface Sums {
  m: number;
  x: number;
  xx: number;
}

const sums = ({ data }: Model): Sums => ({
  m: data.length,
  x: data.reduce((s, [x]) => s + x, 0),
  xx: data.reduce((s, [x]) => s + x * x, 0),
});

/** The cost at θ. */
export function cost({ data }: Model, theta0: number, theta1: number): number {
  const squared = data.reduce((s, [x, y]) => s + (theta0 + theta1 * x - y) ** 2, 0);
  return squared / (2 * data.length);
}

/** ∂J/∂θ0 and ∂J/∂θ1 at θ. */
function gradient({ data }: Model, theta0: number, theta1: number): [number, number] {
  let g0 = 0;
  let g1 = 0;
  for (const [x, y] of data) {
    const error = theta0 + theta1 * x - y;
    g0 += error;
    g1 += error * x;
  }
  return [g0 / data.length, g1 / data.length];
}

/** The Hessian (1/m) XᵀX, constant for a line fit: [[a, b], [b, c]]. */
function hessian(model: Model): { a: number; b: number; c: number } {
  const { m, x, xx } = sums(model);
  return { a: 1, b: x / m, c: xx / m };
}

/** Eigenvalues (larger first) and the unit eigenvector of the larger one. */
function eigen({ a, b, c }: { a: number; b: number; c: number }) {
  const mean = (a + c) / 2;
  const spread = Math.hypot((a - c) / 2, b);
  const large = mean + spread;
  const small = mean - spread;
  // (b, large − a) is an eigenvector of the larger eigenvalue; when b = 0 the axes are already aligned.
  const [vx, vy] = b === 0 ? (a >= c ? [1, 0] : [0, 1]) : [b, large - a];
  const norm = Math.hypot(vx, vy);
  return { large, small, axis: [vx / norm, vy / norm] as const };
}

function minimum(model: Model): Trace["minimum"] {
  const { m, x, xx } = sums(model);
  const y = model.data.reduce((s, [, yi]) => s + yi, 0);
  const xy = model.data.reduce((s, [xi, yi]) => s + xi * yi, 0);
  const det = m * xx - x * x;
  const theta1 = (m * xy - x * y) / det;
  const theta0 = (y - theta1 * x) / m;
  return { theta0, theta1, J: cost(model, theta0, theta1) };
}

export function descend(model: Model, { theta0, theta1, alpha, iterations }: Inputs): Trace {
  const iterates: Iterate[] = [{ k: 0, theta0, theta1, J: cost(model, theta0, theta1) }];
  let t0 = theta0;
  let t1 = theta1;
  for (let k = 1; k <= iterations; k++) {
    const [g0, g1] = gradient(model, t0, t1);
    // Both parameters move together, from the same gradient.
    const next0 = t0 - alpha * g0;
    const next1 = t1 - alpha * g1;
    const J = cost(model, next0, next1);
    if (!Number.isFinite(J)) break;
    t0 = next0;
    t1 = next1;
    iterates.push({ k, theta0: t0, theta1: t1, J });
  }
  const alphaLimit = 2 / eigen(hessian(model)).large;
  return { iterates, diverges: alpha > alphaLimit, minimum: minimum(model), alphaLimit };
}

/**
 * Every number a trace gives, by the name a sheet mapping or a recompute log uses: `theta0[k]`,
 * `theta1[k]` and `J[k]` per iterate, then the minimum and the α limit.
 */
export function quantities(trace: Trace): Record<string, number> {
  const named: Record<string, number> = {};
  for (const { k, theta0, theta1, J } of trace.iterates) {
    named[`theta0[${k}]`] = theta0;
    named[`theta1[${k}]`] = theta1;
    named[`J[${k}]`] = J;
  }
  named["minimum.theta0"] = trace.minimum.theta0;
  named["minimum.theta1"] = trace.minimum.theta1;
  named["minimum.J"] = trace.minimum.J;
  named["alpha.limit"] = trace.alphaLimit;
  return named;
}

/** A level curve of J: an ellipse about the minimum. */
export interface Contour {
  level: number;
  /** The point at parameter t (radians, 0 to 2π). */
  at(t: number): [number, number];
}

/**
 * The contour J(θ) = level. J is the minimum plus a quadratic form, so each contour is an ellipse
 * centred on the minimum with its axes along the Hessian's eigenvectors. None at or below the
 * minimum.
 */
export function contour(model: Model, level: number): Contour | undefined {
  const centre = minimum(model);
  const rise = 2 * (level - centre.J);
  // Rounding leaves the minimum's own level a hair above it: that is a point, not a contour.
  if (!(rise > 1e-12 * Math.max(1, Math.abs(level)))) return undefined;
  const { large, small, axis } = eigen(hessian(model));
  const [ux, uy] = axis;
  const r1 = Math.sqrt(rise / large);
  const r2 = Math.sqrt(rise / small);
  return {
    level,
    at: (t) => {
      const along = r1 * Math.cos(t);
      const across = r2 * Math.sin(t);
      return [centre.theta0 + along * ux - across * uy, centre.theta1 + along * uy + across * ux];
    },
  };
}
