// The four-bar's position solve: where the coupler and the rocker meet, by intersecting the circle
// round the crank pin A (radius AB) with the circle round O4 (radius O4B). Closed form, so it is
// exact at every driver angle; the angles of the coupler and rocker are read off the pin it lands on.
import { asWritten } from "../print.ts";
import type { FourBar, Point } from "./model.ts";

const RAD = Math.PI / 180;
export const DEG = 180 / Math.PI;

/** An angle in degrees, in [0, 360). */
export const wrapDegrees = (deg: number) => {
  const wrapped = ((deg % 360) + 360) % 360;
  // −1e-15 wraps to 360 − 1e-15, which rounds to 360: keep it at 0.
  return wrapped >= 360 ? 0 : wrapped;
};

/** The linkage can't close at this driver angle: the coupler and rocker can't reach each other. */
export class AssemblyError extends Error {
  readonly theta: number;
  constructor(theta: number, message: string) {
    super(message);
    this.name = "AssemblyError";
    this.theta = theta;
  }
}

export interface FourBarSolution {
  A: Point;
  B: Point;
  /** The coupler's angle (A to B) and the rocker's (O4 to B), in degrees, [0, 360). */
  theta3: number;
  theta4: number;
}

export function solveFourBar(m: FourBar, theta: number): FourBarSolution {
  const { ground: d, crank: a, coupler: b, rocker: c } = m;
  const t = theta * RAD;
  const A: Point = [a * Math.cos(t), a * Math.sin(t)];
  const dx = d - A[0];
  const dy = -A[1];
  const L = Math.hypot(dx, dy);
  if (L > b + c || L < Math.abs(b - c))
    throw new AssemblyError(
      theta,
      `the linkage can't close at θ = ${asWritten(theta)}°: the coupler and the rocker can't reach each other`,
    );
  const x = (b * b - c * c + L * L) / (2 * L);
  const h = Math.sqrt(Math.max(b * b - x * x, 0));
  const ux = dx / L;
  const uy = dy / L;
  // n is u turned a quarter CCW, so + is left of the line from A to O4 (`open`).
  const s = m.assembly === "open" ? 1 : -1;
  const B: Point = [A[0] + x * ux + s * h * -uy, A[1] + x * uy + s * h * ux];
  return {
    A,
    B,
    theta3: wrapDegrees(Math.atan2(B[1] - A[1], B[0] - A[0]) * DEG),
    theta4: wrapDegrees(Math.atan2(B[1], B[0] - d) * DEG),
  };
}

/** The transmission angle between coupler and rocker, folded into 0–90° (Norton's convention). */
export function transmissionAngle(theta3: number, theta4: number): number {
  const between = Math.abs(theta3 - theta4) % 360;
  const folded = between > 180 ? 360 - between : between;
  return folded > 90 ? 180 - folded : folded;
}

/** Why the crank can't be driven a full turn: Grashof's rule, and which link must be the shortest. */
export function fourBarProblems(m: FourBar): string[] {
  const named = [
    ["ground", m.ground],
    ["crank", m.crank],
    ["coupler", m.coupler],
    ["rocker", m.rocker],
  ] as const;
  const lengths = named.map(([, length]) => length).sort((p, q) => p - q) as [number, number, number, number];
  const [s, p, q, l] = lengths;
  if (s + l >= p + q)
    return [
      `the crank can't be driven round a full turn: a four-bar turns fully only when s + l < p + q (Grashof), and here s + l = ${asWritten(s + l)} ≥ p + q = ${asWritten(p + q)}`,
    ];
  if (m.crank !== s && m.ground !== s) {
    const shortest = named.find(([, length]) => length === s)?.[0] ?? "";
    return [
      `the crank can't turn fully: in a Grashof four-bar only the shortest link turns fully, as the crank (crank-rocker) or the ground (double crank); here the shortest is the ${shortest}`,
    ];
  }
  return [];
}
