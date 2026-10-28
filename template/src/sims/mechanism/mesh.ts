// How a gear pair's teeth meet: the outlines both views draw, placed by the pose, and the overlap
// and gap between the teeth. A vertex of one gear is judged against the other gear's true involute
// profile (`insideDepth`), so a vertex at the contact point reads ≈ 0, never inside: the verdict
// doesn't depend on how coarsely a polygon approximates the curve, only on how densely the vertices
// sample the flanks. Lengths are in mm.
import { centreOf, gearOf, gearOutline, insideDepth, toothOutline } from "./gears.ts";
import type { GearPair, Point } from "./model.ts";
import { applyMatrix, linkMatrix, pose, type LinkPose } from "./pose.ts";

const TWO_PI = 2 * Math.PI;

/** Both gears' outlines at the driver's angle, placed in the sheet frame by the pose. */
export function outlinesAt(model: GearPair, theta: number, samplesPerFlank = 24): [Point[], Point[]] {
  const { links } = pose(model, theta);
  const place = (outline: Point[], at: LinkPose | undefined) => {
    const matrix = linkMatrix(at ?? { at: [0, 0], angle: 0 });
    return outline.map((p) => applyMatrix(matrix, p));
  };
  return [
    place(gearOutline(model, 0, samplesPerFlank), links.driver),
    place(gearOutline(model, 1, samplesPerFlank), links.driven),
  ];
}

export interface Meshing {
  /** How far a vertex of one gear lies inside the other's teeth, at worst; 0 when none does. */
  overlap: number;
  /** How far the closest vertex lies outside them (radially); 0 when the teeth touch or overlap, Infinity when none is near. */
  gap: number;
  /** The gear whose vertex went deepest into the other, when the teeth overlap. */
  by?: 0 | 1;
}

/** A point of the sheet in a gear's own frame. */
function toLocal(link: LinkPose, p: Point): Point {
  const t = (-link.angle * Math.PI) / 180;
  const x = p[0] - link.at[0];
  const y = p[1] - link.at[1];
  return [x * Math.cos(t) - y * Math.sin(t), x * Math.sin(t) + y * Math.cos(t)];
}

/**
 * The overlap and the gap between two gears' teeth, from their outlines placed in the sheet frame
 * (`posed`, driver first) and the poses that placed them: each vertex inside the other gear's tip
 * circle is judged on the other's true profile.
 */
export function overlapOf(model: GearPair, posed: [Point[], Point[]], poses: [LinkPose, LinkPose]): Meshing {
  let overlap = 0;
  let gap = Infinity;
  let by: 0 | 1 | undefined;
  for (const mine of [0, 1] as const) {
    const other = (1 - mine) as 0 | 1;
    const tip = gearOf(model, other).ra;
    for (const vertex of posed[mine]) {
      const local = toLocal(poses[other], vertex);
      if (Math.hypot(local[0], local[1]) > tip) continue;
      const depth = insideDepth(model, other, local);
      if (depth > overlap) {
        overlap = depth;
        by = mine;
      }
      gap = Math.min(gap, -depth);
    }
  }
  return { overlap, gap: Math.max(gap, 0), ...(by === undefined ? {} : { by }) };
}

/** Per flank, how many vertices `meshAt` samples: one every ≈ 0.04 mm on an m 2 flank. */
const MESH_SAMPLES = 96;

/** The teeth of gear `which` that can reach the other gear's tip circle, as the gear sits in its pose. */
function teethInMesh(model: GearPair, which: 0 | 1, poses: [LinkPose, LinkPose]): number[] {
  const mine = gearOf(model, which);
  const other = gearOf(model, (1 - which) as 0 | 1);
  const a = centreOf(model);
  const here = poses[which];
  const there = poses[(1 - which) as 0 | 1];
  const toOther = Math.atan2(there.at[1] - here.at[1], there.at[0] - here.at[0]) - (here.angle * Math.PI) / 180;
  // The other gear's tip circle meets mine within this angle either side of the line of centres.
  const reach = Math.acos(Math.max(-1, Math.min(1, (a * a + mine.ra ** 2 - other.ra ** 2) / (2 * a * mine.ra))));
  const margin = reach + Math.PI / mine.n;
  const pitch = TWO_PI / mine.n;
  return Array.from({ length: mine.n }, (_, k) => k).filter((k) => {
    const between = (((k * pitch - toOther) % TWO_PI) + 3 * Math.PI) % TWO_PI;
    return Math.abs(between - Math.PI) <= margin;
  });
}

/**
 * The pair's overlap and gap at the driver's angle, on the teeth in the mesh zone only, sampled
 * densely (`MESH_SAMPLES` points up each flank): dense and cheap enough to run at every half degree.
 */
export function meshAt(model: GearPair, theta: number): Meshing {
  const { links } = pose(model, theta);
  const poses: [LinkPose, LinkPose] = [
    links.driver ?? { at: [0, 0], angle: 0 },
    links.driven ?? { at: [centreOf(model), 0], angle: 0 },
  ];
  const posed = ([0, 1] as const).map((which) => {
    const matrix = linkMatrix(poses[which]);
    const gear = gearOf(model, which);
    return teethInMesh(model, which, poses)
      .flatMap((k) => toothOutline(gear, k, MESH_SAMPLES))
      .map((p) => applyMatrix(matrix, p));
  }) as [Point[], Point[]];
  return overlapOf(model, posed, poses);
}
