// A spur gear pair's geometry: standard full-depth involute teeth (addendum m, dedendum 1.25 m, no
// backlash, no profile shift), their outlines, and how far a point lies inside a gear's true tooth
// profile. Lengths are in mm. Each gear is described in its own frame, tooth 0 centred on +x, tooth
// k at 2πk/N; the pair's two frames meet in `pose.ts` and `mesh.ts`.
import { asWritten } from "../print.ts";
import { wrapDegrees } from "./four-bar.ts";
import type { GearPair, Point } from "./model.ts";

const RAD = Math.PI / 180;
const TWO_PI = 2 * Math.PI;

/** The involute function: inv(α) = tan α − α. */
const inv = (alpha: number) => Math.tan(alpha) - alpha;

/** A gear's circles and its tooth, from the pair's model. */
export interface Gear {
  n: number;
  /** Pitch, base, tip and root radii. */
  r: number;
  rb: number;
  ra: number;
  rf: number;
  /** The pressure angle, in radians. */
  phi: number;
}

export function gearOf(m: GearPair, which: 0 | 1): Gear {
  const n = m.teeth[which];
  const phi = m.pressureAngle * RAD;
  const r = (m.module * n) / 2;
  return { n, r, rb: r * Math.cos(phi), ra: r + m.module, rf: r - 1.25 * m.module, phi };
}

/**
 * Half the tooth's angle at radius ρ: π/2N on the pitch circle, narrowing to the tip. Below the base
 * circle the flank is radial (no undercut is modelled), so it stays what it is at the base circle.
 */
export function halfTooth(g: Gear, rho: number): number {
  const at = Math.max(rho, g.rb);
  return Math.PI / (2 * g.n) + inv(g.phi) - inv(Math.acos(g.rb / at));
}

/** The driven gear's turn at the driver's angle: rolling opposite, a space facing the driver's tooth at home. */
export function drivenAngle(m: GearPair, theta: number): number {
  const [n1, n2] = m.teeth;
  return wrapDegrees(180 + 180 / n2 - (theta * n1) / n2);
}

/** The pair's centre distance: as the figure states it, else m(N1 + N2)/2. */
export const standardCentre = (m: GearPair) => (m.module * (m.teeth[0] + m.teeth[1])) / 2;
export const centreOf = (m: GearPair) => m.centreDistance ?? standardCentre(m);

/** Every number the pair gives besides its motion. */
export function gearQuantities(m: GearPair, theta: number): Record<string, number> {
  const [g1, g2] = [gearOf(m, 0), gearOf(m, 1)];
  const a = centreOf(m);
  // The path of contact from the base circles' common tangent: the operating pressure angle is
  // where the pair actually works, equal to the pressure angle at the standard centre distance.
  const working = Math.acos(Math.min((g1.rb + g2.rb) / a, 1));
  const path = Math.sqrt(g1.ra ** 2 - g1.rb ** 2) + Math.sqrt(g2.ra ** 2 - g2.rb ** 2) - a * Math.sin(working);
  return {
    d1: 2 * g1.r,
    d2: 2 * g2.r,
    a,
    ratio: g2.n / g1.n,
    db1: 2 * g1.rb,
    db2: 2 * g2.rb,
    da1: 2 * g1.ra,
    da2: 2 * g2.ra,
    contactRatio: path / (Math.PI * m.module * Math.cos(g1.phi)),
    driven: drivenAngle(m, theta),
  };
}

/** Whether a gear's teeth have a tip at all. */
function check(g: Gear): void {
  if (halfTooth(g, g.ra) <= 0)
    throw new Error(`a gear of ${asWritten(g.n)} teeth at ${asWritten(g.phi / RAD)}° has teeth that come to a point`);
}

/** One tooth's vertices in the gear's frame, CCW, with the root arc up to the next tooth. */
export function toothOutline(g: Gear, k: number, samplesPerFlank: number): Point[] {
  check(g);
  const centre = (TWO_PI * k) / g.n;
  const start = Math.max(g.rf, g.rb);
  const at = (rho: number, angle: number): Point => [rho * Math.cos(angle), rho * Math.sin(angle)];
  const flank: number[] = [];
  for (let i = 0; i < samplesPerFlank; i++) flank.push(start + ((g.ra - start) * i) / (samplesPerFlank - 1));
  const points: Point[] = [];
  const side = (sign: 1 | -1, rhos: readonly number[]) => rhos.map((rho) => at(rho, centre + sign * halfTooth(g, rho)));
  // The rising flank, with a radial run down to the root when the root lies under the base circle.
  if (g.rf < g.rb) points.push(at(g.rf, centre - halfTooth(g, g.rb)));
  points.push(...side(-1, flank));
  // The tip arc, its ends being the flanks' last points.
  const tip = halfTooth(g, g.ra);
  for (let i = 1; i < 4; i++) points.push(at(g.ra, centre - tip + (2 * tip * i) / 4));
  points.push(...side(1, [...flank].reverse()));
  if (g.rf < g.rb) points.push(at(g.rf, centre + halfTooth(g, g.rb)));
  // The root arc to the next tooth's first flank point.
  const root = halfTooth(g, g.rf);
  const gap = TWO_PI / g.n - 2 * root;
  for (let i = 1; i < 6; i++) points.push(at(g.rf, centre + root + (gap * i) / 6));
  return points;
}

/** A gear's whole outline in its own frame, CCW, not closed: `samplesPerFlank` points up each flank. */
export function gearOutline(m: GearPair, which: 0 | 1, samplesPerFlank = 24): Point[] {
  const g = gearOf(m, which);
  return Array.from({ length: g.n }, (_, k) => toothOutline(g, k, samplesPerFlank)).flat();
}

/**
 * The shortest distance from a point to the gear's true boundary, the point given as its radius ρ and
 * its angle δ ≥ 0 off the nearest tooth's centre. The boundary is the tooth's flank (an involute above
 * the base circle, a radial line below it), the tip arc over the tip and the root arc between teeth.
 * A flank's foot of perpendicular is exact: the normal to an involute is a tangent to the base circle,
 * so the two tangents from the point to that circle name the only two candidates.
 */
function distanceToProfile(g: Gear, rho: number, delta: number): number {
  const tip = halfTooth(g, g.ra);
  const root = halfTooth(g, g.rf);
  const [x, y] = [rho * Math.cos(delta), rho * Math.sin(delta)];
  const toPoint = (r: number, angle: number) => Math.hypot(x - r * Math.cos(angle), y - r * Math.sin(angle));
  // The arcs, where the point lies within their angle; their ends are the flank's.
  let best = Math.min(toPoint(g.ra, tip), toPoint(g.rf, root));
  if (delta <= tip) best = Math.min(best, Math.abs(rho - g.ra));
  if (delta >= root) best = Math.min(best, Math.abs(rho - g.rf));
  // Below the base circle the flank runs radially down to the root.
  if (g.rf < g.rb) {
    const along = Math.min(Math.max(x * Math.cos(root) + y * Math.sin(root), g.rf), g.rb);
    best = Math.min(best, toPoint(along, root));
  }
  if (rho > g.rb) {
    const base = halfTooth(g, g.rb);
    const beta = Math.acos(g.rb / rho);
    const start = Math.max(g.rf, g.rb);
    const first = start > g.rb ? Math.sqrt(start ** 2 - g.rb ** 2) / g.rb : 0;
    const last = Math.sqrt(g.ra ** 2 - g.rb ** 2) / g.rb;
    for (const tangent of [delta - beta, delta + beta]) {
      // tan α of the flank point whose normal runs through the base circle at `tangent`.
      const unrolled = base - tangent - TWO_PI * Math.round((base - tangent) / TWO_PI);
      if (unrolled < first || unrolled > last) continue;
      best = Math.min(best, Math.abs(rho * Math.sin(delta - tangent) - g.rb * unrolled));
    }
  }
  return best;
}

/**
 * How far a point (in the gear's frame) lies inside the gear, in mm, on the true involute and not the
 * outline's polygon: positive inside, negative outside, the distance to the nearest part of the
 * profile either way. A point at the contact of two conjugate teeth reads 0.
 */
export function insideDepth(m: GearPair, which: 0 | 1, local: Point): number {
  const g = gearOf(m, which);
  const rho = Math.hypot(local[0], local[1]);
  const pitch = TWO_PI / g.n;
  const wrapped = Math.atan2(local[1], local[0]);
  const delta = Math.abs(wrapped - pitch * Math.round(wrapped / pitch));
  const inside = rho <= g.rf || (rho <= g.ra && delta <= halfTooth(g, rho));
  const distance = distanceToProfile(g, rho, delta);
  return inside ? distance : -distance;
}
