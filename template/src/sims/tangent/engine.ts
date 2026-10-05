// The tangent engine: the derivative as the tangent's slope. A pure function of the model (the
// Professor's polynomial, which students never change) and the inputs students tune: the point a
// the tangent touches, and the run h of the first secant. Secants over runs shrinking by tenths
// close on the tangent's slope, the way the Professor's table does. The same code runs in Node
// for the build's number gate and in the page for the student.

export interface Model {
  /** f(x) = c0 + c1·x + c2·x² + …, lowest power first, as the Professor's polynomial gives them. */
  coefficients: readonly number[];
}

/** What a student tunes: where the tangent touches, and the first secant's run. */
export interface Inputs {
  a: number;
  h: number;
}

/** How many secants the table has: runs h, h/10, h/100. */
export const SECANTS = 3;

/** f(x), by Horner's rule. */
export function valueAt({ coefficients }: Model, x: number): number {
  return coefficients.reduceRight((sum, c) => sum * x + c, 0);
}

/** f′(x), from the power rule: Σ i·cᵢ·xⁱ⁻¹. */
export function slopeAt({ coefficients }: Model, x: number): number {
  return coefficients.reduceRight((sum, c, i) => (i === 0 ? sum : sum * x + i * c), 0);
}

export interface Tangent {
  /** f(a). */
  value: number;
  /** f′(a): the tangent's slope. */
  slope: number;
  /** Where the tangent y = f(a) + f′(a)(x − a) crosses x = 0. */
  intercept: number;
}

export function at(model: Model, { a }: Pick<Inputs, "a">): Tangent {
  const value = valueAt(model, a);
  const slope = slopeAt(model, a);
  return { value, slope, intercept: value - slope * a };
}

export interface Secant {
  /** The run: h, then each tenth of the one before. */
  run: number;
  /** f(a + run). */
  value: number;
  /** (f(a + run) − f(a)) / run. */
  slope: number;
}

export function secants(model: Model, { a, h }: Inputs): Secant[] {
  const base = valueAt(model, a);
  return Array.from({ length: SECANTS }, (_, k) => {
    // Divided, not multiplied by 0.1, so 0.1 and 0.01 are the numbers a sheet prints.
    const run = h / 10 ** k;
    const value = valueAt(model, a + run);
    return { run, value, slope: (value - base) / run };
  });
}

/**
 * Every number the engine gives, by the name a sheet mapping or a recompute log uses: `f(a)`,
 * `slope` and `intercept` for the tangent, then `h[k]`, `f(a+h)[k]` and `secant[k]` per secant.
 */
export function quantities(model: Model, inputs: Inputs): Record<string, number> {
  const tangent = at(model, inputs);
  const named: Record<string, number> = {
    "f(a)": tangent.value,
    slope: tangent.slope,
    intercept: tangent.intercept,
  };
  secants(model, inputs).forEach(({ run, value, slope }, k) => {
    named[`h[${k}]`] = run;
    named[`f(a+h)[${k}]`] = value;
    named[`secant[${k}]`] = slope;
  });
  return named;
}
