// The independent reference solver for the kinematics engine's tests. It imports nothing from
// `src/`, and it shares no method with the engine: the engine closes a four-bar by intersecting two
// circles, this one by Newton–Raphson on the loop's two closure equations (no circle intersection
// appears anywhere). Lengths are in mm, angles in degrees, the sheet frame x along O2→O4 and y up.

export type Point = readonly [x: number, y: number];

const RAD = Math.PI / 180;
const wrap = (deg: number) => ((deg % 360) + 360) % 360;

export interface FourBarModel {
  ground: number;
  crank: number;
  coupler: number;
  rocker: number;
  assembly: "open" | "crossed";
  couplerPoint?: { along: number; off: number } | undefined;
}

/** Newton's iteration cap, and what counts as closed. */
const MAX_ITERATIONS = 50;
const CLOSED = 1e-12;

/**
 * The four-bar at each θ2 = k·360/steps, k = 0 … steps − 1: the coupler's and rocker's angles, and the
 * pins A, B (and P, the coupler point) off the ground, each in the sheet frame. Throws when it can't
 * close, or when the Newton step carries it onto the other assembly.
 */
export function fourBarReference(
  m: FourBarModel,
  steps = 360,
): { theta3: number[]; theta4: number[]; A: Point[]; B: Point[]; P?: Point[] } {
  const { ground: d, crank: a, coupler: b, rocker: c } = m;
  const sign = m.assembly === "open" ? 1 : -1;

  /** The loop's closure: where A + AB meets O4 + O4B, as a pair of residuals. */
  const closure = (t2: number, t3: number, t4: number): [number, number] => [
    a * Math.cos(t2) + b * Math.cos(t3) - c * Math.cos(t4) - d,
    a * Math.sin(t2) + b * Math.sin(t3) - c * Math.sin(t4),
  ];
  /** Which side of the line A → O4 the joint B lies on: + left, − right (the cross product). */
  const side = (t2: number, t3: number) => {
    const A: Point = [a * Math.cos(t2), a * Math.sin(t2)];
    const B: Point = [A[0] + b * Math.cos(t3), A[1] + b * Math.sin(t3)];
    const toO4: Point = [d - A[0], -A[1]];
    return toO4[0] * (B[1] - A[1]) - toO4[1] * (B[0] - A[0]);
  };
  const newton = (t2: number, from: [number, number]): [number, number] | undefined => {
    let [t3, t4] = from;
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const [f, g] = closure(t2, t3, t4);
      if (Math.hypot(f, g) < CLOSED) return [t3, t4];
      // J = [[−b sin t3, c sin t4], [b cos t3, −c cos t4]]
      const j11 = -b * Math.sin(t3);
      const j12 = c * Math.sin(t4);
      const j21 = b * Math.cos(t3);
      const j22 = -c * Math.cos(t4);
      const det = j11 * j22 - j12 * j21;
      if (Math.abs(det) < 1e-14) return undefined;
      t3 -= (f * j22 - g * j12) / det;
      t4 -= (j11 * g - j21 * f) / det;
    }
    return undefined;
  };

  // Step 0: the 1° grid's best closure on the assembly's side, then Newton from it.
  let seed: [number, number] | undefined;
  let best = Infinity;
  const first = 0;
  for (let i = 0; i < 360; i++) {
    for (let j = 0; j < 360; j++) {
      const t3 = i * RAD;
      const t4 = j * RAD;
      if (Math.sign(side(first, t3)) !== sign) continue;
      const [f, g] = closure(first, t3, t4);
      const miss = Math.hypot(f, g);
      if (miss < best) {
        best = miss;
        seed = [t3, t4];
      }
    }
  }
  if (!seed) throw new Error("the reference found no assembly to start from");

  const out: { theta3: number[]; theta4: number[]; A: Point[]; B: Point[]; P?: Point[] } = {
    theta3: [],
    theta4: [],
    A: [],
    B: [],
  };
  if (m.couplerPoint) out.P = [];
  let at = seed;
  for (let k = 0; k < steps; k++) {
    const t2 = ((k * 360) / steps) * RAD;
    const solved = newton(t2, at);
    if (!solved) throw new Error(`the reference did not converge at θ2 = ${(k * 360) / steps}°`);
    if (Math.sign(side(t2, solved[0])) !== sign)
      throw new Error(`the reference lost its branch at θ2 = ${(k * 360) / steps}°`);
    at = solved;
    const [t3, t4] = solved;
    const A: Point = [a * Math.cos(t2), a * Math.sin(t2)];
    const B: Point = [A[0] + b * Math.cos(t3), A[1] + b * Math.sin(t3)];
    out.theta3.push(wrap(t3 / RAD));
    out.theta4.push(wrap(t4 / RAD));
    out.A.push(A);
    out.B.push(B);
    if (m.couplerPoint && out.P) {
      const { along, off } = m.couplerPoint;
      // P sits `along` AB from A and `off` to its left.
      out.P.push([A[0] + along * Math.cos(t3) - off * Math.sin(t3), A[1] + along * Math.sin(t3) + off * Math.cos(t3)]);
    }
  }
  return out;
}

export interface GearPairModel {
  module: number;
  teeth: readonly [number, number];
  pressureAngle: number;
  centreDistance?: number | undefined;
}

/**
 * The gear pair at each driver angle θ1 = k·360/steps: the driven gear's angle by the rolling of the
 * pitch circles (r1·Δθ1 = r2·Δθ2, opposite ways) from its home, the driver's handle H on its pitch
 * circle, and the driven gear's tooth tip T. The driven gear's home turns it half a pitch from facing
 * the driver, so a space faces the driver's tooth.
 */
export function gearReference(m: GearPairModel, steps = 360): { driven: number[]; H: Point[]; T: Point[] } {
  const [n1, n2] = m.teeth;
  const r1 = (m.module * n1) / 2;
  const r2 = (m.module * n2) / 2;
  const a = m.centreDistance ?? r1 + r2;
  const tip2 = r2 + m.module;
  const home = 180 + 180 / n2;
  const out: { driven: number[]; H: Point[]; T: Point[] } = { driven: [], H: [], T: [] };
  for (let k = 0; k < steps; k++) {
    const theta = (k * 360) / steps;
    const driven = wrap(home - (r1 / r2) * theta);
    out.driven.push(driven);
    out.H.push([r1 * Math.cos(theta * RAD), r1 * Math.sin(theta * RAD)]);
    out.T.push([a + tip2 * Math.cos(driven * RAD), tip2 * Math.sin(driven * RAD)]);
  }
  return out;
}
